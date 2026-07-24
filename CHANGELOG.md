# Changelog

All notable changes to the Foundry MCP Companion are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**Versions track [foundry-mcp-gateway](https://github.com/wanoo/foundry-mcp-gateway)
on major.minor** — the two halves speak one socket protocol and are released
together. A patch number may differ between them; a minor should not.

## [1.6.0] — unreleased

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
