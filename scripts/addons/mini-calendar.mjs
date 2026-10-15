/**
 * Mini Calendar — commandes déléguées par mini_calendar.rs.
 * Handlers à réponse unique, fusionnés dans UNIQUE_HANDLERS par scripts/main.mjs.
 * Chaque handler dégrade proprement si le module cible n'est pas actif.
 */

const MC_ID = "wgtgm-mini-calendar";

/** API du module, ou erreur claire s'il n'est pas actif. */
function mcApi() {
  const mod = game.modules.get(MC_ID);
  if (!mod?.active) throw new Error("Mini Calendar (wgtgm-mini-calendar) is not active in this world");
  return mod.api ?? {};
}

/** Unités de temps du calendrier courant. */
function timeUnits() {
  const cal = game.time.calendar;
  const d = cal?.days ?? {};
  const sPerMin = d.secondsPerMinute || 60;
  const mPerHour = d.minutesPerHour || 60;
  const hPerDay = d.hoursPerDay || 24;
  return { cal, sPerMin, sPerHour: sPerMin * mPerHour, sPerDay: sPerMin * mPerHour * hPerDay, hPerDay };
}

/** Aube/crépuscule (heures) : instance du module, sinon table `sun`, sinon 6/18. */
function sunTimes() {
  const inst = game.wgtngmMiniCalender;
  try {
    if (typeof inst?._getSunTimes === "function") return inst._getSunTimes();
  } catch (_e) { /* repli ci-dessous */ }
  return { dawn: 6, dusk: 18 };
}

const loc = (s) => (typeof s === "string" && game.i18n.has(s) ? game.i18n.localize(s) : s ?? null);

/** Applique un nouveau temps monde (en secondes) et rafraîchit le calendrier. */
async function setWorldTime(target) {
  const delta = target - game.time.worldTime;
  if (delta !== 0) await game.time.advance(delta);
  if (game.wgtngmMiniCalender?.rendered) game.wgtngmMiniCalender.render();
  return game.time.worldTime;
}

