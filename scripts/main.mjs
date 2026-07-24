/**
 * Foundry MCP Companion — pont client-side pour foundry-mcp-gateway.
 *
 * Le serveur MCP est un client socket NATIF : il ne peut agir que sur des
 * documents. Ce module tourne dans le NAVIGATEUR (donc avec l'API game.* de
 * jeu complète) et exécute les actions que le serveur lui délègue via le canal
 * socket `module.foundry-mcp-gateway-companion`.
 *
 * Protocole (tout passe par game.socket, relayé par le serveur Foundry) :
 *   commande  MCP → module : { mcp:true, cmd, id, targets?, args }
 *   réponse   module → MCP : { mcp:true, reply:id, ok, result | error, user }
 *   télémétrie module → MCP : { mcp:true, evt, user, data }
 *
 * Le serveur MCP émet une commande et capte la réponse/la télémétrie dans son
 * buffer d'événements (outils client_* / get_events).
 */

import { CC_FAMILY_HANDLERS } from "./addons/cc-family.mjs";
import { SCENE_FX_HANDLERS } from "./addons/scene-fx.mjs";
import { INSIGHT_HANDLERS } from "./addons/insight.mjs";
import { ASK_HANDLERS, TABLE_HANDLERS } from "./addons/table.mjs";
import { AMBIENCE_HANDLERS } from "./addons/ambience.mjs";
import { verifyCommand, DANGEROUS_COMMANDS } from "./verify.mjs";

const CHANNEL = "module.foundry-mcp-gateway-companion";
const MODULE_ID = "foundry-mcp-gateway-companion";
const VERSION = "1.6.0";

/* ---------------------------------------------------------------- utilities */

function log(...args) {
  console.log(`%c[MCP Companion]`, "color:#6cf", ...args);
}

function emit(payload) {
  game.socket.emit(CHANNEL, { mcp: true, ...payload });
}

/** Le « responder » : un seul client répond aux commandes à exécution unique
 * (macros, rolls, API CC). On élit le MJ actif au plus petit id — déterministe,
 * Élu PARMI LES CLIENTS QUI ONT CHARGÉ LE MODULE (registre `companions`), pas
 * parmi tous les MJ actifs — sinon le connecteur MCP headless (un GM actif qui
 * ne charge aucun module) pourrait être élu et personne ne répondrait. */
const companions = new Set(); // userIds des clients ayant chargé ce module

function isResponder() {
  if (!game.user.isGM) return false;
  const gmCompanions = [...companions]
    .filter((id) => {
      const u = game.users.get(id);
      return u?.active && u.isGM;
    })
    .sort();
  // fallback : si le registre est vide (avant convergence), je réponds moi-même.
  return gmCompanions.length === 0 || gmCompanions[0] === game.user.id;
}

/** Ce client doit-il exécuter une commande « de scène » selon sa cible ?
 *  targets : "all" (défaut) | "gm" | "players" | [userId, …] */
function shouldRunHere(targets) {
  if (!targets || targets === "all") return true;
  if (targets === "gm") return game.user.isGM;
  if (targets === "players") return !game.user.isGM;
  if (Array.isArray(targets)) return targets.includes(game.user.id);
  return false;
}

function reply(id, ok, payload) {
  emit({ reply: id, ok, user: game.user.id, ...(ok ? { result: payload } : { error: String(payload) }) });
}

/* ------------------------------------------------------------- command dispatch */

/** Anti-rejeu ET anti-double des commandes à réponse unique.
 *
 * Une `Map(id → instant)` et non un `Set` : les `id` s'accumulaient pour toute
 * la durée de la session du navigateur, sans jamais être purgés. Bornée, elle
 * devient un vrai cache anti-rejeu — la fenêtre de purge doit rester plus
 * large que la validité d'une commande signée, sinon un rejeu tardif
 * repasserait. */
const HANDLED_TTL_MS = 5 * 60_000;
const handled = new Map();

function alreadyHandled(id) {
  const now = Date.now();
  if (handled.size > 500) {
    for (const [k, t] of handled) if (now - t > HANDLED_TTL_MS) handled.delete(k);
  }
  if (handled.has(id)) return true;
  handled.set(id, now);
  return false;
}

