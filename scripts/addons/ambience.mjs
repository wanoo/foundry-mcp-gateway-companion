/**
 * Ambiance — pilotage des modules d'atmosphère, tous client-side :
 *   · FXMaster : effets de particules (pluie, brouillard, braises…) via son
 *     hook officiel `fxmaster.updateParticleEffects`. Les FILTRES de scène ne
 *     sont volontairement pas exposés : FXMaster n'offre aucun hook pour eux
 *     (vérifié sur v13 — `FXMASTER.filters` est son compositeur interne).
 *   · Token Magic FX : filtres sur les tokens, par préréglage (70 dispo).
 *   · Sequencer : catalogue des effets installés (JB2A & co) — savoir QUOI
 *     jouer avant d'appeler client_play_effect / client_seq_between.
 * Dégradation gracieuse si le module n'est pas actif.
 * Fusionné dans UNIQUE_HANDLERS par scripts/main.mjs.
 */

function requireModule(id, label) {
  if (!game.modules.get(id)?.active) throw new Error(`${label} module not active`);
}

export const AMBIENCE_HANDLERS = {
  // --------------------------------------------------------------- FXMaster
  async weather({ effects = [], clear = false }) {
    requireModule("fxmaster", "fxmaster");
    if (clear || !effects.length) {
      Hooks.call("fxmaster.updateParticleEffects", []);
      return { cleared: true, scene: canvas.scene?.name ?? null };
    }
    const known = Object.keys(CONFIG.fxmaster?.particleEffects ?? {});
    const payload = effects.map((e) => {
      const type = typeof e === "string" ? e : e.type;
      if (!known.includes(type)) {
        throw new Error(`unknown weather type '${type}' — available: ${known.join(", ")}`);
      }
      return { type, options: (typeof e === "object" && e.options) || {} };
    });
    Hooks.call("fxmaster.updateParticleEffects", payload);
    return { applied: payload.map((p) => p.type), scene: canvas.scene?.name ?? null };
  },

  async weather_types() {
    requireModule("fxmaster", "fxmaster");
    return { particles: Object.keys(CONFIG.fxmaster?.particleEffects ?? {}) };
  },

  // ---------------------------------------------------------- Token Magic FX
  // getPreset() ne rend pas les paramètres sur v13 : on lit la bibliothèque.
  async token_fx({ tokens = [], preset, remove = false }) {
    requireModule("tokenmagic", "tokenmagic");
    const TM = globalThis.TokenMagic;
    const placeables = tokens.map((id) => canvas.tokens.get(id)).filter(Boolean);
    if (!placeables.length) throw new Error("no token found on the current scene");

    if (remove) {
      for (const t of placeables) await TM.deleteFilters(t, preset || undefined);
      return { removed: preset ?? "all", tokens: placeables.map((t) => t.id) };
    }
    if (!preset) throw new Error("'preset' is required (see client_token_fx_presets)");
    const entry = TM.getPresets().find((p) => p.name === preset);
    if (!entry?.params) {
      throw new Error(`unknown Token Magic preset: ${preset}`);
    }
    for (const t of placeables) await TM.addFilters(t, entry.params);
    return { applied: preset, tokens: placeables.map((t) => t.id) };
  },

  async token_fx_presets() {
    requireModule("tokenmagic", "tokenmagic");
    return { presets: globalThis.TokenMagic.getPresets().map((p) => p.name) };
  },

  // --------------------------------------------------------------- Sequencer
  async effect_catalog({ query, under, limit = 60 }) {
    const db = globalThis.Sequencer?.Database;
    if (!db) throw new Error("sequencer module not active");
    if (!query && !under) {
      return { modules: db.publicModules ?? [], hint: "give 'query' (fuzzy) or 'under' (a db path)" };
    }
    let paths = [];
    if (under) {
      const r = db.getPathsUnder(under);
      paths = Array.isArray(r) ? r : [];
    } else {
      const r = db.searchFor(query);
      paths = Array.isArray(r) ? r.map((f) => (typeof f === "string" ? f : f.dbPath ?? String(f))) : [];
    }
    return { count: paths.length, truncated: paths.length > limit, paths: paths.slice(0, limit) };
  },
};
