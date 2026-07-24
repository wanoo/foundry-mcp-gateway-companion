# Contributing to Foundry MCP Companion

This is the **browser half** of
[foundry-mcp-gateway](https://github.com/wanoo/foundry-mcp-gateway). A feature
is almost always a **pair**: a `client_*` tool in the gateway (Rust) and a
handler here (JS). The gateway's
[CONTRIBUTING.md](https://github.com/wanoo/foundry-mcp-gateway/blob/main/CONTRIBUTING.md)
covers the pair rules; this file covers the browser side.

*(🇫🇷 : contributions bienvenues en français — le code et les docs publiques
restent en anglais, voir « Language ».)*

## Dev setup

No build step, no dependencies to install:

```sh
git clone https://github.com/wanoo/foundry-mcp-gateway-companion
cd foundry-mcp-gateway-companion
for f in scripts/*.mjs scripts/addons/*.mjs; do node --check "$f"; done
node --test test/*.test.mjs      # signature verification, no Foundry needed
```

To try it in a world, symlink the checkout into your Foundry data directory:

```sh
ln -s "$PWD" ~/FoundryVTT/Data/modules/foundry-mcp-gateway-companion
```

Then *Manage Modules → enable*, and reload the browser (F5) after every edit —
Foundry caches ES modules.

## Adding a handler

1. Put it in `scripts/addons/<theme>.mjs`, exported as
   `export const X_HANDLERS = { async cmd(args) { … } }`.
2. Merge it in `main.mjs` (`Object.assign(UNIQUE_HANDLERS, …)`).
3. Add the matching `client_*` tool in the gateway **and its row in
   `COMPANION_COMMANDS`** (`src/tools/companion.rs`) — that table is the single
   source of truth for the pairing, and `check-parity.sh` fails if the two
   lists differ.
4. Return a **plain JSON-serialisable object**. It crosses a socket; classes,
   `Document` instances and circular references don't survive.
5. Degrade gracefully:
   `if (!game.modules.get("x")?.active) throw new Error("x module not active")`.
   The error text reaches the MCP client, so make it actionable.
6. Probe the addon's real API in a live world before writing — `client_run_script`
   exists for this. Better no tool than a guessed one.

### Pick the delivery mode — this is the trap

`main.mjs` dispatches on three tables, and **the table you register in *is* the
delivery mode**. There is no second list to update:

| Mode | Table | Who runs it | Who answers |
|---|---|---|---|
| **scene** | `SCENE_HANDLERS` (`main.mjs`) | every client matching `targets` | the responder acks once |
| **addressed** | `ASK_HANDLERS` (`addons/table.mjs`) | the *targeted* client | that same client |
| **unique** | `UNIQUE_HANDLERS` and everything merged into it | the elected GM responder | it |

`targets` is `"all"` (default), `"gm"`, `"players"`, or an array of user ids —
it only means anything for **scene** and **addressed** commands.

The **responder** is elected among the clients that actually loaded this module
(the `companions` registry), never among all active GMs: the gateway's own bot
is an active GM that loads nothing, and electing it would mean nobody answers.

## Security — read this before touching `onMessage`

Foundry relays `module.*` socket channels to **every connected client** and
never tells the receiver who sent a message. Any player can emit on our channel
from their own console. Two consequences that constrain the code:

- **Commands are verified before anything else.** `scripts/verify.mjs` checks a
  P-256 signature from the gateway. In `onMessage`, that `await` is the **only**
  one before the synchronous `alreadyHandled` guards — moving it later opens a
  race where two messages with the same id interleave and run twice.
- **Execute the verified arguments**, never `msg.args`. Only `argsRaw` is
  covered by the signature.
- **Escape anything you render.** `question`, `title` and button labels reach a
  DialogV2 as HTML. `table.mjs` has an `esc()` helper that throws rather than
  degrading silently — don't reintroduce a `?? (t) => t` fallback.
- **Replies are public.** `game.socket.emit` broadcasts to the whole world;
  Foundry offers no targeting. Anything a handler returns is readable by every
  player. Don't add a handler that reads GM-only content without saying so.

## User-facing strings

Anything a **player** or GM reads goes through `lang/en.json` + `lang/fr.json` —
dialog titles, chat flavour, settings. CI fails if a key is missing from either
file, or if a `localize()` call names a key that doesn't exist. Error messages
thrown to the gateway stay in English: they're machine-facing diagnostics.

## Language

New comments and new log messages in **English**. The existing French comments
stay as they are — several document behaviours verified against a live world,
and a blanket retranslation would risk losing that nuance for no functional
gain.

## Pull requests

- Commits in English, [Conventional Commits](https://www.conventionalcommits.org/).
- **Versions track the gateway** on major.minor. A protocol change (a new
  handler, a changed payload) bumps the minor in **both** repositories; a fix
  confined to this module is a patch here alone. `client_status` only reports a
  drift when major.minor differ.
- Bump `version` in `module.json` **and** `VERSION` in `main.mjs` — CI compares
  them, and a release is cut from a version bump pushed to `main`.
- Update `CHANGELOG.md`.

## Definition of done

- [ ] `node --check` clean on every file.
- [ ] `node --test test/*.test.mjs` green.
- [ ] `./scripts/check-parity.sh` green (handlers match the gateway).
- [ ] Handler returns plain JSON; a missing dependency yields a clear error.
- [ ] New player-facing string added to **both** `lang/*.json`.
- [ ] README table and the `client_*` count in `module.json` updated.
- [ ] `CHANGELOG.md` entry.
- [ ] Tested in a live world — or the PR says it wasn't. That's an accepted
      answer; silence about it isn't.
