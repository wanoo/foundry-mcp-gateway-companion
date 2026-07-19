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

const CHANNEL = "module.foundry-mcp-gateway-companion";
const MODULE_ID = "foundry-mcp-gateway-companion";
const VERSION = "1.5.1";

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

const handled = new Set(); // anti-double sur les commandes à réponse unique

async function onMessage(msg) {
  if (!msg?.mcp) return;

  // Registre des clients ayant chargé le module (pour élire le responder).
  if (msg.evt === "companion_ready" && msg.user && !companions.has(msg.user)) {
    companions.add(msg.user);
    // handshake : on se re-signale à ce nouveau venu (une fois par inconnu).
    emit({ evt: "companion_ready", user: game.user.id, data: { version: VERSION, responder: isResponder() } });
  }

  if (!msg.cmd) return; // on ignore les autres télémétries / nos propres réponses
  const { cmd, id, targets, args = {} } = msg;

  // Commandes « de scène » : chaque client ciblé exécute, pas de réponse unique.
  const sceneCmds = ["pan", "ping_at", "play_sound", "notify", "show_document"];
  if (sceneCmds.includes(cmd)) {
    if (shouldRunHere(targets)) {
      try {
        await SCENE_HANDLERS[cmd](args);
      } catch (e) {
        console.error(`[MCP Companion] ${cmd}:`, e);
      }
    }
    // Le responder accuse réception une seule fois (le MCP sait que ça a été relayé).
    if (id && isResponder() && !handled.has(id)) {
      handled.add(id);
      reply(id, true, { dispatched: cmd });
    }
    return;
  }

  // Commandes « adressées » : c'est le client CIBLÉ qui exécute ET qui répond
  // (poser une question à un joueur n'a de sens que chez lui). Le responder ne
  // s'en mêle pas, sinon il répondrait à la place de l'intéressé.
  if (ASK_HANDLERS[cmd]) {
    if (!shouldRunHere(targets) || !id || handled.has(id)) return;
    handled.add(id);
    try {
      reply(id, true, await ASK_HANDLERS[cmd](args));
    } catch (e) {
      console.error(`[MCP Companion] ${cmd}:`, e);
      reply(id, false, e?.message ?? e);
    }
    return;
  }

  // Commandes à réponse unique : seul le responder exécute.
  if (!id || handled.has(id)) return;
  if (!isResponder()) return;
  handled.add(id);
  try {
    const result = await UNIQUE_HANDLERS[cmd]?.(args);
    if (result === undefined) return reply(id, false, `Unknown command: ${cmd}`);
    reply(id, true, result);
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
    const fn = ui.notifications[type] ?? ui.notifications.info;
    fn.call(ui.notifications, message);
  },

  async show_document({ uuid }) {
    const doc = await fromUuid(uuid);
    if (doc?.sheet) doc.sheet.render(true);
  },
};

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
    const out = await m.execute(scope);
    return { executed: m.name, returned: out ?? null };
  },

  async run_script({ code }) {
    if (!game.settings.get(MODULE_ID, "allowRunScript")) {
      throw new Error(
        "run_script is disabled — a Gamemaster must enable it in this module's settings. " +
          "It executes arbitrary JavaScript with GM rights and is off by default on purpose."
      );
    }
    // Le code s'exécute sans interruption (c'est le but de l'outil), mais jamais
    // en aveugle : il est affiché en entier AVANT, et son exécution annoncée.
    // Le MJ peut ainsi auditer après coup ce qui a tourné chez lui.
    console.warn(
      `%c[MCP Companion] remote script — executing with GM rights:`,
      "color:#f66;font-weight:bold"
    );
    console.warn(code);
    ui.notifications.warn(game.i18n.localize("MCPCOMPANION.ScriptRan"));
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
  game.settings.register(MODULE_ID, "allowRunScript", {
    name: "MCPCOMPANION.SettingRunScript",
    hint: "MCPCOMPANION.SettingRunScriptHint",
    scope: "world", config: true, type: Boolean, default: false,
  });
});

Hooks.once("ready", () => {
  game.socket.on(CHANNEL, onMessage);
  companions.add(game.user.id); // je fais partie des clients qui ont chargé le module
  setupTelemetry();
  // Signale sa présence (registre des autres companions + buffer du serveur MCP).
  emit({ evt: "companion_ready", user: game.user.id, data: { version: VERSION, responder: isResponder() } });
  log(`v${VERSION} prêt — responder=${isResponder()} · canal ${CHANNEL}`);
});
