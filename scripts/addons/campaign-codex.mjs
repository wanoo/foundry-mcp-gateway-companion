/**
 * Campaign Codex — commandes déléguées par le module campaign_codex.rs de la passerelle.
 * Handlers à réponse unique, fusionnés dans UNIQUE_HANDLERS par scripts/main.mjs.
 * Chaque handler dégrade proprement si le module cible n'est pas actif.
 */

export const CAMPAIGN_CODEX_HANDLERS = {
  // ---------------------------------------------------------- Campaign Codex
  async cc_convert({ uuid, type, pagesToSeparateSheets = false }) {
    const api = game.modules.get("campaign-codex")?.api;
    if (!api) throw new Error("campaign-codex module not active");
    await api.convertJournalToCCSheet(uuid, type, pagesToSeparateSheets);
    return { converted: uuid, type };
  },

  async cc_export_obsidian() {
    const api = game.modules.get("campaign-codex")?.api;
    if (!api) throw new Error("campaign-codex module not active");
    await api.exportToObsidian();
    return { exported: true };
  },

  async cc_open_toc({ tab }) {
    const api = game.modules.get("campaign-codex")?.api;
    if (!api) throw new Error("campaign-codex module not active");
    api.openTOCSheet(tab);
    return { opened: tab ?? "default" };
  },
};
