/**
 * Petits modules wgtnGM (Mini Player, Countdown Dice…) — commandes déléguées par mini_suite.rs.
 * Handlers à réponse unique, fusionnés dans UNIQUE_HANDLERS par scripts/main.mjs.
 * Chaque handler dégrade proprement si le module cible n'est pas actif.
 */

/** API publique de Mini Player (MJ seulement, posée au hook ready). */
function miniPlayerApi() {
  if (!game.modules.get("wgtgm-mini-player")?.active) {
    throw new Error("Mini Player (wgtgm-mini-player) is not active in this world");
  }
  const api = game.wgtngmMiniPlayer?.api ?? globalThis.miniplayer;
  if (!api || typeof api.playPreset !== "function") {
    throw new Error("Mini Player API unavailable on this client (GM only, loaded at ready)");
  }
  return api;
}

/** Tags connus de Mini Player (file store chargé côté MJ), triés. */
function knownTags() {
  try {
    const tags = game.wgtngmTags?.getAllUniqueTags?.() ?? [];
    return [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].sort();
  } catch {
    return [];
  }
}

export const MINI_SUITE_HANDLERS = {
  // ------------------------------------------------------------ Mini Player
  async mp_play_preset({ name, play_music }) {
    const api = miniPlayerApi();
    const wanted = String(name ?? "").trim();
    if (!wanted) throw new Error("'name' is required");
    const names = api.listPresets?.() ?? [];
    const match = names.find((n) => n.toLowerCase() === wanted.toLowerCase());
    if (!match) {
      throw new Error(`Mini Player preset "${wanted}" not found (known: ${names.join(", ") || "none"})`);
    }
    const ok = await api.playPreset(match, play_music !== false);
    if (ok === false) throw new Error(`Mini Player could not apply preset "${match}" (no playable track for this mode?)`);
    return { preset: match, playMusic: play_music !== false, applied: true };
  },

  async mp_play_tags({ tags, target, autoplay, mode }) {
    const api = miniPlayerApi();
    const list = (Array.isArray(tags) ? tags : [])
      .map((t) => String(t ?? "").trim())
      .filter(Boolean);
    const known = knownTags();
    if (!list.length) return { knownTags: known, played: false };
    const unknown = list
      .map((t) => t.replace(/^-/, "").toLowerCase())
      .filter((t) => known.length && !known.includes(t));
    if (target === "soundboard") {
      const r = await api.openSoundboard(list);
      return { target: "soundboard", tags: list, unknownTags: unknown, result: r ?? null };
    }
    const m = mode === "random" ? "random" : "current";
    const r = await api.openMiniPlayer(list, autoplay !== false, m);
    return { target: "player", tags: list, mode: m, unknownTags: unknown, result: r ?? null };
  },
};
