/**
 * Perception — ce que SEUL le navigateur sait, et que le protocole socket ne
 * pourra jamais donner :
 *   · get_derived : les valeurs PRÉPARÉES (prepareData + effets actifs), là où
 *     le serveur ne voit que le document source (stats à 0 sur bien des systèmes).
 *   · enrich : le HTML enrichi (@UUID résolus, jets inline, secrets).
 *   · search : la recherche sur l'index client (toutes collections).
 *   · capture : une image de la vue courante — l'IA voit la table.
 *   · scene_report : l'état jouable de la scène (tokens visibles, portes, lumières).
 * Fusionné dans UNIQUE_HANDLERS par scripts/main.mjs.
 */

/** v13 déplace TextEditor sous foundry.applications.ux ; v12 l'expose en global. */
function textEditor() {
  return foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
}

/** Les données PRÉPARÉES d'un document. `toObject(false)` renvoie l'état dérivé ;
 *  on retombe sur une copie JSON si le système n'utilise pas de DataModel. */
function derivedSystem(doc) {
  try {
    const prepared = doc.toObject(false);
    if (prepared?.system) return prepared.system;
  } catch (e) {
    /* systèmes sans DataModel : on passe au repli */
  }
  return doc.system ? JSON.parse(JSON.stringify(doc.system)) : null;
}

/** Une case de grille, plus lisible qu'un pixel pour raisonner sur la scène. */
function gridPos(x, y) {
  const size = canvas.grid?.size || 100;
  return { x, y, col: Math.floor(x / size), row: Math.floor(y / size) };
}