/** Clé publique de confiance, LUE UNE FOIS au démarrage.
 *
 * Figée volontairement : un réglage de portée « world » n'est pas réservé aux
 * MJ (`SETTINGS_MODIFY` vaut ASSISTANT par défaut et peut être accordé aux
 * joueurs), donc quelqu'un pourrait le remplacer en cours de partie. La valeur
 * qui vérifie ne doit pas pouvoir changer sous nos pieds ; toute mutation en
 * séance est signalée au MJ, mais n'est pas prise en compte avant rechargement. */
let trustedKey = "";

/** Décide du sort d'une commande à partir du verdict de signature.
 *
 * On ne durcit jamais dans le dos du MJ : sans clé configurée, seules les
 * commandes qui EXÉCUTENT DU CODE sont refusées, tout le reste continue de
 * marcher. Dès qu'une clé existe, le MJ a exprimé son intention et on exige
 * une signature valide partout. */
function commandGate(cmd, verdict, mode) {
  if (mode === "off") return { allow: true };
  if (verdict.ok) return { allow: true };
  if (mode === "guarded" && verdict.reason === "no-key") {
    return DANGEROUS_COMMANDS.has(cmd)
      ? { allow: false, message: game.i18n.localize("MCPCOMPANION.ErrNoKey") }
      : { allow: true };
  }
  const messages = {
    expired: "MCPCOMPANION.ErrClockSkew",
    "wrong-world": "MCPCOMPANION.ErrWrongWorld",
    "no-key": "MCPCOMPANION.ErrNoKey",
    "bad-key": "MCPCOMPANION.ErrBadKey",
  };
  return {
    allow: false,
    message: game.i18n.localize(messages[verdict.reason] ?? "MCPCOMPANION.ErrBadSignature"),
  };
}

async function onMessage(msg) {
  if (!msg?.mcp) return;

  // Registre des clients ayant chargé le module (pour élire le responder).
  if (msg.evt === "companion_ready" && msg.user && !companions.has(msg.user)) {
    companions.add(msg.user);
    // handshake : on se re-signale à ce nouveau venu (une fois par inconnu).
    emit({ evt: "companion_ready", user: game.user.id, data: { version: VERSION, responder: isResponder() } });
  }

  if (!msg.cmd) return; // on ignore les autres télémétries / nos propres réponses
  const { cmd, id, targets } = msg;

  // ⚠️ ORDRE CRITIQUE : cet `await` est le SEUL avant les gardes synchrones.
  // Le placer après `alreadyHandled` ouvrirait une course — deux messages du
  // même id s'entrelaceraient pendant l'attente et seraient traités deux fois.
  // Tout ce qui suit jusqu'au dispatch doit rester synchrone.
  const verdict = await verifyCommand({
    msg,
    publicKeyHex: trustedKey,
    worldId: game.world.id,
    now: Date.now(),
  });
  const gate = commandGate(cmd, verdict, game.settings.get(MODULE_ID, "verifyMode"));
  if (!gate.allow) {
    console.warn(`[MCP Companion] ${cmd} refusé : ${verdict.reason}`);
    // Seul le responder répond, sinon chaque client renverrait la même erreur.
    if (id && isResponder() && !alreadyHandled(id)) reply(id, false, gate.message);
    return;
  }
  // On exécute les arguments VÉRIFIÉS, jamais `msg.args` : c'est ce qui
  // garantit que ce qui tourne est bien ce qui a été signé. Sans signature
  // (commande inoffensive, pas de clé), on retombe sur `msg.args`.
  const args = verdict.ok ? verdict.args : (msg.args ?? {});

  // Commandes « de scène » : chaque client ciblé exécute, pas de réponse unique.
  // On interroge la TABLE, jamais une liste parallèle : la liste en dur qui
  // vivait ici se désynchronisait en silence — un handler ajouté à
  // SCENE_HANDLERS et oublié dans la liste tombait dans la branche « unique »
  // et répondait « Unknown command ».
  // `Object.hasOwn` et pas `TABLE[cmd]` : `cmd` vient du réseau, et
  // `toString`/`constructor` matcheraient via la chaîne de prototypes.
  if (Object.hasOwn(SCENE_HANDLERS, cmd)) {
    if (shouldRunHere(targets)) {
      try {
        await SCENE_HANDLERS[cmd](args);
      } catch (e) {
        console.error(`[MCP Companion] ${cmd}:`, e);
      }
    }
    // Le responder accuse réception une seule fois (le MCP sait que ça a été relayé).
    if (id && isResponder() && !alreadyHandled(id)) {
      reply(id, true, { dispatched: cmd });
    }
    return;
  }

  // Commandes « adressées » : c'est le client CIBLÉ qui exécute ET qui répond
  // (poser une question à un joueur n'a de sens que chez lui). Le responder ne
  // s'en mêle pas, sinon il répondrait à la place de l'intéressé.
  if (Object.hasOwn(ASK_HANDLERS, cmd)) {
    if (!shouldRunHere(targets) || !id || alreadyHandled(id)) return;
    try {
      reply(id, true, await ASK_HANDLERS[cmd](args));
    } catch (e) {
      console.error(`[MCP Companion] ${cmd}:`, e);
      reply(id, false, e?.message ?? e);
    }
    return;
  }

  // Commandes à réponse unique : seul le responder exécute.
  // Le test d'existence porte sur la TABLE, pas sur la valeur de retour : un
  // handler qui rendrait `undefined` faisait répondre « Unknown command »,
  // ce qui aurait envoyé le prochain contributeur chercher très loin.
  if (!id || !isResponder()) return;
  if (!Object.hasOwn(UNIQUE_HANDLERS, cmd)) {
    if (!alreadyHandled(id)) reply(id, false, `Unknown command: ${cmd}`);
    return;
  }
  if (alreadyHandled(id)) return;
  try {
    reply(id, true, (await UNIQUE_HANDLERS[cmd](args)) ?? null);
  } catch (e) {
    console.error(`[MCP Companion] ${cmd}:`, e);
    reply(id, false, e?.message ?? e);
  }
}

