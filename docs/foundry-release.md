# Publishing to the Foundry package registry

What the GitHub release workflow can't do for you: telling foundryvtt.com that
a new version exists. Two minutes, once per release.

## One-time: get the package listed

1. Go to **<https://foundryvtt.com/creators/submit/>** (any active Foundry
   licence is enough — the "Content Creator" programme is something else).
2. Fill in:
   - **Package Name**: `foundry-mcp-gateway-companion` — must match the `id` in
     `module.json` exactly;
   - **Package Title**: `Foundry MCP Companion`;
   - **Package URL**: `https://github.com/wanoo/foundry-mcp-gateway-companion`.
3. A human reviews it, usually within a few days. Approval unlocks the package
   admin pages under *Authored Packages*.

## Every release

The release workflow prints these exact values in its job summary — copy them
from there. Otherwise:

| Field | Value |
|---|---|
| **Version Number** | the bare number, e.g. `1.5.0` — **never** `v1.5.0` |
| **Package Manifest URL** | `https://github.com/wanoo/foundry-mcp-gateway-companion/releases/download/v<VERSION>/module.json` |
| **Release Notes URL** | `https://github.com/wanoo/foundry-mcp-gateway-companion/releases/tag/v<VERSION>` |
| **Minimum Core Version** | `12` |
| **Verified Core Version** | `13` |
| **Maximum Core Version** | **leave blank** |

Then: *Authored Packages* → **Edit** → **+ Add** a release → paste → save.

## The three URLs that are easy to confuse

This is where most modules get it wrong, and the failure is silent — updates
simply stop being offered.

| Where | Must point to | Why |
|---|---|---|
| `manifest` **in** `module.json` | `releases/latest/download/module.json` | Foundry polls this to notice a newer version exists. It has to follow "latest". |
| `download` **in** `module.json` | `releases/download/v<VERSION>/module.zip` | It must pin *this* version, so old versions stay installable. The release workflow rewrites it automatically — don't hand-edit it. |
| Manifest URL given to the **registry form** | `releases/download/v<VERSION>/module.json` | The registry stores one entry per version; pointing it at "latest" makes version comparison non-deterministic. |

Rules that come with them: the `version` field is plain semver with no `v` and
no pre-release suffix (Foundry's `isNewerVersion` doesn't understand
`1.5.0-beta.1`), and **any** change — even a manifest-only fix — needs a new
number.

## Leaving `Maximum Core Version` blank

Filling it in blocks installation on every later Foundry version. Only set it
if you have actually tested a newer version and know the module breaks there.

## Automating it later

Foundry exposes `POST https://foundryvtt.com/_api/packages/release_version/`
with a token from the package admin page, and it has a **dry-run mode**. Worth
wiring into the release workflow once versions are being cut regularly — the
dry run first, always.
