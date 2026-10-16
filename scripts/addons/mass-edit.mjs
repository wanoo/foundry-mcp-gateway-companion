/**
 * Mass Edit — presets (game.modules.get('multi-token-edit').api) — handlers client-side.
 * Fusionné dans UNIQUE_HANDLERS par scripts/main.mjs.
 *
 * Modèle de Mass Edit 3.3.x (relevé dans le code du module) :
 *   · un preset = un JournalEntry d'un compendium « géré » (qui contient le
 *     document `MassEditMetaData`, index {id: {img, documentName, tags}}) ;
 *     données dans flags["multi-token-edit"].preset = {documentName, data[],
 *     attached[{documentName, data}], tags, img, preSpawnScript,
 *     postSpawnScript, …} ;
 *   · pack de travail : réglage `multi-token-edit.workingPack` (défaut
 *     `world.mass-edit-presets-main`, créé par l'UI au premier usage) ;
 *   · l'index n'est mis à jour QUE par le client auteur de l'écriture : on crée
 *     donc les presets ici, dans le navigateur du MJ, jamais côté serveur ;
 *   · spawnPreset aimante sur la scène AFFICHÉE, même si sceneId diffère : on
 *     ne pose que sur la scène que ce client regarde.
 */

import { assertScriptAllowed, matActionsNeed } from "../policy.mjs";

const ME_ID = "multi-token-edit";
const META_INDEX_ID = "MassEditMetaData";
const DEFAULT_PACK = "world.mass-edit-presets-main";
const PLACEABLES = ["Token", "Tile", "Drawing", "Wall", "AmbientLight", "AmbientSound", "Note", "Region"];
const TYPE_ALIASES = {
  token: "Token", tile: "Tile", drawing: "Drawing", wall: "Wall",
  ambientlight: "AmbientLight", light: "AmbientLight", ambientsound: "AmbientSound", sound: "AmbientSound",
  note: "Note", region: "Region", scene: "Scene", fauxscene: "FauxScene", bag: "Bag", actor: "Actor",
};
const PIVOTS = ["TOP_LEFT", "TOP", "TOP_RIGHT", "LEFT", "CENTER", "RIGHT", "BOTTOM_LEFT", "BOTTOM", "BOTTOM_RIGHT"];

function meApi() {
  const mod = game.modules.get(ME_ID);
  if (!mod?.active) throw new Error("Mass Edit (multi-token-edit) is not active in this world");
  const api = mod.api ?? globalThis.MassEdit;
  if (typeof api?.getPresets !== "function") throw new Error("Mass Edit API (getPresets) is not available");
  return api;
}

const canonType = (t) => TYPE_ALIASES[String(t ?? "").trim().toLowerCase().replace(/[\s_-]/g, "")] ?? String(t ?? "").trim();