/* ------------------------------------------------------------- scene handlers */

const SCENE_HANDLERS = {
  async pan({ x, y, scale, tokenId }) {
    let point = { x, y };
    if (tokenId) {
      const t = canvas.tokens?.get(tokenId);
      if (t) point = { x: t.center.x, y: t.center.y };
    }
    await canvas.animatePan({ ...point, scale: scale ?? canvas.stage.scale.x });
  },

  async ping_at({ x, y, tokenId }) {
    let point = { x, y };
    if (tokenId) {
      const t = canvas.tokens?.get(tokenId);
      if (t) point = { x: t.center.x, y: t.center.y };
    }
    canvas.ping(point);
  },

  async play_sound({ src, volume = 0.8, loop = false }) {
    const AH = foundry?.audio?.AudioHelper ?? globalThis.AudioHelper;
    await AH.play({ src, volume, autoplay: true, loop }, false);
  },

  async notify({ message, type = "info" }) {
    // Liste blanche : `type` vient du réseau, et `ui.notifications[type]`
    // acceptait n'importe quel nom de propriété — `clear` vidait les
    // notifications au lieu d'en poster une, et une propriété non-fonction
    // levait une erreur avalée par le dispatch de scène.
    const allowed = ["info", "warn", "warning", "error"];
    const kind = allowed.includes(type) ? type : "info";
    ui.notifications[kind](message);
  },

  async show_document({ uuid }) {
    const doc = await fromUuid(uuid);
    if (doc?.sheet) doc.sheet.render(true);
  },
};

/* --------------------------------------------- politique d'exécution de code */

/** Garde commun à `run_script` et aux macros de type « script ».
 *
 * Les deux exécutent du JavaScript avec les droits du MJ, donc ils partagent
 * une politique et un dialogue. Le réglage diffère : `run_script` est à
 * « off » par défaut (personne ne s'attend à ce qu'un client MCP évalue du
 * code arbitraire), les macros à « confirm » (elles marchaient déjà, les
 * refuser d'office casserait des mondes en place sans prévenir).
 *
 * @param {object} o
 * @param {string} o.setting  clé du réglage tri-état à consulter
 * @param {string} o.source   le code affiché au MJ pour audit
 * @param {string} o.title    titre du dialogue de confirmation
 * @param {string} o.body     texte d'explication du dialogue
 * @param {string} o.disabled message d'erreur quand le mode vaut « off »
 * @param {string} o.declined message d'erreur quand le MJ refuse ou ne répond pas
 */
