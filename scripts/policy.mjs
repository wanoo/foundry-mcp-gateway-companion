/**
 * Politique d'exécution de code du compagnon — partagée par main.mjs et les
 * addons (Monk's Active Tiles, Mass Edit, Item Piles) : tout ce qui finit par
 * exécuter du JavaScript avec les droits du MJ passe par les MÊMES réglages.
 */

const MODULE_ID = "foundry-mcp-gateway-companion";

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
export async function assertScriptAllowed({ setting, source, title, body, disabled, declined }) {
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

/* ------------------------------------------- réglages d'exécution protégés */

/** Les réglages qui décident si du code distant s'exécute. */
const POLICY_KEYS = ["runScriptMode", "runMacroScriptMode", "verifyMode"];

/** Annule toute modification des réglages d'exécution faite par un client
 * qui ne charge PAS ce module — la passerelle MCP en premier lieu : c'est un
 * compte MJ, Foundry accepte donc qu'elle écrive ces réglages, ce qui lui
 * permettait de s'autoriser elle-même. Le MJ, lui, les change depuis son
 * navigateur, qui charge le module : ses changements passent.
 *
 * @param {object} o
 * @param {(userId: string) => boolean} o.isCompanion le client a-t-il chargé le module ?
 * @param {() => boolean} o.isResponder ce client est-il celui qui rétablit ?
 */
export function guardPolicySettings({ isCompanion, isResponder }) {
  const known = new Map(POLICY_KEYS.map((k) => [k, game.settings.get(MODULE_ID, k)]));
  const onChange = async (setting, _changes, _options, userId) => {
    const prefix = `${MODULE_ID}.`;
    const key = setting?.key?.startsWith(prefix) ? setting.key.slice(prefix.length) : null;
    if (!key || !known.has(key)) return;
    const value = game.settings.get(MODULE_ID, key);
    if (value === known.get(key)) return;
    if (isCompanion(userId)) {
      known.set(key, value);
      return;
    }
    const who = game.users.get(userId)?.name ?? userId;
    console.error(`[MCP Companion] ${key} changed to « ${value} » by ${who}, who does not run this module — reverted.`);
    if (game.user.isGM) {
      ui.notifications.error(game.i18n.format("MCPCOMPANION.WarnPolicyReverted", { key, user: who }));
    }
    if (isResponder()) await game.settings.set(MODULE_ID, key, known.get(key));
  };
  Hooks.on("updateSetting", onChange);
  Hooks.on("createSetting", (setting, options, userId) => onChange(setting, {}, options, userId));
}

/* --------------------------------------------------- Monk's Active Tiles */

// Miroir de src/foundry/script_guard.rs (passerelle) : MÊMES listes, MÊMES
// règles. MAT évalue en JavaScript les champs « valeur » et compile les
// textes avec Handlebars (accès aux prototypes) : une tuile est du code.
// prettier-ignore
const MAT_SAFE_ACTIONS = new Set([
  "pause", "delay", "movement", "pancanvas", "ping", "teleport", "movetoken",
  "rotation", "showhide", "activate", "alter", "hurtheal", "playsound",
  "playlist", "stopsound", "showimage", "changedoor", "notification",
  "chatmessage", "rolltable", "resetfog", "openjournal", "openactor",
  "additem", "removeitem", "trigger", "scene", "scenebackground",
  "addtocombat", "elevation", "resethistory", "tileimage", "target",
  "scenelighting", "globalvolume", "gametime", "scrollingtext", "setvariable",
  "activeeffect", "attack", "create", "delete", "preload", "preloadtileimage",
  "anchor", "goto", "loop", "stop", "stoptriggers", "distance", "visibility",
  "exists", "triggercount", "tokencount", "first", "attribute", "inventory",
  "condition", "random", "checkvariable", "checkvalue", "playertype",
  "method", "triggertype",
]);
// prettier-ignore
const MAT_TEXT_FIELDS = new Set([
  "text", "flavor", "title", "content", "name", "label", "tag", "audiofile",
  "img", "image", "imagefile", "caption", "language", "message", "fail",
  "none", "yes", "no", "landing", "description", "chatMessage",
]);
const SAFE_SCALAR =
  /^\s*(?:==|!=|<=|>=|=|<|>|\+|-)?\s*(?:-?\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?|\[\[[0-9dkhlr+\-*/() ]+\]\]|true|false)\s*$/i;
const IDENT = /^[A-Za-z0-9_.:#@/,\-]*$/;
const HTML_ACTIVE = /<\s*(script|iframe|object|embed)|\bon[a-z]+\s*=|javascript:/i;

function matStringProblem(key, s) {
  if (s.includes("{{")) return `« ${key} » contains a Handlebars template`;
  if (MAT_TEXT_FIELDS.has(key)) {
    const t = s.trimStart();
    if (t.startsWith("=") || t.startsWith("+ ") || t.startsWith("- ")) return `« ${key} » starts with an operator`;
    if (HTML_ACTIVE.test(s)) return `« ${key} » contains active HTML`;
    return null;
  }
  return SAFE_SCALAR.test(s) || IDENT.test(s) ? null : `« ${key} » = ${JSON.stringify(s)} would be evaluated`;
}

function walkMat(key, v, out) {
  if (typeof v === "string") {
    const p = matStringProblem(key, v);
    if (p) out.push(p);
  } else if (Array.isArray(v)) v.forEach((x) => walkMat(key, x, out));
  else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => walkMat(k, x, out));
}

/** Ce qu'exige une liste d'actions MAT : null, ou { setting, reasons }. */
export function matActionsNeed(actions) {
  const script = [];
  let macro = false;
  (Array.isArray(actions) ? actions : []).forEach((a, i) => {
    const kind = a?.action ?? "";
    if (kind === "runmacro") return void (macro = true);
    if (!MAT_SAFE_ACTIONS.has(kind)) return void script.push(`action #${i} « ${kind} » runs code`);
    const errs = [];
    walkMat("data", a.data ?? {}, errs);
    errs.forEach((e) => script.push(`action #${i} « ${kind} »: ${e}`));
  });
  if (script.length) return { setting: "runScriptMode", reasons: script };
  if (macro) return { setting: "runMacroScriptMode", reasons: ["« runmacro »"] };
  return null;
}

/** Garde avant de faire exécuter une tuile MAT existante (importée d'un
 * compendium, écrite avant la 1.8…) : même politique que run_script. */
export async function assertMatTileAllowed(tileDoc) {
  const need = matActionsNeed(tileDoc.getFlag("monks-active-tiles", "actions"));
  if (!need) return;
  await assertScriptAllowed({
    setting: need.setting,
    source: need.reasons.join("\n"),
    title: game.i18n.localize("MCPCOMPANION.RunScriptConfirmTitle"),
    body: game.i18n.format("MCPCOMPANION.MatConfirmBody", { name: tileDoc.name || tileDoc.id }),
    disabled: `this tile can run code (${need.reasons.join("; ")}) — a Gamemaster must allow remote script execution in this module's settings.`,
    declined: "tile trigger declined by the Gamemaster",
  });
}
