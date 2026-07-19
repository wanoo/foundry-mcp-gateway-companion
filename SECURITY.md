# Security Policy

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private vulnerability
reporting:

👉 **[Report a vulnerability](https://github.com/wanoo/foundry-mcp-gateway-companion/security/advisories/new)**

Include the module version, your Foundry version, and reproduction steps.
Acknowledgement within 5 days, assessment within 10. Coordinated disclosure:
please allow 90 days, and you'll be credited unless you'd rather not be.

## Supported versions

The latest release only. This module version-matches
[foundry-mcp-gateway](https://github.com/wanoo/foundry-mcp-gateway) — run both
at the same version.

## What this module actually does — please read

It runs in the **Gamemaster's browser** and executes commands sent by the
gateway over a Foundry socket channel. Concretely:

- **A Gamemaster's full client API is reachable through it** — anything the GM
  can do in their browser, the gateway can ask for: open sheets, roll, move
  tokens, read prepared data, screenshot the canvas.
- **`run_script` executes arbitrary JavaScript** in that browser. It is **off by
  default**, behind a world-level setting, and should stay off unless every MCP
  client connected to your gateway is trusted.
- **Commands are only accepted from the socket channel**
  `module.foundry-mcp-gateway-companion`, which Foundry relays between clients
  of the same world. A player who can emit on that channel can therefore ask
  the responder GM to act. Treat world membership as a trust boundary.
- **Telemetry** (token selection, targets, viewed scene) is relayed to the
  gateway when enabled; it's a per-client setting the user can turn off.

Especially in scope: any way to make the module execute something without
`run_script` being enabled, to bypass the `targets` restriction so a command
lands on a client it wasn't addressed to, or to have a non-GM client answer as
the responder.
