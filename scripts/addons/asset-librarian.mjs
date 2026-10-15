/**
 * Asset Librarian — commandes déléguées par asset_librarian.rs.
 * Handlers à réponse unique, fusionnés dans UNIQUE_HANDLERS par scripts/main.mjs.
 * Chaque handler dégrade proprement si le module cible n'est pas actif.
 */

export const ASSET_LIBRARIAN_HANDLERS = {
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
};
