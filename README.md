<div align="center">

# 🧩 Foundry MCP Companion

**The browser half of [foundry-mcp-gateway](https://github.com/wanoo/foundry-mcp-gateway).**

The MCP server talks to Foundry through the socket protocol, which only reaches
*documents*. This tiny module runs in the **GM's browser** — where the full
`game.*` API lives — and executes what the server delegates. Install it and your
AI gains **36 `client_*` tools**: it can *see* the table, *talk* to players, and
*stage* effects.

[![Foundry](https://img.shields.io/badge/Foundry%20VTT-v12%2B-ff6400)](https://foundryvtt.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

**You don't need it** to use foundry-mcp-gateway — without it the `client_*`
tools time out with a clear message and everything else keeps working. But it
unlocks what a socket client fundamentally cannot do.

## 📦 Installation

*Add-on Modules → Install Module → Manifest URL*:

```
https://github.com/wanoo/foundry-mcp-gateway-companion/releases/latest/download/module.json
```

Enable it in your world. A **GM browser must be connected** (and its tab awake —
browsers freeze background tabs) for the `client_*` tools to respond. No other
configuration needed.

## ✨ What it unlocks

### 👁️ Perception — the AI sees your table

| Handler | MCP tool | What |
|---|---|---|
| `capture` | 📸 `client_capture` | Screenshot of the GM's view, returned as a real image |
| `scene_report` | 🗺️ `client_scene_report` | Tokens with grid coords, disposition, **real** visibility, doors, lights |
| `get_derived` | 📊 `client_get_derived` | **Prepared** sheet values (post-`prepareData` + active effects) |
| `enrich` | 🔗 `client_enrich` | Enriched HTML: `@UUID` resolved, inline rolls, GM secrets |
| `search` | 🔎 `client_search` | Name search across every collection |
| `babele` | 🌍 `client_babele` | [Babele](https://foundryvtt.com/packages/babele) translated view, reverse search by displayed name |

### 🗣️ Interaction

| Handler | MCP tool | What |
|---|---|---|
| `ask` | ❓ `client_ask` | A real dialog on a player's screen — their answer comes back |
| `notify` / `ping_at` / `pan` | 📣 `client_notify` 🔔 `client_ping` 🎥 `client_pan_camera` | Notifications, map pings, camera moves — targetable per client |
| `show_document` | 📜 `client_show_document` | Open a sheet on targeted clients |
| `select` / `target` / `fog` | 🎯 `client_select` `client_target` 🌫️ `client_fog` | Real selection, crosshair targets, fog reset |
| `get_client_state` / `ping_module` | 📡 `client_get_state` `client_status` | Who's online & watching what · health + detected deps |

### 🌦️ Stagecraft

| Handler | MCP tool | Needs |
|---|---|---|
| `weather` / `weather_types` | 🌧️ `client_weather` | [FXMaster](https://foundryvtt.com/packages/fxmaster) |
| `play_effect` / `seq_between` / `seq_sound` / `effect_catalog` | ✨ `client_play_effect` `client_seq_between` `client_seq_sound` 🗂️ `client_effect_catalog` | [Sequencer](https://foundryvtt.com/packages/sequencer) |
| `token_fx` / `token_fx_presets` | 🎇 `client_token_fx` | [Token Magic FX](https://foundryvtt.com/packages/tokenmagic) |
| `mat_trigger` | 🎞️ `client_mat_trigger` | [Monk's Active Tiles](https://foundryvtt.com/packages/monks-active-tiles) |
| `play_sound` | 🔊 `client_play_sound` | — |

### 🚀 Power tools

| Handler | MCP tool | What |
|---|---|---|
| `run_macro` | `client_run_macro` | Any macro, by id or name — the universal key |
| `run_script` | `client_run_script` | Arbitrary JS (⚠️ **off by default**, world setting) |
| `roll_formula` | 🎲 `client_roll_formula` | **Any system**: any formula through Foundry's real `Roll` engine — native chat card, Dice So Nice, actor roll data, per-die results |
| `roll_pool_native` | 🎲 `client_roll_pool_native` | *starwarsffg*: real FFG engine + **Dice So Nice** 3D dice |
| `cc_convert` / `cc_export_obsidian` / `cc_open_toc` | `client_cc_*` | [Campaign Codex](https://foundryvtt.com/packages/campaign-codex) client API |
| `al_open` · `mc_set_time` / `mc_open` | `client_al_open` `client_mc_*` | Asset Librarian · Mini Calendar |

Every integration degrades gracefully — if the target module isn't active, the
tool answers with a clear error instead of breaking anything.

## ⚙️ How it works

The module listens on the socket channel `module.foundry-mcp-gateway-companion`.
Commands `{cmd, id, targets?, args}` arrive from the MCP server; results go back
as `{reply: id, ok, result|error}`, which the server catches in its event buffer.

Three delivery modes:

- **scene** — every targeted client executes (camera, pings, sounds, notifications);
- **addressed** — the *targeted* client executes **and answers** (`ask`);
- **unique** — a single GM **responder** executes (API calls, rolls, captures).
  The responder is elected among the clients that actually loaded this module —
  headless GM connections (like the MCP bot itself) are never elected.

Telemetry (optional, per client): token selections, targets, viewed scene and
combat turns stream to the server's event feed.

## 🔒 Settings

- **Relay client telemetry** *(client, default on)* — report selections/targets/scene.
- **Allow remote script execution** *(world, default **off**)* — enables
  `client_run_script`. Only turn it on if you trust every MCP client connected
  to your gateway.

## 🤝 Contributing

Adding an addon integration = one handler here + one tool in
[the server repo](https://github.com/wanoo/foundry-mcp-gateway). The full guide
(including how to pick the delivery mode and the probe-before-you-write rule) is
in the server's [CONTRIBUTING.md](https://github.com/wanoo/foundry-mcp-gateway/blob/main/CONTRIBUTING.md).
Handlers live in `scripts/addons/*.mjs`, merged into the dispatcher by `main.mjs`.

**Versions are shared with the gateway** — both carry the same number, so a
mismatch tells you at a glance that one half is behind. `client_status` says
which one.

**User-facing strings go through `lang/en.json` + `lang/fr.json`.** Not just
settings: dialog titles and chat flavour reach *players*, and CI fails if a key
is missing from either file.

Releases are automated: bump `version` in `module.json` **and** `VERSION` in
`main.mjs`, push to `main`, and the workflow tags, packages and publishes. See
[docs/foundry-release.md](docs/foundry-release.md) for the registry side.

## 📜 License

MIT.
