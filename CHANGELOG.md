# Changelog

All notable changes to the Foundry MCP Companion are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**Versions track [foundry-mcp-gateway](https://github.com/wanoo/foundry-mcp-gateway)
on major.minor** — the two halves speak one socket protocol and are released
together. A patch number may differ between them; a minor should not.

## [1.8.0] — 2026-10-16

*Scene and loot prep with Item Piles and Mass Edit, and a module that guards
its own script settings. Pairs with foundry-mcp-gateway 1.8.*

### Security

- **The script settings protect themselves.** `runScriptMode`,
  `runMacroScriptMode` and `verifyMode` changed by a client that does not run
  this module are reverted and the GM is warned. The MCP gateway is a GM
  account, so Foundry let it write these settings — and switch remote script
  execution to « auto » on its own. A GM changing them from Foundry's settings
  is unaffected.
- **Active tiles are code.** Monk's Active Tiles runs `runcode`, evaluates its
  value fields and compiles texts with Handlebars, so `mat_trigger` now checks
  the tile's actions first: a tile that can run code goes through the same
  policy and confirmation dialog as `run_script`.
- The script policy lives in `scripts/policy.mjs`, shared by every handler; its
  Monk's Active Tiles validator mirrors the gateway's and is covered by
  `node --test`.

### Added

- **Item Piles** handlers (`ip_create_pile`, `ip_add_items`,
  `ip_remove_items`, `ip_configure_pile`, `ip_turn_into_pile`,
  `ip_revert_pile`, `ip_restock`) on top of `game.itempiles.API`, so stacking,
  system transformers and hooks behave as in the UI. API calls that return
  `false` become errors; pile macros are refused, and changing a pile that
  already has one requires the script-macro permission, since Item Piles runs
  it on every change.
- **Mass Edit** presets (`me_find_presets`, `me_spawn_preset`,
  `me_create_preset`): search with the module's query syntax, place on the
  scene being viewed without prompts, save placeables as a preset. Presets
  carrying code are placed only under the script policy.
- `ping_module` reports `itemPiles` and `massEdit` among the dependencies.

### Fixed

- `check-parity.sh` no longer aborts on an empty handler object.
- French README: links to the gateway's accented anchors.

## [1.7.0] — 2026-10-16

*Catching up with the wgtnGM suite and with Foundry v14. Pairs with
foundry-mcp-gateway 1.7.0; tested on a live Foundry 14.369 world.*

### Added

- **Campaign Codex 6.9**: open the quest board (`cc_open_quest_board`) or a
  sheet (`cc_open_sheet`), repair sheets made by older gateways
  (`cc_migrate_content`, Campaign Codex's own migration), and add items to a
  shop through Campaign Codex so the price snapshot is right
  (`cc_shop_add_item`).
- **Mini Calendar 10**: the live, localized date with season, dawn/dusk and
  moon phases (`mc_get_date`), jumping to any date (`mc_set_date`), and forcing
  a day's weather (`mc_set_weather`).
- **Asset Librarian 1.4**: search assets by tags across the world and compendia
  (`al_search`).
- **Mini Player**: start a saved ambience (`mp_play_preset`) or open the player
  on tags with autoplay (`mp_play_tags`).
- The wgtnGM handlers live in one file per addon (`scripts/addons/`), mirroring
  the gateway.

### Changed

- **Verified on Foundry v14** (build 369) — `compatibility.verified` is now 14.

### Fixed

- **The Campaign Codex Hub closed instead of opening** when it was already open
  — the API toggles. `cc_open_toc` now opens it, or brings it forward with the
  requested view and tags. The table of contents became the Hub in 6.6.
- `cc_convert` reported success when Campaign Codex refused the conversion
  (quests and factions cannot be converted). It returns the created sheets or
  an error.
- `mc_set_time` only knew dawn and dusk of *today*, so "dawn" could move time
  backwards; it now takes day offsets, explicit hours, noon/midnight and
  `next`. `mc_open` closed an open calendar; it now only opens.
- `al_open` dropped tag filters, search and folder.
- **Targeting on Foundry v14.** `game.user.updateTokenTargets` is gone in v14;
  `client_target` now goes through `canvas.tokens.setTargets`, and keeps the
  old call for v12 and v13.
- **Mini Calendar 10.x.** Its macros were renamed (`setTime - API`,
  `openCalendar  - API`), so `client_mc_set_time` (dawn/dusk) and
  `client_mc_open` could not find them. The module's own API is used first; the
  macros stay as a fallback.
- **`client_play_sound` answers again.** Scene commands acknowledged only after
  running, and a sound waits until the browser unlocks audio — which happens on
  the first click. A Gamemaster who had not clicked yet made the gateway wait
  out its timeout. Scene commands now acknowledge first, then run.

## [1.6.0] — 2026-10-15

*The release that closes the door the module left open.*

### Added

- **Commands are signed.** The gateway now signs every command with an ECDSA
  P-256 key and the module verifies it with `crypto.subtle` — no dependency, no
  build step. Install the key with the gateway's `companion_trust_key` tool, or
  paste the one from `foundry-mcp --print-public-key` into the settings.
- **`Command signature checking`** — a three-state setting. On *Guarded* (the
  default), a world with no key configured keeps working: only the commands
  that execute code are refused.
- **`Remote script-macro execution`** — a separate three-state setting,
  defaulting to *ask me first*. It only covers macros driven by an MCP client;
  macros you launch yourself from the Foundry interface are never intercepted.

### Fixed

- **Any player could run code as the Gamemaster.** Foundry relays module socket
  channels to every client without saying who sent a message, so a player could
  emit `run_macro` from their browser console and have the GM execute it —
  bypassing the remote-script setting entirely. Commands are now authenticated.
- **`client_ask` rendered its question as raw HTML** in the targeted player's
  browser, so `<img src=x onerror=…>` executed before the dialog even drew its
  buttons. Question, title and button labels are escaped, and the escaper now
  throws instead of silently falling back to a no-op.
- **`mc_open` picked a macro by fuzzy name match**, so any macro a player could
  create and call `calendar-something` would be run by the GM. Exact name only.
- **A handler added to `SCENE_HANDLERS` but forgotten in a parallel hard-coded
  list answered `Unknown command`.** The dispatcher asks the table itself now.
- **`notify` accepted any property name**, so `type: "clear"` wiped
  notifications instead of posting one. Whitelisted.
- **`enrich` revealed GM-only secret blocks by default.** Since every reply is
  broadcast to all connected clients, that published them to the players.
  `secrets` now defaults to false and must be asked for explicitly.
- The anti-replay set grew for the whole browser session without ever being
  purged; it is now a bounded, time-based cache.

## [1.5.2] — 2026-07-19

### Added

- Remote script execution has three explicit modes (off / ask me first /
  automatic) instead of a single switch. Worlds that had it enabled keep
  exactly their previous behaviour.
- The executed code is printed in full to the browser console in every mode, so
  the GM can audit after the fact.

### Changed

- The banner is no longer shipped inside the package — a repository visual, not
  a delivered asset.

## [1.5.1] — 2026-07-19

### Changed

- Version aligned on the gateway's numbering (0.5.0 → 1.5.x). Both halves share
  one number, and `client_status` reports which one is behind.

## [1.5.0] — 2026-07-19

### Added

- Registry-ready manifest, and a release cut automatically from a version bump.
- Collaboration kit: Code of Conduct, security policy, issue and PR templates.

## [0.5.0] — 2026-07-18

### Added

- `client_roll_formula` — Foundry's real `Roll` engine, so any dice formula
  works on any game system, with the native chat card and Dice So Nice.

## [0.4.0] — [0.4.1] — 2026-07-18

### Added

- `client_babele` — the *translated* view of compendia, plus reverse search on
  either the displayed or the source name, and batch reads.

## [0.3.0] — 2026-07-18

### Added

- Table and ambience: `ask`, `select`/`target`, fog reset, FXMaster weather,
  Token Magic FX, Sequencer effect catalogue.

## [0.2.0] — 2026-07-18

### Added

- Perception batch: `get_derived` (prepared values, not the source document),
  `enrich`, `search`, `capture`, `scene_report`.

## [0.1.0] — [0.1.1] — 2026-07-18

### Added

- First version: the browser-side bridge for foundry-mcp-gateway.

### Fixed

- The responder is elected among the clients that actually loaded the module,
  not among all active GMs — the gateway's own bot is an active GM that loads
  nothing, and electing it meant nobody answered.
