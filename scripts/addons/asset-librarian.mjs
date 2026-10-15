/**
 * Asset Librarian — commandes déléguées par asset_librarian.rs.
 * Handlers à réponse unique, fusionnés dans UNIQUE_HANDLERS par scripts/main.mjs.
 * Chaque handler dégrade proprement si le module cible n'est pas actif.
 */

const AL_ID = "asset-librarian";
const TAG_STATES = ["include", "and", "exclude"];

function alApi() {
  const al = game.assetLibrarian;
  if (!game.modules.get(AL_ID)?.active || !al?.open) throw new Error("Asset Librarian (asset-librarian) is not active in this world");
  return al;
}

/** normalizeTag / normalizeTagList du module. */
const normTag = (v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
function normTagList(raw) {
  if (raw === null || raw === undefined) return [];
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(raw) ? raw : String(raw).split(",")) {
    const n = normTag(e);
    const t = n.toLocaleLowerCase();
    if (!n || seen.has(t)) continue;
    seen.add(t);
    out.push(n);
  }
  return out;
}

const TAB_ALIASES = {
  actor: "Actor", actors: "Actor", item: "Item", items: "Item",
  journal: "JournalEntry", journals: "JournalEntry", journalentry: "JournalEntry", journalentries: "JournalEntry",
  scene: "Scene", scenes: "Scene", rolltable: "RollTable", rolltables: "RollTable", table: "RollTable", tables: "RollTable",
  playlist: "Playlist", playlists: "Playlist", macro: "Macro", macros: "Macro", cards: "Cards", card: "Cards",
  adventure: "Adventure", adventures: "Adventure", image: "Image", images: "Image",
};
const canonTab = (t) => TAB_ALIASES[String(t ?? "").trim().toLowerCase()] ?? t;

export const ASSET_LIBRARIAN_HANDLERS = {
  // ---------------------------------------------------------- Asset Librarian
  async al_open({ mode = "world", tab = "Item", filters, tags, tag_state, search, in: location, clear } = {}) {
    const al = alApi();
    const options = {};
    if (Array.isArray(tags) && tags.length) options.tags = tags;
    if (TAG_STATES.includes(tag_state)) options.tagFilterState = tag_state;
    if (Array.isArray(filters) && filters.length) options.filters = filters;
    if (typeof search === "string") options.search = search;
    if (typeof location === "string" || Array.isArray(location)) options.in = location;
    options.clearExistingFilters = clear !== false;
    const t = canonTab(tab);
    if (t === "Image" && !game.user.isGM) throw new Error("The Image tab is GM-only");
    await al.open(mode === "compendium" ? "compendium" : "world", t, Object.keys(options).length > 1 ? options : null);
    return {
      opened: `${mode}/${t}`,
      tags: options.tags?.length ?? 0, tagState: options.tagFilterState ?? "include",
      filters: options.filters?.length ?? 0, search: options.search ?? null, in: options.in ?? null,
      cleared: options.clearExistingFilters,
    };
  },

  async al_search({ type = "Item", mode = "world", tags, tag_match = "any", category, query, limit = 50 } = {}) {
    const al = alApi();
    const dm = al.DataManager;
    if (typeof dm?.getAssets !== "function") throw new Error("Asset Librarian DataManager.getAssets is not available");
    const t = canonTab(type);
    if (t === "Image") throw new Error("Image assets are not documents: use al_image_tags");
    const assets = (await dm.getAssets(t, mode !== "compendium")) ?? [];
    const want = normTagList(tags ?? []).map((x) => x.toLocaleLowerCase());
    const cat = normTag(category ?? "").toLocaleLowerCase();
    const q = String(query ?? "").trim().toLocaleLowerCase();
    const max = Math.max(1, parseInt(limit, 10) || 50);
    const out = [];
    let matched = 0;
    for (const a of assets) {
      const f = a?.flags?.[AL_ID] ?? {};
      const aCat = normTag(f.categoryTag ?? "");
      const aFilters = normTagList(f.filterTag ?? []);
      if (q && !String(a.name ?? "").toLocaleLowerCase().includes(q)) continue;
      if (cat && aCat.toLocaleLowerCase() !== cat) continue;
      if (want.length) {
        const have = new Set([...aFilters, aCat].filter(Boolean).map((x) => x.toLocaleLowerCase()));
        const ok = tag_match === "all" ? want.every((w) => have.has(w)) : want.some((w) => have.has(w));
        if (!ok) continue;
      }
      matched++;
      if (out.length < max) {
        out.push({
          name: a.name, uuid: a.uuid, type: a.type ?? null, img: a.img ?? null, folder: a.folder ?? null,
          pack: a.pack ?? a.packId ?? null, categoryTag: aCat || null, filterTag: aFilters,
        });
      }
    }
    return { type: t, mode, total: assets.length, matched, truncated: matched > out.length, results: out };
  },
};