async function assertScriptAllowed({ setting, source, title, body, disabled, declined }) {
  const mode = game.settings.get(MODULE_ID, setting);
  if (mode === "off") throw new Error(disabled);

  // Le code est TOUJOURS tracé avant de tourner : même en mode automatique,
  // le MJ doit pouvoir auditer après coup ce qui s'est exécuté chez lui.
  console.warn(
    "%c[MCP Companion] remote code — executing with GM rights:",
    "color:#f66;font-weight:bold"
  );
  console.warn(source);

  if (mode !== "confirm") return;

  const D2 = foundry.applications?.api?.DialogV2;
  if (!D2?.confirm) throw new Error("DialogV2 unavailable (Foundry v12+ required)");
  // Pas de repli identité : si l'échappeur manque, le code à valider
  // s'exécuterait AU RENDU du dialogue, avant que le MJ ne clique — le
  // mode « confirm » deviendrait strictement équivalent au mode « auto ».
  const escape = foundry.utils?.escapeHTML;
  if (typeof escape !== "function") {
    throw new Error("foundry.utils.escapeHTML unavailable — refusing to display untrusted code");
  }
  // On refuse passé le délai : un MJ absent ne vaut pas un accord, et
  // l'appel MCP côté serveur expire de toute façon vers 30 s.
  let timer;
  const expiry = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), 25000);
  });
  const asked = D2.confirm({
    window: { title },
    content:
      `<p>${escape(body)}</p>` +
      `<pre style="max-height:22rem;overflow:auto;white-space:pre-wrap">${escape(source)}</pre>`,
    rejectClose: false,
    modal: true,
  });
  const ok = await Promise.race([asked, expiry]);
  clearTimeout(timer);
  if (!ok) throw new Error(declined);
}

/* ------------------------------------------------------------ unique handlers */

const UNIQUE_HANDLERS = {
  async ping_module() {
    return {
      module: MODULE_ID,
      version: VERSION,
      responder: game.user.name,
      system: game.system.id,
      // Ce qui conditionne la disponibilité des outils optionnels.
      dependencies: Object.fromEntries(
        [
          ["dice-so-nice", "diceSoNice"],
          ["campaign-codex", "campaignCodex"],
          ["sequencer", "sequencer"],
          ["fxmaster", "fxmaster"],
          ["tokenmagic", "tokenMagic"],
          ["monks-active-tiles", "monksActiveTiles"],
          ["asset-librarian", "assetLibrarian"],
          ["wgtgm-mini-calendar", "miniCalendar"],
        ].map(([id, key]) => [key, game.modules.get(id)?.active ?? false]),
      ),
    };
  },

  async run_macro({ macro, scope = {} }) {
    const m = game.macros.get(macro) ?? game.macros.getName(macro);
    if (!m) throw new Error(`Macro not found: ${macro}`);
    // Une macro de type « script » EST du JavaScript exécuté avec les droits
    // du MJ : sans ce garde-fou, run_macro contournait entièrement la
    // politique de run_script — il suffisait de créer une macro et de
    // demander son exécution par son nom.
    //
    // Seules les macros pilotées PAR MCP passent ici : ce handler n'est
    // atteint que par une commande socket. Une macro que le MJ lance depuis
    // l'interface Foundry n'est jamais interceptée.
    //
    // Les macros de type « chat » ne peuvent pas exécuter de JS (elles
    // passent par le pipeline de chat) : on les laisse libres.
    if (m.type === "script") {
      await assertScriptAllowed({
        setting: "runMacroScriptMode",
        source: m.command ?? "",
        title: game.i18n.format("MCPCOMPANION.RunMacroConfirmTitle", { name: m.name }),
        body: game.i18n.format("MCPCOMPANION.RunMacroConfirmBody", { name: m.name }),
        disabled: "run_macro is disabled for script macros — a Gamemaster must allow it in this module's settings.",
        declined: "macro execution declined by the Gamemaster",
      });
    }
    const out = await m.execute(scope);
    return { executed: m.name, returned: out ?? null };
  },

  async run_script({ code }) {
    await assertScriptAllowed({
      setting: "runScriptMode",
      source: code,
      title: game.i18n.localize("MCPCOMPANION.RunScriptConfirmTitle"),
      body: game.i18n.localize("MCPCOMPANION.RunScriptConfirmBody"),
      disabled:
        "run_script is disabled — a Gamemaster must enable it in this module's settings. " +
        "It executes arbitrary JavaScript with GM rights and is off by default on purpose.",
      declined: "script execution declined by the Gamemaster",
    });

    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const fn = new AsyncFunction("game", "canvas", "ui", code);
    const out = await fn(game, canvas, ui);
    return { returned: out ?? null };
  },

  // starwarsffg : lance un pool DÉJÀ calculé (le serveur dérive la fiche) avec
  // le vrai moteur FFG + Dice So Nice, et poste la carte de chat native.
  async roll_pool_native({ pool, description, actorId }) {
    description ??= game.i18n.localize("MCPCOMPANION.RollFlavor");
    const Pool = globalThis.DicePoolFFG;
    const RollFFG = game.ffg?.RollFFG;
    if (!Pool || !RollFFG) throw new Error("starwarsffg dice engine not available");
    const dp = new Pool(pool || {});
    const roll = new RollFFG(dp.renderDiceExpression(), {}, dp, description);
    await roll.evaluate();
    const f = roll.ffg || {};
    const speaker = actorId ? { actor: actorId } : {};
    await roll.toMessage({
      speaker,
      flavor: `${description} — ${game.i18n.localize("MCPCOMPANION.ViaMCP")}`,
    });
    return {
      success: f.success || 0, failure: f.failure || 0,
      advantage: f.advantage || 0, threat: f.threat || 0,
      triumph: f.triumph || 0, despair: f.despair || 0,
      light: f.light || 0, dark: f.dark || 0,
    };
  },

  // Sequencer : joue un effet visuel (si le module est actif).
  async play_effect({ file, atTokenId, x, y, scale = 1 }) {
    if (!globalThis.Sequence) throw new Error("sequencer module not active");
    const seq = new Sequence().effect().file(file).scale(scale);
    const t = atTokenId ? canvas.tokens?.get(atTokenId) : null;
    if (t) seq.atLocation(t); else seq.atLocation({ x, y });
    await seq.play();
    return { played: file };
  },

  // Télémétrie snapshot : ce que le responder voit de façon fiable.
  async get_client_state() {
    return {
      activeUsers: game.users
        .filter((u) => u.active)
        .map((u) => ({
          id: u.id, name: u.name, isGM: u.isGM,
          character: u.character?.id ?? null,
          viewedScene: u.viewedScene ?? null,
        })),
      currentScene: canvas.scene?.id ?? null,
    };
  },
};

