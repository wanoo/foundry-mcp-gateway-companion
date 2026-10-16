/**
 * Campaign Codex — commandes déléguées par le module campaign_codex.rs de la passerelle.
 * Handlers à réponse unique, fusionnés dans UNIQUE_HANDLERS par scripts/main.mjs.
 * Chaque handler dégrade proprement si le module cible n'est pas actif.
 */

function ccApi() {
  const mod = game.modules.get("campaign-codex");
  if (!mod?.active || !mod.api) throw new Error("campaign-codex module not active");
  return mod.api;
}

function ccManager() {
  ccApi();
  if (!game.campaignCodex) throw new Error("Campaign Codex is not ready yet (game.campaignCodex missing)");
  return game.campaignCodex;
}

export const CAMPAIGN_CODEX_HANDLERS = {
  // ---------------------------------------------------------- Campaign Codex
  async cc_convert({ uuid, type, pagesToSeparateSheets = false }) {
    const api = ccApi();
    const valid = ["location", "npc", "region", "shop", "group"];
    if (!valid.includes(type)) throw new Error(`Campaign Codex can only convert to: ${valid.join(", ")}`);
    const source = await fromUuid(uuid);
    if (!source) throw new Error(`Journal not found: ${uuid}`);
    const result = await api.convertJournalToCCSheet(uuid, type, pagesToSeparateSheets);
    // journal | tableau de journaux | null (échec, CC a déjà notifié)
    const created = (Array.isArray(result) ? result : [result]).filter(Boolean);
    if (!created.length) throw new Error(`Campaign Codex did not convert ${uuid} (no text content, or conversion refused)`);
    return {
      converted: uuid,
      type,
      created: created.map((j) => ({ uuid: j.uuid, name: j.name })),
    };
  },

  async cc_export_obsidian() {
    const api = ccApi();
    await api.exportToObsidian();
    return { exported: true };
  },

  async cc_open_toc({ viewMode, tags, tagMode, tab } = {}) {
    const api = ccApi();
    const options = {};
    const mode = viewMode ?? tab;
    if (mode) options.viewMode = mode;
    if (Array.isArray(tags)) options.tags = tags;
    if (tagMode) options.tagMode = tagMode;
    // openHub / openTOCSheet BASCULENT : s'il est déjà ouvert, on réapplique
    // les options et on le ramène au premier plan au lieu de le fermer.
    const hub = game.campaignCodex?.hubInstance;
    if (hub?.rendered) {
      hub.applyOpenOptions?.(options);
      await hub.render(true);
      hub.bringToFront?.();
      return { opened: "hub", alreadyOpen: true, options };
    }
    await api.openHub(options);
    return { opened: "hub", alreadyOpen: false, options };
  },

  async cc_open_quest_board() {
    const api = ccApi();
    const board = game.campaignCodex?.questBoardInstance;
    if (board?.rendered) {
      await board.render(true);
      board.bringToFront?.();
      return { opened: "quest-board", alreadyOpen: true };
    }
    await api.openQuestBoard();
    return { opened: "quest-board", alreadyOpen: false };
  },

  async cc_open_sheet({ uuid }) {
    ccApi();
    const doc = await fromUuid(uuid);
    if (!doc) throw new Error(`Sheet not found: ${uuid}`);
    const sheet = doc.sheet;
    if (!sheet) throw new Error(`No sheet available for ${uuid}`);
    await sheet.render(true);
    const sheetClass = sheet.constructor?.name ?? null;
    return {
      opened: uuid,
      name: doc.name,
      sheetClass,
      configuredSheetClass: doc.getFlag("core", "sheetClass") ?? null,
      campaignCodexSheet: !["JournalEntrySheet", "JournalSheet"].includes(sheetClass),
    };
  },

  async cc_migrate_content() {
    const api = ccApi();
    if (!game.user.isGM) throw new Error("Only a GM can migrate Campaign Codex content");
    const r = await api.migrateAllJournalContent({ notify: false });
    return {
      total: r.total,
      migrated: r.migrated,
      repaired: r.repaired,
      failed: (r.failed ?? []).map((f) => ({ uuid: f.uuid, name: f.name, error: String(f.error?.message ?? f.error) })),
    };
  },

  async cc_shop_add_item({ shopUuid, itemUuid, quantity = 1, customPrice, infinite, visibleToPlayers }) {
    const manager = ccManager();
    const shop = await fromUuid(shopUuid);
    if (!shop) throw new Error(`Shop sheet not found: ${shopUuid}`);
    if (shop.getFlag("campaign-codex", "type") !== "shop") throw new Error(`${shop.name} is not a Campaign Codex shop sheet`);
    const item = await fromUuid(itemUuid);
    if (!item || item.documentName !== "Item") throw new Error(`Item not found: ${itemUuid}`);
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));
    await manager.addItemToShop(shop, item, qty);

    // Réglages de la ligne (addItemToShop ne les prend pas)
    const data = foundry.utils.deepClone(shop.getFlag("campaign-codex", "data") || {});
    const inventory = data.inventory || [];
    const row = inventory.find((r) => r.itemUuid === item.uuid);
    if (!row) throw new Error("Campaign Codex did not add the item to the inventory");
    let patched = false;
    if (customPrice !== undefined) { row.customPrice = customPrice; patched = true; }
    if (infinite !== undefined) { row.infinite = infinite === true; patched = true; }
    if (visibleToPlayers !== undefined) { row.visibleToPlayers = visibleToPlayers !== false; patched = true; }
    if (patched) await shop.setFlag("campaign-codex", "data.inventory", inventory);
    return {
      shop: shop.name,
      line: {
        itemUuid: row.itemUuid, name: row.name, quantity: row.quantity,
        customPrice: row.customPrice ?? null, basePrice: row.basePrice, currency: row.currency,
        infinite: !!row.infinite, visibleToPlayers: row.visibleToPlayers !== false,
      },
    };
  },
};