function tagList(raw) {
  if (raw === null || raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  return list.map((t) => String(t).trim()).filter(Boolean);
}

/** La requête Mass Edit à lancer. `query` ne se combine PAS avec name/tags/types
 * (le module lève alors une exception muette) : on le refuse clairement, et on
 * compose nous-mêmes la requête sinon — nom entre guillemets (sous-chaîne
 * exacte, insensible à la casse), `#tag`, `@Type` — reliés par ET. */
function buildQuery({ query, name, tags, types } = {}) {
  const tagArr = tagList(tags);
  const typeArr = (Array.isArray(types) ? types : types ? [types] : []).map(canonType).filter(Boolean);
  const q = typeof query === "string" ? query.trim() : "";
  if (q && (name || tagArr.length || typeArr.length)) {
    throw new Error(
      "query cannot be combined with name/tags/types (Mass Edit rejects it) — put everything in the query, e.g. \"lamp #tavern @AmbientLight\""
    );
  }
  if (q) return q;
  const parts = [];
  const n = String(name ?? "").replace(/"/g, " ").trim();
  if (n) parts.push(`"${n}"`);
  tagArr.forEach((t) => parts.push(`#${t.replace(/\s+/g, "-")}`));
  typeArr.forEach((t) => parts.push(`@${t}`));
  if (!parts.length) throw new Error("Provide uuid, query, or name/tags/types");
  return parts.join(" ");
}

/** Tuiles d'un preset (principales et attachées). */
function presetTiles(p) {
  const data = Array.isArray(p.data) ? p.data : [];
  const out = p.documentName === "Tile" ? [...data] : [];
  (Array.isArray(p.attached) ? p.attached : []).forEach((a) => {
    if (a?.documentName === "Tile") out.push(a.data);
  });
  return out.filter(Boolean);
}

/** Tous les documents d'un preset, avec leur type. */
function presetDocs(p) {
  const main = (Array.isArray(p.data) ? p.data : []).map((d) => ({ documentName: p.documentName, data: d }));
  const att = (Array.isArray(p.attached) ? p.attached : []).map((a) => ({ documentName: a?.documentName, data: a?.data }));
  return [...main, ...att].filter((x) => x.data && typeof x.data === "object");
}

const matActions = (d) => d?.flags?.["monks-active-tiles"]?.actions;
const hasScripts = (p) => Boolean(String(p.preSpawnScript ?? "").trim() || String(p.postSpawnScript ?? "").trim());

/** Ce que des données de placeables exigent pour être posées : [{setting, reasons}].
 * Même périmètre que le garde-fou de la passerelle (script_guard.rs) : tuiles
 * MAT, comportements de Region executeScript/executeMacro, macros Item Piles. */
function dataCodeNeeds(docs) {
  const script = [];
  const macro = [];
  docs.forEach(({ documentName, data }, i) => {
    const label = `${documentName} #${i}${data.name ? ` « ${data.name} »` : ""}`;
    const actions = matActions(data);
    if (Array.isArray(actions) && actions.length) {
      const need = matActionsNeed(actions);
      if (need?.setting === "runScriptMode") script.push(...need.reasons.map((r) => `${label} (Active Tiles): ${r}`));
      else if (need) macro.push(...need.reasons.map((r) => `${label} (Active Tiles): ${r}`));
    }
    (Array.isArray(data.behaviors) ? data.behaviors : []).forEach((b) => {
      if (b?.type === "executeScript") script.push(`${label}: region behavior « executeScript »`);
      else if (b?.type === "executeMacro") macro.push(`${label}: region behavior « executeMacro »`);
    });
    const ip = data.flags?.["item-piles"]?.data;
    if (ip?.macro || ip?.item?.macro) macro.push(`${label}: Item Piles macro`);
  });
  const out = [];
  if (script.length) out.push({ setting: "runScriptMode", reasons: script });
  if (macro.length) out.push({ setting: "runMacroScriptMode", reasons: macro });
  return out;
}

function packOf(uuid) {
  if (typeof uuid !== "string") return null;
  if (uuid.startsWith("virtual@")) return "virtual";
  const m = uuid.match(/^Compendium\.([^.]+\.[^.]+)\./);
  return m ? m[1] : null;
}

function summarize(p) {
  const data = Array.isArray(p.data) ? p.data : [];
  const attached = Array.isArray(p.attached) ? p.attached : [];
  return {
    uuid: p.uuid ?? null,
    name: p.name ?? null,
    documentName: p.documentName ?? null,
    tags: Array.isArray(p.tags) ? p.tags : [],
    img: p.img ?? null,
    pack: packOf(p.uuid),
    elements: data.length,
    attached: attached.length,
    hasScripts: hasScripts(p),
    hasActiveTiles: presetTiles(p).some((t) => Array.isArray(matActions(t)) && matActions(t).length > 0),
    spawnRandom: Boolean(p.spawnRandom),
    modifyOnSpawn: Array.isArray(p.modifyOnSpawn) ? p.modifyOnSpawn.length > 0 : false,
  };
}

/** Presets correspondant aux critères, CHARGÉS (data, scripts). */
async function findPresets(api, { uuid, query, name, tags, types, include_files = false } = {}) {
  if (uuid) {
    const found = (await api.getPresets({ uuid, load: true })).filter(Boolean);
    if (!found.length) throw new Error(`No preset with uuid ${uuid}`);
    return found;
  }
  const q = buildQuery({ query, name, tags, types });
  const found = await api.getPresets({ query: q, load: false, virtualDirectory: Boolean(include_files), externalCompendiums: true });
  return { query: q, presets: (found ?? []).filter(Boolean) };
}

async function loadAll(api, presets) {
  const uuids = presets.map((p) => p.uuid).filter(Boolean);
  if (!uuids.length) return [];
  return (await api.getPresets({ uuid: uuids, load: true })).filter(Boolean);
}

function viewedScene(scene) {
  if (!canvas?.ready || !canvas.scene) throw new Error("The Gamemaster client has no scene on its canvas — open the target scene in the GM browser first");
  if (scene) {
    const s = game.scenes.get(scene) ?? game.scenes.getName(scene);
    if (!s) throw new Error(`Scene not found: ${scene}`);
    if (s.id !== canvas.scene.id) {
      throw new Error(
        `Mass Edit can only place presets on the scene the Gamemaster is viewing (« ${canvas.scene.name} », ${canvas.scene.id}), ` +
          `not on « ${s.name} »: it snaps and resolves levels against the displayed canvas. View that scene first (activate_scene / pull_users_to_scene).`
      );
    }
  }
  return canvas.scene;
}

/** Garde avant de poser : scripts du preset et code porté par ses données. */
async function assertPresetAllowed(p) {
  const label = p.name ?? p.uuid ?? "preset";
  if (hasScripts(p)) {
    const source = [
      p.preSpawnScript ? `// preSpawnScript\n${p.preSpawnScript}` : "",
      p.postSpawnScript ? `// postSpawnScript\n${p.postSpawnScript}` : "",
    ].filter(Boolean).join("\n\n");
    await assertScriptAllowed({
      setting: "runScriptMode",
      source,
      title: game.i18n.localize("MCPCOMPANION.RunScriptConfirmTitle"),
      body: game.i18n.format("MCPCOMPANION.PresetScriptConfirmBody", { name: label }),
      disabled: `the Mass Edit preset « ${label} » has a pre/post-spawn script — a Gamemaster must allow remote script execution in this module's settings before it can be placed remotely.`,
      declined: "preset placement declined by the Gamemaster",
    });
  }
  for (const need of dataCodeNeeds(presetDocs(p))) {
    await assertScriptAllowed({
      setting: need.setting,
      source: need.reasons.join("\n"),
      title: game.i18n.localize("MCPCOMPANION.RunScriptConfirmTitle"),
      body: game.i18n.format("MCPCOMPANION.PresetCodeConfirmBody", { name: label }),
      disabled: `the Mass Edit preset « ${label} » contains placeables that can run code (${need.reasons.join("; ")}) — a Gamemaster must allow ${need.setting === "runScriptMode" ? "remote script" : "remote script-macro"} execution in this module's settings.`,
      declined: "preset placement declined by the Gamemaster",
    });
  }
}

/** Pack de travail utilisable, créé proprement si c'est le pack par défaut. */
async function ensureWorkingPack(api, packId) {
  const working = game.settings.get(ME_ID, "workingPack") || DEFAULT_PACK;
  const id = packId || working;
  let pack = game.packs.get(id);
  let created = false;
  if (!pack?.index?.get(META_INDEX_ID)) {
    if (pack && id !== DEFAULT_PACK) {
      throw new Error(
        `Compendium ${id} is not a Mass Edit preset pack (no ${META_INDEX_ID} document) — pick a preset pack, or make it one from the Preset Browser.`
      );
    }
    if (!pack && id !== DEFAULT_PACK) {
      throw new Error(
        `Mass Edit working pack ${id} does not exist — set another working pack in the Preset Browser, or pass pack:"${DEFAULT_PACK}".`
      );
    }
    if (typeof api.recoverPresetIndex !== "function") throw new Error("Mass Edit recoverPresetIndex is not available");
    // _initCompendium : crée le pack par défaut et/ou son document
    // MassEditMetaData — exactement ce que fait le navigateur de presets au
    // premier affichage — puis réindexe ce qu'il contiendrait déjà.
    created = !pack;
    await api.recoverPresetIndex(id);
    pack = game.packs.get(id);
    if (!pack?.index?.get(META_INDEX_ID)) throw new Error(`Could not initialise the Mass Edit preset pack ${id}`);
  }
  if (pack.locked) throw new Error(`Compendium ${id} is locked — unlock it to add presets`);
  if (pack.documentName !== "JournalEntry") throw new Error(`Compendium ${id} is not a JournalEntry pack`);
  return { pack, created };
}

export const MASS_EDIT_HANDLERS = {
  // ------------------------------------------------------------- recherche
  async me_find_presets({ uuid, query, name, tags, types, include_files = false, limit = 50 } = {}) {
    const api = meApi();
    const max = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));
    if (uuid) {
      const presets = await findPresets(api, { uuid });
      return { total: presets.length, returned: presets.length, presets: presets.map(summarize) };
    }
    const { query: q, presets } = await findPresets(api, { query, name, tags, types, include_files });
    presets.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const page = presets.slice(0, max);
    const loaded = await loadAll(api, page.filter((p) => !p.virtual));
    const byUuid = new Map(loaded.map((p) => [p.uuid, p]));
    return {
      query: q,
      total: presets.length,
      returned: page.length,
      truncated: presets.length > page.length,
      presets: page.map((p) => summarize(byUuid.get(p.uuid) ?? p)),
    };
  },

  // ------------------------------------------------------------------ pose
  async me_spawn_preset({ uuid, query, name, tags, types, random = false, x, y, scene, hidden = false, snap_to_grid = true, scale_to_grid = false, pivot = "TOP_LEFT" } = {}) {
    const api = meApi();
    if (typeof api.spawnPreset !== "function") throw new Error("Mass Edit spawnPreset is not available");
    const px = Number(x);
    const py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error("x and y (canvas pixels) are required");
    const piv = String(pivot ?? "TOP_LEFT").toUpperCase();
    if (!PIVOTS.includes(piv)) throw new Error(`pivot must be one of ${PIVOTS.join(", ")}`);
    const target = viewedScene(scene);

    let preset;
    if (uuid) {
      preset = (await findPresets(api, { uuid }))[0];
    } else {
      const { query: q, presets } = await findPresets(api, { query, name, tags, types });
      let pool = presets;
      if (!pool.length) throw new Error(`No preset matches ${q}`);
      if (pool.length > 1 && name && !query) {
        const exact = pool.filter((p) => String(p.name).toLowerCase() === String(name).trim().toLowerCase());
        if (exact.length === 1 || (exact.length > 1 && random)) pool = exact;
      }
      if (pool.length > 1 && !random) {
        const list = pool.slice(0, 10).map((p) => `« ${p.name} » (${p.uuid})`).join(", ");
        throw new Error(`${pool.length} presets match ${q}: ${list}${pool.length > 10 ? ", …" : ""} — pass a uuid, narrow the search, or random:true`);
      }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      preset = (await loadAll(api, [pick]))[0] ?? pick;
    }
    if (!preset) throw new Error("Preset not found");
    if (!preset._loaded && typeof preset.load === "function") await preset.load();
    if (!PLACEABLES.includes(preset.documentName)) {
      throw new Error(`Preset « ${preset.name} » is a ${preset.documentName} preset, not a placeable one — it cannot be placed on a scene`);
    }

    // AVANT toute pose : les scripts du preset et le code de ses placeables.
    await assertPresetAllowed(preset);

    const docs = await api.spawnPreset({
      preset,
      x: px,
      y: py,
      sceneId: target.id,
      hidden: Boolean(hidden),
      snapToGrid: snap_to_grid !== false,
      scaleToGrid: Boolean(scale_to_grid),
      pivot: piv,
      modifyPrompt: false,
      preview: false,
      layerSwitch: false,
    });
    if (!Array.isArray(docs)) throw new Error("Spawn cancelled (a MassEdit.spawnPreset hook returned false)");
    return {
      preset: { uuid: preset.uuid, name: preset.name, documentName: preset.documentName },
      scene: { id: target.id, name: target.name },
      created: docs.map((d) => ({
        documentName: d.documentName,
        id: d.id,
        name: d.name ?? d.text ?? null,
        x: d.x ?? null,
        y: d.y ?? null,
        hidden: d.hidden ?? null,
      })),
    };
  },

  // ---------------------------------------------------------------- création
  async me_create_preset({ document_name, ids, attached, name, tags, img, pack } = {}) {
    const api = meApi();
    if (typeof api.createPresetFromPlaceable !== "function") throw new Error("Mass Edit createPresetFromPlaceable is not available");
    const scene = viewedScene();
    const type = canonType(document_name);
    if (!PLACEABLES.includes(type)) throw new Error(`document_name must be one of ${PLACEABLES.join(", ")}`);
    const idList = Array.isArray(ids) ? ids.map(String) : ids ? [String(ids)] : [];
    if (!idList.length) throw new Error("ids: at least one placeable id is required");
    const presetName = String(name ?? "").trim();
    if (!presetName) throw new Error("name is required");

    const get = (t, id) => {
      const coll = scene.getEmbeddedCollection(t);
      const d = coll?.get(id);
      if (!d) throw new Error(`${t} ${id} not found on the viewed scene « ${scene.name} »`);
      return d;
    };
    const mainDocs = idList.map((id) => get(type, id));
    const attDocs = (Array.isArray(attached) ? attached : []).map((a) => {
      const t = canonType(a?.document_name ?? a?.documentName);
      if (!PLACEABLES.includes(t)) throw new Error(`attached document_name must be one of ${PLACEABLES.join(", ")}`);
      return get(t, String(a?.id ?? ""));
    });

    // Un preset qui porterait du code serait exécuté par quiconque le pose.
    const needs = dataCodeNeeds([...mainDocs, ...attDocs].map((d) => ({ documentName: d.documentName, data: d.toObject() })));
    if (needs.length) {
      throw new Error(
        `refused: these placeables can run code (${needs.flatMap((n) => n.reasons).join("; ")}) — a preset made from them would run it on every spawn. Create it from the Preset Browser if you really mean it.`
      );
    }

    const { pack: target, created: packCreated } = await ensureWorkingPack(api, pack);
    const options = { name: presetName, pack: target.collection };
    const tagArr = tagList(tags).map((t) => t.slugify({ strict: true })).filter(Boolean);
    if (tagArr.length) options.tags = tagArr;
    if (img) options.img = String(img);
    if (attDocs.length) options.attached = attDocs.map((d) => ({ documentName: d.documentName, data: d.toObject() }));

    const presets = (await api.createPresetFromPlaceable(mainDocs.map((d) => ({ document: d })), options)) ?? [];
    if (!presets.length) throw new Error("Mass Edit did not create the preset");

    // L'index MassEditMetaData est mis à jour en différé par le hook du
    // module : on l'attend, sinon une recherche immédiate ne le verrait pas.
    const ids2 = presets.map((p) => p.id);
    let indexed = false;
    for (let i = 0; i < 30 && !indexed; i++) {
      const meta = await target.getDocument(META_INDEX_ID);
      const idx = meta?.getFlag(ME_ID, "index") ?? {};
      indexed = ids2.every((id) => id in idx);
      if (!indexed) await new Promise((r) => setTimeout(r, 100));
    }
    return {
      pack: target.collection,
      packCreated,
      indexed,
      presets: presets.map(summarize),
    };
  },
};
