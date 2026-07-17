/**
 * Famille d'addons wgtnGM (« famille Campaign Codex ») — handlers client-side.
 * Regroupe les commandes déléguées par le serveur MCP (cc_family.rs) qui
 * nécessitent l'API navigateur : Campaign Codex, Asset Librarian, Mini Calendar.
 * Chaque handler dégrade proprement si le module cible n'est pas actif.
 *
 * Exporté vers scripts/main.mjs qui fusionne dans UNIQUE_HANDLERS.
 */

export const CC_FAMILY_HANDLERS = {
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

  // ---------------------------------------------------------- Asset Librarian
  async al_open({ mode = "world", tab = "Item", filters }) {
    const al = game.assetLibrarian;
    if (!al?.open) throw new Error("asset-librarian module not active");
    if (Array.isArray(filters) && filters.length) {
      al.open(mode, tab, { clearExistingFilters: true, filters });
    } else {
      al.open(mode, tab);
    }
    return { opened: `${mode}/${tab}`, filtered: Array.isArray(filters) && filters.length > 0 };
  },

  // ---------------------------------------------------------- Mini Calendar
  async mc_set_time({ world_time, advance_seconds, mode }) {
    // Priorité au mode dawn/dusk via la macro setTime du module ; sinon horloge core.
    if (mode === "dawn" || mode === "dusk") {
      const m = game.macros?.getName?.("setTime");
      if (!m) throw new Error("Mini Calendar 'setTime' macro not found");
      await m.execute({ mode });
      return { mode };
    }
    if (typeof world_time === "number") {
      await game.time.advance(world_time - game.time.worldTime);
      return { worldTime: world_time };
    }
    if (typeof advance_seconds === "number") {
      await game.time.advance(advance_seconds);
      return { worldTime: game.time.worldTime };
    }
    throw new Error("Provide world_time, advance_seconds or mode (dawn/dusk)");
  },

  async mc_open() {
    // Ouvre le calendrier via sa macro (« Open Calendar »), best-effort.
    const m = game.macros?.getName?.("Open Calendar")
      ?? game.macros?.contents?.find((x) => /calendar/i.test(x.name));
    if (!m) throw new Error("Mini Calendar 'Open Calendar' macro not found");
    await m.execute();
    return { opened: true };
  },
};
