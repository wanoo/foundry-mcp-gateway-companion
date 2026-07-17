# Foundry MCP Companion

An **optional** companion module for the [foundry-mcp-gateway](https://github.com/wanoo/foundry-mcp-gateway)
MCP server.

The MCP server talks to Foundry through the **socket protocol**, which can only
touch *documents*. This module runs in the **browser** — where the full
`game.*` client API lives — and executes the client-side actions the server
delegates to it. Install it, and your MCP client (Claude, etc.) gains a set of
`client_*` tools.

**You don't need it** to use foundry-mcp-gateway — but it unlocks the things a
socket client fundamentally cannot do.

## What it unlocks

| MCP tool | What it does (client-side) |
|---|---|
| `client_run_macro` | Run any Foundry macro on the GM client — the universal key to anything scriptable |
| `client_run_script` | Run arbitrary JS on the GM client (⚠️ off by default, enable in settings) |
| `client_roll_pool_native` | *starwarsffg*: roll a pool with the real FFG engine — native chat card + **Dice So Nice** 3D dice on the table |
| `client_pan_camera` / `client_ping` | Move / ping the players' cameras — "everyone look here" |
| `client_play_sound` | One-shot dramatic sound (a stinger), no playlist needed |
| `client_notify` | UI notification on the players' screens |
| `client_show_document` | Open a sheet on the players' screens |
| `client_play_effect` | A [Sequencer](https://foundryvtt.com/packages/sequencer) visual effect (if installed) |
| `client_cc_convert` / `client_cc_export_obsidian` / `client_cc_open_toc` | [Campaign Codex](https://foundryvtt.com/packages/campaign-codex) client-side API (bulk-convert journals to CC sheets, export to Obsidian…) |
| `client_get_state` + `get_events` | Telemetry: who views which scene, live token selections & targets |

All actions accept a `targets` argument (`all` / `gm` / `players` / list of user
ids) so you can drive one player's screen or everyone's.

## How it works

The module listens on the socket channel `module.foundry-mcp-gateway-companion`. The MCP
server emits a command; a **single GM browser** (the "responder", elected
deterministically) executes it and sends the result back — which the server
catches in its event buffer. Scene actions (camera, ping, sound…) run on every
targeted client. If no companion is installed, the `client_*` tools simply time
out with a clear message — nothing else breaks.

Optional integrations degrade gracefully: `client_roll_pool_native` needs the
`starwarsffg` system, `client_play_effect` needs Sequencer, the `client_cc_*`
tools need Campaign Codex. Dice So Nice is used automatically if present.

## Installation

Install via the manifest URL in Foundry (*Add-on Modules → Install Module →
Manifest URL*):

```
https://github.com/wanoo/foundry-mcp-gateway-companion/releases/latest/download/module.json
```

Then enable it in your world. A **GM browser must be connected** for the
`client_*` tools to work (that browser is what executes the actions). No other
configuration is required.

### Settings

- **Relay client telemetry** (per client, default on): report this client's
  token selections, targets and viewed scene to the MCP server.
- **Allow remote script execution** (world, default **off**): let the MCP server
  run arbitrary JavaScript via `client_run_script`. Powerful but dangerous —
  only enable it if you trust every MCP client connected to your gateway.

## License

MIT.