// Fusionne les handlers des fichiers d'addons dédiés (famille CC + FX de scène).
Object.assign(
  UNIQUE_HANDLERS,
  CC_FAMILY_HANDLERS,
  SCENE_FX_HANDLERS,
  INSIGHT_HANDLERS,
  TABLE_HANDLERS,
  AMBIENCE_HANDLERS,
);

/* ---------------------------------------------------------------- telemetry */

function setupTelemetry() {
  if (!game.settings.get(MODULE_ID, "telemetry")) return;

  Hooks.on("controlToken", () => {
    emit({ evt: "selection", user: game.user.id, data: { tokenIds: canvas.tokens.controlled.map((t) => t.id) } });
  });
  Hooks.on("targetToken", () => {
    emit({ evt: "target", user: game.user.id, data: { tokenIds: [...game.user.targets].map((t) => t.id) } });
  });
  // Un seul client relaie le combat (le responder) pour éviter les doublons.
  Hooks.on("updateCombat", (combat) => {
    if (!isResponder()) return;
    const current = combat.combatant;
    emit({ evt: "combat", user: game.user.id, data: {
      combat: combat.id, round: combat.round, turn: combat.turn,
      current: current?.name ?? null, currentId: current?.id ?? null,
    }});
  });
  Hooks.on("canvasReady", () => {
    emit({ evt: "scene", user: game.user.id, data: { sceneId: canvas.scene?.id ?? null, name: canvas.scene?.name ?? null } });
  });
}

