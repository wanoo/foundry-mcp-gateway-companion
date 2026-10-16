/**
 * Item Piles — piles, coffres, marchands, coffres-forts (game.itempiles.API) — handlers client-side.
 * Fusionné dans UNIQUE_HANDLERS par scripts/main.mjs.
 *
 * Toute écriture passe par l'API du module (empilement, transformateurs
 * système, hooks). L'API signale ses échecs en renvoyant `false` (hook
 * annulé, pas de MJ pour exécuter) au lieu de lever : chaque retour est testé.
 * Garde-fous : jamais de `macro` de pile écrite d'ici ; et quand la pile CIBLE
 * a déjà une macro (Item Piles l'exécute à chaque ajout/retrait/ouverture),
 * on demande la permission « macros distantes » du MJ avant d'y toucher.
 */

import { assertScriptAllowed } from "../policy.mjs";

const IP_ID = "item-piles";

// Miroir de CONFIG_KEYS (src/tools/prep_family/item_piles.rs) : sans `macro`.
// prettier-ignore
const CONFIG_KEYS = new Set([
  "type", "distance", "deleteWhenEmpty", "canStackItems", "canInspectItems",
  "displayItemTypes", "description", "overrideItemFilters", "overrideCurrencies",
  "overrideSecondaryCurrencies", "requiredItemProperties",
  "displayOne", "showItemName", "overrideSingleItemScale", "singleItemScale",
  "shareItemsEnabled", "shareCurrenciesEnabled", "takeAllEnabled", "splitAllEnabled", "activePlayers",
  "closed", "locked", "closedImage", "emptyImage", "openedImage", "lockedImage",
  "closeSound", "openSound", "lockedSound", "unlockedSound",
  "merchantImage", "infiniteQuantity", "infiniteCurrencies", "purchaseOnly", "hideNewItems",
  "hideItemsWithZeroCost", "keepZeroQuantity", "onlyAcceptBasePrice", "displayQuantity",
  "buyPriceModifier", "sellPriceModifier", "itemTypePriceModifiers", "tablesForPopulate",
  "hideTokenWhenClosed", "openTimes", "closedDays", "refreshItemsOnOpen", "logMerchantActivity",
  "cols", "rows", "restrictVaultAccess", "vaultExpansion", "baseExpansionCols", "baseExpansionRows",
  "logVaultActions",
]);
const PILE_TYPES = ["pile", "container", "merchant", "vault"];

/** API du module, ou erreur claire s'il n'est pas actif / pas configuré. */
function ipApi() {
  if (!game.modules.get(IP_ID)?.active) throw new Error("Item Piles (item-piles) is not active in this world");
  const api = game.itempiles?.API;
  if (!api) throw new Error("Item Piles is active but its API (game.itempiles.API) is not ready yet — reload the GM's browser");
  const currencies = game.settings.get(IP_ID, "currencies") ?? [];
  const qty = game.settings.get(IP_ID, "itemQuantityAttribute");
  if (!currencies.length || !qty) {
    throw new Error(
      `Item Piles is active but not configured for the « ${game.system.id} » system (no currencies or no item quantity attribute). ` +
        "Install its integration module (dnd5e: itempilesdnd5e; starwarsffg: maersk-aerospace/FoundryVTT-ItemPiles-StarWarsFFG) " +
        "or configure Item Piles by hand in its module settings — see ip_status."
    );
  }
  return api;
}

/** `false` renvoyé par l'API = échec silencieux du module → erreur explicite. */
function check(result, what) {
  if (result === false) {
    throw new Error(
      `${what} failed: Item Piles returned false (a pre-hook cancelled it, the target is not valid for this action, or no GM could execute it) — see the GM console`
    );
  }
  return result;
}

