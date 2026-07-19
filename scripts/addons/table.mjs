/**
 * La table — interaction et contrôle qui n'existent que dans le navigateur :
 *   · ask : poser une question à un joueur et RÉCUPÉRER sa réponse (le seul
 *     handler exécuté par le client CIBLÉ, qui répond lui-même — voir askCmds
 *     dans main.mjs).
 *   · select / target : sélection et ciblage réels (état de client, pas document).
 *   · fog : révéler ou réinitialiser le brouillard exploré.
 * Fusionné dans main.mjs (ASK_HANDLERS d'un côté, UNIQUE_HANDLERS de l'autre).
 */

const DialogV2 = () => foundry.applications?.api?.DialogV2;

/** Exécuté par le client ciblé, qui renvoie lui-même sa réponse. */
export const ASK_HANDLERS = {
  async ask({ question, options, title, timeout_seconds = 120 }) {
    // Titre localisé : ce dialogue s'affiche chez le joueur, pas chez le MJ.
    title ??= game.i18n.localize("MCPCOMPANION.AskTitle");
    const D2 = DialogV2();
    if (!D2?.wait) throw new Error("DialogV2 unavailable (Foundry v12+ required)");
    const choices = options?.length
      ? options
      : [game.i18n.localize("MCPCOMPANION.Yes"), game.i18n.localize("MCPCOMPANION.No")];
    const buttons = choices.map((label, i) => ({
      action: `c${i}`,
      label,
      callback: () => label,
    }));

    // La promesse du dialogue court contre une limite de temps : sans quoi une
    // commande jamais répondue bloquerait l'appel MCP jusqu'à son timeout.
    let timer;
    const expiry = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __timeout: true }), timeout_seconds * 1000);
    });
    const answered = D2.wait({
      window: { title },
      content: `<p>${question}</p>`,
      buttons,
      rejectClose: false,
    });
    const result = await Promise.race([answered, expiry]);
    clearTimeout(timer);

    if (result?.__timeout) return { user: game.user.name, answered: false, reason: "timeout" };
    if (result === null || result === undefined) {
      return { user: game.user.name, answered: false, reason: "dismissed" };
    }
    return { user: game.user.name, userId: game.user.id, answered: true, answer: result };
  },
};

export const TABLE_HANDLERS = {
  // ------------------------------------------------------------- jet générique
  // Le vrai moteur Roll de Foundry : marche pour TOUS les systèmes, poste la
  // carte de chat native et déclenche Dice So Nice si présent.
  async roll_formula({ formula, flavor, actorId, whisper_gm = false, roll_data = {} }) {
    if (!formula) throw new Error("'formula' is required (e.g. 2d6+3)");
    const actor = actorId ? game.actors.get(actorId) : null;
    const data = { ...(actor?.getRollData?.() ?? {}), ...roll_data };
    const roll = new Roll(formula, data);
    await roll.evaluate();
    const speaker = actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker();
    const message = {
      speaker,
      flavor: flavor ?? `${game.i18n.localize("MCPCOMPANION.MCPRoll")} : ${formula}`,
    };
    if (whisper_gm) message.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
    await roll.toMessage(message);
    return {
      formula: roll.formula,
      total: roll.total,
      // le détail dé par dé, pour raisonner sur le résultat
      dice: roll.dice.map((d) => ({
        faces: d.faces, number: d.number,
        results: d.results.map((r) => ({ result: r.result, active: r.active })),
      })),
      actor: actor?.name ?? null,
    };
  },

  // ------------------------------------------------------------ select/target
  async select({ tokens = [], release_others = true }) {
    if (release_others) canvas.tokens.releaseAll();
    const found = [];
    for (const id of tokens) {
      const t = canvas.tokens.get(id);
      if (t) {
        t.control({ releaseOthers: false });
        found.push(t.id);
      }
    }
    return { selected: found, missing: tokens.filter((id) => !found.includes(id)) };
  },

  async target({ tokens = [], release_others = true }) {
    if (release_others) game.user.updateTokenTargets([]);
    const found = [];
    for (const id of tokens) {
      const t = canvas.tokens.get(id);
      if (t) {
        t.setTarget(true, { user: game.user, releaseOthers: false, groupSelection: true });
        found.push(t.id);
      }
    }
    return { targeted: found, missing: tokens.filter((id) => !found.includes(id)) };
  },

  // -------------------------------------------------------------------- fog
  async fog({ action = "reset" }) {
    if (action === "reset") {
      await canvas.fog.reset();
      return { fog: "reset", scene: canvas.scene?.name };
    }
    throw new Error(`unknown fog action: ${action} (supported: reset)`);
  },
};