/* -------------------------------------------------------------------- setup */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "telemetry", {
    name: "MCPCOMPANION.SettingTelemetry",
    hint: "MCPCOMPANION.SettingTelemetryHint",
    scope: "client", config: true, type: Boolean, default: true,
  });
  game.settings.register(MODULE_ID, "runScriptMode", {
    name: "MCPCOMPANION.SettingRunScript",
    hint: "MCPCOMPANION.SettingRunScriptHint",
    scope: "world", config: true, type: String, default: "off",
    choices: {
      off: "MCPCOMPANION.RunScriptOff",
      confirm: "MCPCOMPANION.RunScriptConfirm",
      auto: "MCPCOMPANION.RunScriptAuto",
    },
  });
  // Macros de type « script » pilotées par MCP. Réglage SÉPARÉ de
  // runScriptMode, et défaut « confirm » et non « off » : ces macros
  // s'exécutaient sans aucun garde-fou jusqu'ici. Les router vers un réglage
  // à « off » aurait cassé en silence les mondes qui s'en servent — on passe
  // de « ça marche » à « on me demande », jamais à « c'est refusé ».
  game.settings.register(MODULE_ID, "runMacroScriptMode", {
    name: "MCPCOMPANION.SettingRunMacro",
    hint: "MCPCOMPANION.SettingRunMacroHint",
    scope: "world", config: true, type: String, default: "confirm",
    choices: {
      off: "MCPCOMPANION.RunScriptOff",
      confirm: "MCPCOMPANION.RunScriptConfirm",
      auto: "MCPCOMPANION.RunScriptAuto",
    },
  });
  // Ancrage de confiance : la clé publique de la passerelle autorisée à
  // piloter ce monde. Une clé PUBLIQUE, donc sa lecture par tous les clients
  // est sans conséquence — seul son remplacement compte, d'où la surveillance
  // dans le hook ready.
  game.settings.register(MODULE_ID, "rootPublicKey", {
    name: "MCPCOMPANION.SettingRootKey",
    hint: "MCPCOMPANION.SettingRootKeyHint",
    scope: "world", config: true, type: String, default: "",
  });
  game.settings.register(MODULE_ID, "verifyMode", {
    name: "MCPCOMPANION.SettingVerify",
    hint: "MCPCOMPANION.SettingVerifyHint",
    scope: "world", config: true, type: String, default: "guarded",
    choices: {
      off: "MCPCOMPANION.VerifyOff",
      guarded: "MCPCOMPANION.VerifyGuarded",
      strict: "MCPCOMPANION.VerifyStrict",
    },
  });
  // Ancien réglage booléen : gardé hors interface, uniquement pour migrer les
  // mondes existants sans changer leur comportement (cf. hook ready).
  game.settings.register(MODULE_ID, "allowRunScript", {
    scope: "world", config: false, type: Boolean, default: false,
  });
});

Hooks.once("ready", () => {
  // Migration : un monde qui avait autorisé l'exécution garde EXACTEMENT le
  // comportement qu'il avait (silencieux) — on ne durcit pas un réglage dans
  // le dos du MJ, on lui laisse choisir « confirm » s'il le souhaite.
  if (game.user.isGM && game.settings.get(MODULE_ID, "allowRunScript")) {
    game.settings.set(MODULE_ID, "runScriptMode", "auto");
    game.settings.set(MODULE_ID, "allowRunScript", false);
    log("réglage migré : exécution de script → mode automatique");
  }
  // La clé de confiance est figée ici, une fois pour toute la session.
  trustedKey = String(game.settings.get(MODULE_ID, "rootPublicKey") ?? "").trim();
  if (!trustedKey && game.user.isGM) {
    log(
      "aucune clé publique de passerelle configurée — les commandes qui exécutent " +
        "du code seront refusées. Installez-la avec l'outil MCP companion_trust_key, " +
        "ou collez celle affichée par « foundry-mcp --print-public-key »."
    );
  }
  // Une rotation de clé est rare et délibérée : la voir changer PENDANT une
  // séance mérite une alerte. La valeur en vigueur ne bouge pas pour autant —
  // il faut recharger, ce qui rend l'attaque inopérante et le changement visible.
  Hooks.on("updateSetting", (setting) => {
    if (setting?.key !== `${MODULE_ID}.rootPublicKey`) return;
    if (String(setting.value ?? "").trim() === trustedKey) return;
    console.error(`[MCP Companion] ${game.i18n.localize("MCPCOMPANION.WarnKeyChanged")}`);
    if (game.user.isGM) ui.notifications.error(game.i18n.localize("MCPCOMPANION.WarnKeyChanged"));
  });
  // Un réglage de portée « world » n'est PAS réservé aux MJ : SETTINGS_MODIFY
  // vaut ASSISTANT par défaut et peut être accordé plus bas. Si c'est le cas,
  // l'ancrage de confiance est modifiable par des joueurs — il faut le dire.
  if (game.user.isGM) {
    const roles = game.settings.get("core", "permissions")?.SETTINGS_MODIFY ?? [];
    if (roles.some((r) => r < CONST.USER_ROLES.ASSISTANT)) {
      ui.notifications.warn(game.i18n.localize("MCPCOMPANION.WarnSettingsPermission"));
    }
  }

  game.socket.on(CHANNEL, onMessage);
  companions.add(game.user.id); // je fais partie des clients qui ont chargé le module
  setupTelemetry();
  // Signale sa présence (registre des autres companions + buffer du serveur MCP).
  emit({ evt: "companion_ready", user: game.user.id, data: { version: VERSION, responder: isResponder() } });
  log(`v${VERSION} prêt — responder=${isResponder()} · canal ${CHANNEL}`);
});