/** Une cible : UUID d'acteur ou de token, id ou nom d'acteur du monde. */
function resolveTarget(ref) {
  if (typeof ref !== "string" || !ref.trim()) throw new Error("uuid is required");
  const doc = fromUuidSync(ref, { strict: false }) ?? game.actors.get(ref) ?? game.actors.getName(ref);
  if (!doc) throw new Error(`pile « ${ref} » not found (Actor UUID, token UUID Scene.s.Token.t, or actor id/name)`);
  if (doc instanceof TokenDocument || doc instanceof Actor) return doc;
  if (doc.document instanceof TokenDocument) return doc.document;
  throw new Error(`« ${ref} » is a ${doc.documentName ?? typeof doc}, not an actor or token`);
}

function requirePile(api, target) {
  if (!api.isValidItemPile(target)) {
    throw new Error(
      `« ${target.name} » is not an Item Piles pile — create one with client_ip_create_pile or convert a token with client_ip_turn_into_pile`
    );
  }
}

/** La pile a-t-elle une macro ? Item Piles l'exécute à chaque interaction :
 * même politique que les macros distantes du compagnon. */
async function assertPileMacroAllowed(api, target) {
  const macro = api.getActorFlagData(target)?.macro;
  if (!macro) return;
  await assertScriptAllowed({
    setting: "runMacroScriptMode",
    source: `Item Piles pile « ${target.name} » runs macro: ${macro}`,
    title: game.i18n.localize("MCPCOMPANION.RunScriptConfirmTitle"),
    body: `A remote MCP client wants to change the Item Piles pile « ${target.name} », which runs a macro on every change.`,
    disabled: `the pile « ${target.name} » has a macro (${macro}) that Item Piles runs on this change — a Gamemaster must allow remote script-macro execution in the companion's settings, or remove the macro from the pile.`,
    declined: "pile change declined by the Gamemaster (the pile has a macro)",
  });
}

/** Liste blanche des réglages (défense en profondeur : la passerelle valide aussi). */
async function cleanConfig(config = {}) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) throw new Error("config must be an object");
  const out = {};
  for (const [k, v] of Object.entries(config)) {
    if (k === "macro") throw new Error("config.macro is refused: a pile macro is code run in the GM's browser — attach it in Foundry");
    if (!CONFIG_KEYS.has(k)) throw new Error(`config.${k} is not a supported Item Piles setting`);
    out[k] = v;
  }
  if (out.type !== undefined && !PILE_TYPES.includes(out.type)) throw new Error(`config.type must be one of ${PILE_TYPES.join(", ")}`);
  if (Array.isArray(out.tablesForPopulate)) {
    const tables = [];
    for (const [i, t] of out.tablesForPopulate.entries()) {
      const table = (await fromUuid(t?.uuid ?? "").catch(() => null)) ?? game.tables.get(t?.uuid) ?? game.tables.getName(t?.uuid);
      if (!(table instanceof RollTable)) throw new Error(`config.tablesForPopulate[${i}]: RollTable « ${t?.uuid} » not found`);
      tables.push({
        uuid: table.uuid,
        addAll: !!t.addAll,
        timesToRoll: String(t.timesToRoll ?? "1"),
        items: t.items ?? {},
        customCategory: typeof t.customCategory === "string" ? t.customCategory : "",
      });
    }
    out.tablesForPopulate = tables;
  }
  return out;
}

/** Chaîne de monnaies validée contre les abréviations configurées (Item Piles
 * ignore EN SILENCE les inconnues : « 50po » n'ajouterait rien). */
