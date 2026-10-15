/**
 * Mini Calendar — commandes déléguées par mini_calendar.rs.
 * Handlers à réponse unique, fusionnés dans UNIQUE_HANDLERS par scripts/main.mjs.
 * Chaque handler dégrade proprement si le module cible n'est pas actif.
 */

export const MINI_CALENDAR_HANDLERS = {
  // ---------------------------------------------------------- Mini Calendar
  async mc_set_time({ world_time, advance_seconds, mode }) {
    // Priorité au mode dawn/dusk via la macro setTime du module ; sinon horloge core.
    if (mode === "dawn" || mode === "dusk") {
      // API du module (10.x) d'abord ; l'ancienne macro de monde en repli.
      const api = game.modules.get("wgtgm-mini-calendar")?.api;
      if (typeof api?.setTime === "function") {
        await api.setTime(0, mode);
        return { mode, worldTime: game.time.worldTime };
      }
      const m = game.macros?.getName?.("setTime");
      if (!m) throw new Error("Mini Calendar API and 'setTime' macro not found — is wgtgm-mini-calendar active?");
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
    // Nom exact uniquement : la recherche floue /calendar/i qui servait de
    // repli exécutait la première macro dont le nom contenait « calendar »,
    // donc n'importe quelle macro qu'un joueur pouvait créer et nommer.
    const api = game.modules.get("wgtgm-mini-calendar")?.api;
    if (typeof api?.openCalendar === "function") {
      await api.openCalendar();
      return { opened: true };
    }
    const m = game.macros?.getName?.("Open Calendar");
    if (!m) throw new Error("Mini Calendar API and 'Open Calendar' macro not found — is wgtgm-mini-calendar active?");
    await m.execute();
    return { opened: true };
  },
};
