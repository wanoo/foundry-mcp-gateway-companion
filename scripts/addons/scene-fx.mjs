/**
 * Addons de scène (hors famille CC) — handlers client-side :
 *   · Monk's Active Tile Triggers : déclencher une tuile-action.
 *   · Sequencer (avancé) : effet entre tokens (attaque/projectile), son.
 * Dégradation gracieuse si le module cible n'est pas actif.
 * Fusionné dans UNIQUE_HANDLERS par scripts/main.mjs.
 */

export const SCENE_FX_HANDLERS = {
  // ---------------------------------------------- Monk's Active Tile Triggers
  async mat_trigger({ tileId, tokens }) {
    const tile = canvas.tiles?.get(tileId);
    if (!tile) throw new Error(`Tile not found on the current scene: ${tileId}`);
    if (typeof tile.document.trigger !== "function") {
      throw new Error("monks-active-tiles module not active");
    }
    const acting = (tokens ?? []).map((id) => canvas.tokens.get(id)).filter(Boolean);
    await tile.document.trigger({ tokens: acting, method: "manual" });
    return { triggered: tileId, tokens: acting.map((t) => t.id) };
  },

  // ---------------------------------------------- Sequencer (avancé)
  async seq_between({ file, fromTokenId, toTokenId, scale = 1 }) {
    if (!globalThis.Sequence) throw new Error("sequencer module not active");
    const from = canvas.tokens.get(fromTokenId);
    const to = canvas.tokens.get(toTokenId);
    if (!from || !to) throw new Error("from/to token not found on the current scene");
    await new Sequence().effect().file(file).atLocation(from).stretchTo(to).scale(scale).play();
    return { played: file, from: fromTokenId, to: toTokenId };
  },

  async seq_sound({ file, volume = 0.8 }) {
    if (!globalThis.Sequence) throw new Error("sequencer module not active");
    await new Sequence().sound().file(file).volume(volume).play();
    return { played: file };
  },
};