export const MINI_CALENDAR_HANDLERS = {
  // ---------------------------------------------------------- Mini Calendar
  async mc_set_time({ world_time, advance_seconds, mode, day, hour, minute, next }) {
    if (typeof world_time === "number") {
      return { worldTime: await setWorldTime(world_time), before: world_time };
    }
    if (typeof advance_seconds === "number") {
      const before = game.time.worldTime;
      return { worldTime: await setWorldTime(before + advance_seconds), before };
    }
    if (mode === undefined && typeof hour !== "number" && typeof day !== "number") {
      throw new Error("Provide mode (dawn/dusk/noon/midnight), hour, day, world_time or advance_seconds");
    }
    // Heure cible : mode (aube/crépuscule du calendrier) ou heure explicite.
    // Même arithmétique que setTime du module, mais avec minutes et « next ».
    mcApi();
    const { cal, sPerMin, sPerHour, sPerDay, hPerDay } = timeUnits();
    const before = game.time.worldTime;
    const comps = cal.timeToComponents(before);
    let targetHour;
    if (mode) {
      const m = String(mode).toLowerCase();
      const { dawn, dusk } = sunTimes();
      if (m === "dawn") targetHour = dawn;
      else if (m === "dusk") targetHour = dusk;
      else if (m === "noon") targetHour = Math.floor(hPerDay / 2);
      else if (m === "midnight") targetHour = 0;
      else throw new Error(`Unknown mode "${mode}" (dawn, dusk, noon, midnight)`);
    } else if (typeof hour === "number") {
      targetHour = hour;
    } else {
      targetHour = comps.hour + comps.minute / (sPerHour / sPerMin);
    }
    const intoDay = comps.hour * sPerHour + comps.minute * sPerMin + (comps.second || 0);
    const startOfToday = before - intoDay;
    const offset = Math.round(targetHour * sPerHour) + (typeof minute === "number" ? minute * sPerMin : 0);
    let dayOffset = Number.isInteger(day) ? day : 0;
    let target = startOfToday + dayOffset * sPerDay + offset;
    if (next && target <= before) {
      target += sPerDay;
      dayOffset += 1;
    }
    const after = await setWorldTime(target);
    const c = cal.timeToComponents(after);
    return {
      worldTime: after, before, mode: mode ?? null, targetHour, dayOffset,
      date: { year: c.year, month: c.month + 1, day: c.dayOfMonth + 1, hour: c.hour, minute: c.minute },
    };
  },

  async mc_open({ toggle = false } = {}) {
    const api = mcApi();
    if (typeof api.openCalendar === "function") {
      const wasOpen = !!game.wgtngmMiniCalender?.rendered;
      await api.openCalendar(!!toggle);
      // render()/close() ne sont pas attendus par le module : on laisse la
      // fenêtre changer d'état (1 s max) avant de le rapporter.
      const expectOpen = !(toggle && wasOpen);
      for (let i = 0; i < 20 && !!game.wgtngmMiniCalender?.rendered !== expectOpen; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return { open: !!game.wgtngmMiniCalender?.rendered, wasOpen, toggle: !!toggle };
    }
    // Ancienne version : macro « Open Calendar » (nom exact uniquement — un
    // joueur peut créer une macro au nom approchant).
    const m = game.macros?.getName?.("Open Calendar");
    if (!m) throw new Error("Mini Calendar API and 'Open Calendar' macro not found — is wgtgm-mini-calendar active?");
    await m.execute();
    return { opened: true };
  },

  async mc_get_date() {
    const api = mcApi();
    const { cal } = timeUnits();
    const wt = game.time.worldTime;
    const c = cal.timeToComponents(wt);
    const cfg = CONFIG.time.worldCalendarConfig ?? {};
    const monthData = cal.months?.values?.[c.month] ?? {};
    const dayData = cal.days?.values?.[c.dayOfWeek] ?? {};
    const { dawn, dusk } = sunTimes();
    const inst = game.wgtngmMiniCalender;
    const moons = (cfg.moons?.values ?? []).map((m) => {
      let phase = null;
      try { phase = inst?._calculateMoonPhase?.(wt, m, cal) ?? null; } catch (_e) { /* lune mal configurée */ }
      return {
        name: m.name, cycleLength: m.cycleLength,
        phase: phase?.phaseDisplayName ?? phase?.phaseName ?? null,
        daysIntoPhase: phase?.daysIntoPhase ?? null, daysUntilNextPhase: phase?.daysUntilNext ?? null,
      };
    });
    let forecast = null;
    try { forecast = typeof api.getForecast === "function" ? await api.getForecast() : null; } catch (_e) { /* météo désactivée */ }
    let season = null;
    if (Number.isInteger(c.season)) season = loc(cal.seasons?.values?.[c.season]?.name);
    if (!season && forecast?.calendarSeasonName) season = forecast.calendarSeasonName;
    const pad = (n) => String(n).padStart(2, "0");
    return {
      worldTime: wt,
      calendar: loc(cfg.name) ?? null,
      calendarSource: game.settings.get(MC_ID, "calendarSource"),
      date: `${c.year}-${pad(c.month + 1)}-${pad(c.dayOfMonth + 1)}`,
      year: c.year, month: c.month + 1, day: c.dayOfMonth + 1,
      monthName: loc(monthData.name), weekday: loc(dayData.name),
      isIntercalary: !!c.isIntercalary, leapYear: !!c.leapYear,
      time: `${pad(c.hour)}:${pad(c.minute)}:${pad(c.second ?? 0)}`,
      hour: c.hour, minute: c.minute,
      season, dawn, dusk,
      isDaytime: c.hour + c.minute / 60 >= dawn && c.hour + c.minute / 60 < dusk,
      moons,
      weather: forecast,
      monthsInYear: cal.months?.values?.length ?? null,
      daysInMonth: (c.leapYear ? monthData.leapDays ?? monthData.days : monthData.days) ?? null,
    };
  },

  async mc_set_date({ year, month, day, hour, minute }) {
    mcApi();
    if (![year, month, day].every(Number.isInteger)) throw new Error("year, month and day are required integers (month/day 1-based)");
    const { cal } = timeUnits();
    const months = cal.months?.values ?? [];
    if (month < 1 || month > months.length) throw new Error(`month must be 1-${months.length}`);
    const cur = cal.timeToComponents(game.time.worldTime);
    // isLeapYear est celui du module (sa règle bissextile, pas celle du cœur).
    const md = months[month - 1];
    const maxDays = cal.isLeapYear(year) ? md.leapDays ?? md.days : md.days;
    if (day < 1 || day > maxDays) throw new Error(`day must be 1-${maxDays} for month ${month} of year ${year}`);
    const comps = {
      year, month: month - 1, day: day - 1, dayOfMonth: day - 1,
      hour: Number.isInteger(hour) ? hour : cur.hour,
      minute: Number.isInteger(minute) ? minute : cur.minute,
      second: 0,
    };
    const before = game.time.worldTime;
    const after = await setWorldTime(cal.componentsToTime(comps));
    const c = cal.timeToComponents(after);
    return { worldTime: after, before, date: { year: c.year, month: c.month + 1, day: c.dayOfMonth + 1, hour: c.hour, minute: c.minute } };
  },

  async mc_set_weather({ type, temp_f, day_delta = 0 }) {
    const api = mcApi();
    if (typeof api.overrideWeather !== "function") throw new Error("Mini Calendar API overrideWeather not available (module too old?)");
    if (!game.user.isGM) throw new Error("Only a GM client can override the weather");
    const id = String(type ?? "").trim();
    if (!id) throw new Error("'type' is required");
    // Le module accepte n'importe quelle chaîne (et la transforme en type
    // inconnu) : on valide contre ses propres choix quand on peut les lire.
    let known = null;
    try {
      const { WeatherEngine } = await import(`/modules/${MC_ID}/scripts/weather.js`);
      known = WeatherEngine.getWeatherOverrideChoices().map((c) => c.id);
    } catch (_e) { /* validation impossible : on laisse le module trancher */ }
    if (known && !known.includes(id)) {
      throw new Error(`Unknown weather type "${id}". Known: ${[...new Set(known.filter((k) => !k.includes("::")))].join(", ")}`);
    }
    const delta = Math.max(0, parseInt(day_delta, 10) || 0);
    // Clé du jour visé (même parcours que setWeatherOverride).
    const { cal } = timeUnits();
    const c = cal.timeToComponents(game.time.worldTime);
    let y = c.year, m = c.month, d = c.dayOfMonth + delta;
    const months = cal.months.values;
    for (;;) {
      const md = months[m];
      const max = cal.isLeapYear(y) && md.leapDays !== undefined ? md.leapDays : md.days;
      if (d < max) break;
      d -= max; m++;
      if (m >= months.length) { m = 0; y++; }
    }
    const key = `${y}-${m}-${d}`;
    let tempF = typeof temp_f === "number" ? temp_f : null;
    if (tempF === null) {
      const existing = (game.settings.get(MC_ID, "weatherHistoryStore") ?? {})[key];
      if (!Number.isFinite(existing?.temp)) throw new Error("No stored temperature for that day: provide temp");
      tempF = existing.temp;
    }
    await api.overrideWeather(id, tempF, delta);
    const entry = (game.settings.get(MC_ID, "weatherHistoryStore") ?? {})[key] ?? null;
    const pad = (n) => String(n).padStart(2, "0");
    return {
      date: `${y}-${pad(m + 1)}-${pad(d + 1)}`, key, dayDelta: delta,
      type: entry?.type ?? id, label: entry?.label ?? null,
      tempF: entry?.temp ?? tempF, tempC: Math.floor(((entry?.temp ?? tempF) - 32) * 5 / 9),
      isManual: !!entry?.isManual, stored: !!entry,
    };
  },
};