function currencyString(api, str) {
  if (str === undefined || str === null || str === "") return null;
  if (typeof str !== "string") throw new Error("currencies must be a string like \"50gp 3sp\"");
  const known = [...(api.CURRENCIES ?? []), ...(api.SECONDARY_CURRENCIES ?? [])]
    .map((c) => String(c.abbreviation ?? "").toLowerCase().replace("{#}", "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const compact = str.split(",").join("").split(" ").join("").toLowerCase();
  let rest = compact;
  for (const id of known) rest = rest.split(id).join("|");
  // Ce qui reste hors abréviations doit être des quantités (nombres ou dés).
  const leftovers = rest.split("|").filter((s) => s && !/^[0-9d+\-*/().]+$/.test(s));
  const hasAny = known.some((id) => compact.includes(id));
  if (!hasAny || leftovers.length || !/[|]$/.test(rest)) {
    throw new Error(`currencies « ${str} » not understood — use the configured abbreviations: ${known.join(", ")} (e.g. "50${known[0] ?? "gp"}")`);
  }
  return str;
}

/** Objets à ajouter : copies d'Items (monde ou compendium) + quantité/drapeaux. */
async function loadItems(list = []) {
  const out = [];
  for (const [i, entry] of list.entries()) {
    const item = await fromUuid(entry?.uuid ?? "");
    if (!(item instanceof Item)) throw new Error(`items[${i}]: no Item with UUID « ${entry?.uuid} »`);
    const data = item.toObject();
    delete data._id;
    if (foundry.utils.getProperty(data, "flags.item-piles.item.macro")) {
      await assertScriptAllowed({
        setting: "runMacroScriptMode",
        source: `Item « ${item.name} » carries an Item Piles macro: ${foundry.utils.getProperty(data, "flags.item-piles.item.macro")}`,
        title: game.i18n.localize("MCPCOMPANION.RunScriptConfirmTitle"),
        body: `A remote MCP client wants to add « ${item.name} », which carries an Item Piles macro.`,
        disabled: `the item « ${item.name} » carries an Item Piles macro — a Gamemaster must allow remote script-macro execution in the companion's settings.`,
        declined: "item addition declined by the Gamemaster (the item has a macro)",
      });
    }
    const itemFlags = {};
    if (entry.hidden !== undefined) itemFlags.hidden = !!entry.hidden;
    if (entry.not_for_sale !== undefined) itemFlags.notForSale = !!entry.not_for_sale;
    if (entry.infinite_quantity !== undefined) itemFlags.infiniteQuantity = entry.infinite_quantity ? "yes" : "no";
    if (entry.free !== undefined) itemFlags.free = !!entry.free;
    const row = { item: data, quantity: Number(entry.quantity ?? 1) };
    if (Object.keys(itemFlags).length) row.flags = { "item-piles": { item: itemFlags } };
    out.push(row);
  }
  return out;
}

/** Le contenu effectif relu par l'API (ce que les joueurs verront). */
function summary(api, target) {
  const flags = api.getActorFlagData(target) ?? {};
  const actor = target instanceof TokenDocument ? target.actor : target;
  const cfg = {};
  for (const k of ["enabled", "type", "closed", "locked", "deleteWhenEmpty", "buyPriceModifier", "sellPriceModifier", "infiniteQuantity", "actorPriceModifiers", "tablesForPopulate", "shareItemsEnabled", "displayOne"]) {
    if (flags[k] !== undefined) cfg[k] = flags[k];
  }
  cfg.hasMacro = !!flags.macro;
  return {
    uuid: target.uuid,
    actorUuid: actor?.uuid ?? null,
    name: target.name,
    config: cfg,
    items: api.getActorItems(target).map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      quantity: api.getItemQuantity(i),
      hidden: !!i.getFlag?.(IP_ID, "item")?.hidden,
    })),
    currencies: api.getActorCurrencies(target, { getAll: false }).map((c) => ({
      name: game.i18n.localize(c.name ?? ""),
      abbreviation: c.abbreviation,
      quantity: c.quantity,
    })),
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Résultat de addItems/rollItemTable → résumé lisible. */
const deltas = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .map((r) => ({ name: r?.item?.name ?? null, id: r?.item?._id ?? r?.item?.id ?? null, quantity: r?.quantity ?? null }))
    // removeExistingActorItems glisse des lignes de suppression sans objet.
    .filter((r) => r.name !== null && !(r.quantity < 0));

/** Tokens d'une scène (vue par le MJ par défaut). */
function sceneTokens(sceneId, ids) {
  const scene = sceneId ? game.scenes.get(sceneId) : game.scenes.get(game.user.viewedScene) ?? canvas?.scene;
  if (!scene) throw new Error(sceneId ? `scene ${sceneId} not found` : "the GM is not viewing any scene — pass scene_id");
  if (!Array.isArray(ids) || !ids.length) throw new Error("token_ids is required");
  return ids.map((id) => {
    const t = scene.tokens.get(id);
    if (!t) throw new Error(`token ${id} not found on scene « ${scene.name} »`);
    return t;
  });
}

export const ITEM_PILES_HANDLERS = {
  async ip_create_pile({ type, name, x, y, scene_id, img, linked = true, folder, items, currencies, config }) {
    const api = ipApi();
    if (!PILE_TYPES.includes(type)) throw new Error(`type must be one of ${PILE_TYPES.join(", ")}`);
    if (!name) throw new Error("name is required");
    const pileFlags = { deleteWhenEmpty: false, ...(await cleanConfig(config ?? {})), type };
    const cur = currencyString(api, currencies);
    const toAdd = await loadItems(items ?? []);
    const withToken = typeof x === "number" && typeof y === "number";
    const sceneId = scene_id ?? game.user.viewedScene ?? canvas?.scene?.id;
    if (withToken && !game.scenes.get(sceneId)) {
      throw new Error(scene_id ? `scene ${scene_id} not found` : "the GM is not viewing any scene — pass scene_id");
    }
    const tokenOverrides = { name, actorLink: !!linked };
    if (img) tokenOverrides.texture = { src: img };
    const created = check(
      await api.createItemPile({
        position: withToken ? { x, y } : false,
        sceneId: withToken ? sceneId : undefined,
        createActor: true,
        actor: name,
        itemPileFlags: pileFlags,
        tokenOverrides,
        actorOverrides: img ? { img } : {},
        folders: folder ? [folder] : false,
      }),
      "createItemPile"
    );
    const target = resolveTarget(created.tokenUuid ?? created.actorUuid);
    let added = [];
    if (toAdd.length) added = deltas(check(await api.addItems(target, toAdd), "addItems"));
    if (cur) check(await api.addCurrencies(target, cur), "addCurrencies");
    // Les mises à jour d'un token non lié arrivent par socket : laisser le
    // document se resynchroniser avant de relire.
    await wait(300);
    return { tokenUuid: created.tokenUuid ?? null, actorUuid: created.actorUuid, added, pile: summary(api, resolveTarget(target.uuid)) };
  },

  async ip_add_items({ uuid, items, currencies }) {
    const api = ipApi();
    const target = resolveTarget(uuid);
    requirePile(api, target);
    const cur = currencyString(api, currencies);
    const toAdd = await loadItems(items ?? []);
    if (!toAdd.length && !cur) throw new Error("nothing to do: give items and/or currencies");
    await assertPileMacroAllowed(api, target);
    let added = [];
    if (toAdd.length) added = deltas(check(await api.addItems(target, toAdd), "addItems"));
    if (cur) check(await api.addCurrencies(target, cur), "addCurrencies");
    await wait(200);
    return { added, currenciesAdded: cur, pile: summary(api, resolveTarget(uuid)) };
  },

  async ip_remove_items({ uuid, items, currencies, change = true }) {
    const api = ipApi();
    const target = resolveTarget(uuid);
    requirePile(api, target);
    const cur = currencyString(api, currencies);
    const actorItems = api.getActorItems(target);
    const toRemove = (items ?? []).map((e, i) => {
      const found = e.id ? actorItems.find((it) => it.id === e.id) : actorItems.filter((it) => it.name === e.name);
      if (Array.isArray(found) && found.length > 1) throw new Error(`items[${i}]: several items are named « ${e.name} » — pass the id (ip_get_pile)`);
      const item = Array.isArray(found) ? found[0] : found;
      if (!item) throw new Error(`items[${i}]: « ${e.id ?? e.name} » is not in the pile`);
      const have = api.getItemQuantity(item);
      if (e.quantity !== undefined && e.quantity > have) throw new Error(`items[${i}]: the pile only holds ${have} × « ${item.name} »`);
      return { _id: item.id, quantity: e.quantity ?? have };
    });
    if (!toRemove.length && !cur) throw new Error("nothing to do: give items and/or currencies");
    await assertPileMacroAllowed(api, target);
    let removed = [];
    if (toRemove.length) removed = deltas(check(await api.removeItems(target, toRemove), "removeItems"));
    if (cur) check(await api.removeCurrencies(target, cur, { change: !!change }), "removeCurrencies");
    await wait(200);
    return { removed, currenciesRemoved: cur, pile: summary(api, resolveTarget(uuid)) };
  },

  async ip_configure_pile({ uuid, config, price_modifiers }) {
    const api = ipApi();
    const target = resolveTarget(uuid);
    requirePile(api, target);
    const clean = config ? await cleanConfig(config) : null;
    // Ouvrir/fermer/verrouiller exécute la macro de la pile.
    if (clean && ("closed" in clean || "locked" in clean)) await assertPileMacroAllowed(api, target);
    if (clean && Object.keys(clean).length) check(await api.updateItemPile(target, clean), "updateItemPile");
    if (Array.isArray(price_modifiers) && price_modifiers.length) {
      if (!api.isItemPileMerchant(target) && clean?.type !== "merchant") throw new Error("price_modifiers only apply to a merchant");
      const rows = price_modifiers.map((m, i) => {
        const actor = fromUuidSync(m.actor_uuid ?? "", { strict: false });
        if (!(actor instanceof Actor)) throw new Error(`price_modifiers[${i}]: no Actor « ${m.actor_uuid} »`);
        const row = { actorUuid: actor.uuid, relative: !!m.relative, override: !!m.override };
        if (typeof m.buy === "number") row.buyPriceModifier = m.buy;
        if (typeof m.sell === "number") row.sellPriceModifier = m.sell;
        return row;
      });
      await wait(100);
      check(await api.updateMerchantPriceModifiers(resolveTarget(uuid), rows), "updateMerchantPriceModifiers");
    }
    await wait(200);
    return { pile: summary(api, resolveTarget(uuid)) };
  },

  async ip_turn_into_pile({ token_ids, scene_id, config }) {
    const api = ipApi();
    const tokens = sceneTokens(scene_id, token_ids);
    const pileSettings = { deleteWhenEmpty: false, ...(await cleanConfig(config ?? {})) };
    const uuids = check(await api.turnTokensIntoItemPiles(tokens, { pileSettings }), "turnTokensIntoItemPiles");
    await wait(200);
    return { tokens: (uuids ?? []).map((u) => summary(api, resolveTarget(u))) };
  },

  async ip_revert_pile({ token_ids, scene_id }) {
    const api = ipApi();
    const tokens = sceneTokens(scene_id, token_ids);
    tokens.forEach((t) => requirePile(api, t));
    const uuids = check(await api.revertTokensFromItemPiles(tokens), "revertTokensFromItemPiles");
    await wait(200);
    return { tokens: (uuids ?? []).map((u) => ({ uuid: u, isPile: api.isValidItemPile(resolveTarget(u)) })) };
  },

  async ip_restock({ uuid, table, times_to_roll, remove_existing }) {
    const api = ipApi();
    const target = resolveTarget(uuid);
    requirePile(api, target);
    await assertPileMacroAllowed(api, target);
    let rows;
    if (table) {
      rows = await api.rollItemTable(table, {
        timesToRoll: times_to_roll ?? "1",
        targetActor: target instanceof TokenDocument ? target.actor : target,
        removeExistingActorItems: !!remove_existing,
        displayChat: false,
      });
      check(rows, "rollItemTable");
    } else {
      if (!api.isItemPileMerchant(target)) throw new Error("without `table`, only a merchant can be refreshed (from its tablesForPopulate)");
      if (!(api.getActorFlagData(target)?.tablesForPopulate ?? []).length) {
        throw new Error("this merchant has no population tables — set config.tablesForPopulate with client_ip_configure_pile, or pass `table`");
      }
      rows = check(await api.refreshMerchantInventory(target, { removeExistingActorItems: remove_existing ?? true }), "refreshMerchantInventory");
    }
    await wait(200);
    return { added: deltas(rows), pile: summary(api, resolveTarget(uuid)) };
  },
};