export const INSIGHT_HANDLERS = {
  // ------------------------------------------------------------- get_derived
  async get_derived({ uuid, items = false, effects = true }) {
    const doc = await fromUuid(uuid);
    if (!doc) throw new Error(`Document not found: ${uuid}`);
    const out = {
      uuid: doc.uuid,
      name: doc.name ?? null,
      type: doc.type ?? null,
      system: derivedSystem(doc),
    };
    if (effects && doc.effects) {
      // appliedEffects = ceux qui comptent réellement (v11+), effects = tous.
      const applied = new Set((doc.appliedEffects ?? []).map((e) => e.id));
      out.effects = doc.effects.map((e) => ({
        _id: e.id,
        name: e.name ?? e.label,
        disabled: e.disabled,
        applied: applied.has(e.id),
        changes: e.changes,
      }));
    }
    if (items && doc.items) {
      out.items = doc.items.map((i) => ({
        _id: i.id,
        name: i.name,
        type: i.type,
        system: derivedSystem(i),
      }));
    }
    return out;
  },

  // ------------------------------------------------------------------ enrich
  async enrich({ uuid, html, secrets = true }) {
    if (!uuid) {
      if (!html) throw new Error("nothing to enrich (give uuid or html)");
      return { enriched: await textEditor().enrichHTML(html, { secrets, rollData: {}, async: true }) };
    }
    const doc = await fromUuid(uuid);
    if (!doc) throw new Error(`Document not found: ${uuid}`);
    const rollData = doc.getRollData?.() ?? {};
    const enrich = (src) => textEditor().enrichHTML(src, { secrets, rollData, async: true });

    // Un JournalEntry ne porte pas de texte : ce sont ses PAGES qui en ont.
    if (doc.pages?.size) {
      const pages = [];
      for (const p of doc.pages) {
        pages.push({
          _id: p.id, name: p.name, type: p.type,
          enriched: p.text?.content ? await enrich(p.text.content) : null,
        });
      }
      return { name: doc.name, pages };
    }
    const source = doc.text?.content ?? doc.system?.description ?? doc.description ?? "";
    if (!source) throw new Error(`no text content on ${uuid}`);
    return { name: doc.name ?? null, enriched: await enrich(source) };
  },

  // ------------------------------------------------------------------ search
  async search({ query, types, limit = 25 }) {
    if (!query) throw new Error("'query' is required");
    const needle = query.toLowerCase();
    const collections = {
      Actor: game.actors, Item: game.items, JournalEntry: game.journal,
      Scene: game.scenes, RollTable: game.tables, Macro: game.macros,
      Cards: game.cards, Playlist: game.playlists,
    };
    const wanted = types?.length ? types : Object.keys(collections);
    const hits = [];
    for (const type of wanted) {
      for (const doc of collections[type] ?? []) {
        if (!doc.name?.toLowerCase().includes(needle)) continue;
        hits.push({
          uuid: doc.uuid, _id: doc.id, name: doc.name, documentType: type,
          type: doc.type ?? null, folder: doc.folder?.name ?? null,
        });
        if (hits.length >= limit) return { count: hits.length, truncated: true, hits };
      }
    }
    return { count: hits.length, truncated: false, hits };
  },

  // ----------------------------------------------------------------- capture
  // Image de la frame courante du renderer = exactement ce que le MJ voit.
  // Réduite avant encodage : elle transite par la socket Foundry.
  async capture({ max_width = 900, quality = 0.6 }) {
    const src = canvas.app?.renderer?.extract?.canvas(canvas.stage);
    if (!src) throw new Error("canvas not ready (no scene displayed?)");
    const scale = Math.min(1, max_width / src.width);
    const out = document.createElement("canvas");
    out.width = Math.round(src.width * scale);
    out.height = Math.round(src.height * scale);
    out.getContext("2d").drawImage(src, 0, 0, out.width, out.height);
    const dataUrl = out.toDataURL("image/webp", quality);
    return {
      scene: canvas.scene?.name ?? null,
      width: out.width,
      height: out.height,
      mimeType: "image/webp",
      base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    };
  },

  // ------------------------------------------------------------------ babele
  // La vue TRADUITE des compendiums (Babele) : le serveur lit la source (souvent
  // l'anglais), le joueur voit sa langue. Sans pack : liste des packs traduits.
  async babele({ pack, id, name, limit = 100 }) {
    const B = globalThis.Babele;
    if (!B?.get) throw new Error("babele module not active");
    const b = B.get();
    if (!pack) {
      const translated = game.packs.filter((p) => b.isTranslated(p.collection));
      return {
        version: game.modules.get("babele")?.version ?? null,
        count: translated.length,
        packs: translated.map((p) => p.collection),
      };
    }
    const compendium = game.packs.get(pack);
    if (!compendium) throw new Error(`Compendium not found: ${pack}`);
    if (!b.isTranslated(compendium.collection)) {
      return { pack, translated: false, hint: "source == displayed for this pack" };
    }
    // document complet traduit…
    if (id || name) {
      const index = await compendium.getIndex();
      const entry = id
        ? index.get(id)
        : [...index].find((e) => e.name === name);
      if (!entry) throw new Error(`Document not found in ${pack}: ${id ?? name}`);
      const doc = await compendium.getDocument(entry._id);
      return { pack, translated: true, document: b.translate(compendium.collection, doc.toObject(true)) };
    }
    // …ou l'index traduit (source → affiché).
    const index = [...(await compendium.getIndex())].slice(0, limit);
    const t = b.translateIndex(index, compendium.collection);
    return {
      pack, translated: true, count: index.length,
      index: index.map((e, i) => ({ _id: e._id, source: e.name, displayed: t[i]?.name ?? e.name })),
    };
  },

  // ------------------------------------------------------------ scene_report
  async scene_report({ include_walls = false }) {
    if (!canvas.scene) throw new Error("no active scene on this client");
    const tokens = canvas.tokens.placeables.map((t) => ({
      _id: t.id,
      name: t.document.name,
      actor: t.actor?.id ?? null,
      actorName: t.actor?.name ?? null,
      disposition: t.document.disposition, // -1 hostile · 0 neutre · 1 amical
      hidden: t.document.hidden,
      visible: t.visible, // réellement visible du client (vision/brouillard)
      ...gridPos(t.document.x, t.document.y),
      elevation: t.document.elevation,
    }));
    const report = {
      scene: { _id: canvas.scene.id, name: canvas.scene.name },
      grid: { size: canvas.grid?.size ?? null, distance: canvas.scene.grid?.distance ?? null,
              units: canvas.scene.grid?.units ?? null },
      tokens,
      counts: {
        tokens: tokens.length,
        visible: tokens.filter((t) => t.visible).length,
        hostile: tokens.filter((t) => t.disposition === -1).length,
      },
      doors: canvas.walls.placeables
        .filter((w) => w.document.door > 0)
        .map((w) => ({ _id: w.id, type: w.document.door, state: w.document.ds })),
      lights: canvas.lighting.placeables.map((l) => ({
        _id: l.id, hidden: l.document.hidden, ...gridPos(l.document.x, l.document.y),
      })),
      templates: canvas.templates.placeables.map((t) => ({
        _id: t.id, type: t.document.t, distance: t.document.distance,
        ...gridPos(t.document.x, t.document.y),
      })),
      controlled: canvas.tokens.controlled.map((t) => t.id),
      targeted: [...game.user.targets].map((t) => t.id),
    };
    if (include_walls) {
      report.walls = canvas.walls.placeables.map((w) => ({
        _id: w.id, c: w.document.c, door: w.document.door, ds: w.document.ds,
        sight: w.document.sight, move: w.document.move,
      }));
    }
    return report;
  },
};
