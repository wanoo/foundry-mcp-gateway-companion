# What and why

<!-- Link the issue: Closes #123 -->

## Handler category

<!-- New handlers must pick one — see CONTRIBUTING in the gateway repo. -->

- [ ] **scene** — every targeted client runs it, the responder acks once
- [ ] **addressed** — the *targeted* client runs it and answers (like `ask`)
- [ ] **unique** — only the elected GM responder runs it (default)
- [ ] Not a new handler

## Tested against a real world

- Foundry version:
- Target module (Sequencer, FXMaster…) and version, if any:

<!-- The rule of this project: probe the addon's real API in a live world
     before writing the handler. We dropped FXMaster scene filters because v13
     exposes no hook for them — better no tool than a guessed one. -->

## Checklist

- [ ] `node --check` passes on every changed `.mjs`
- [ ] Degrades gracefully when the target module is absent (clear error, nothing broken)
- [ ] User-facing strings go through `lang/en.json` + `lang/fr.json` — no hardcoded text
- [ ] Paired tool added in the [gateway](https://github.com/wanoo/foundry-mcp-gateway) (link the PR)
- [ ] Version bumped in `module.json` **and** `VERSION` in `main.mjs`, matching the gateway
