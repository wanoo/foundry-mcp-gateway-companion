#!/usr/bin/env bash
# The two halves must agree: one client_* tool on the gateway <-> one handler
# here, in the same delivery mode. Nothing enforced this before, and the
# delivery mode was duplicated in a hard-coded list that silently drifted.
#
# The gateway is the source of truth: it exports the map from the same table it
# uses at runtime (--dump-companion-commands -> docs/companion-commands.json).
# We fetch that file and check our handlers against it.
set -euo pipefail
cd "$(dirname "$0")/.."

# Override with a local path when developing both repos side by side:
#   MAP=../foundry-mcp-gateway/docs/companion-commands.json ./scripts/check-parity.sh
MAP=${MAP:-https://raw.githubusercontent.com/wanoo/foundry-mcp-gateway/main/docs/companion-commands.json}

fail=0
note() { printf '  %-46s %s\n' "$1" "$2"; }
bad()  { note "$1" "x $2"; fail=1; }
ok()   { note "$1" "ok $2"; }

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
if [[ "$MAP" == http* ]]; then
  curl -sfL "$MAP" -o "$tmp" || { echo "Could not fetch the gateway map ($MAP) — skipping (offline?)."; exit 0; }
else
  cp "$MAP" "$tmp"
fi

echo "== companion handlers vs gateway client_* commands =="

# Handler keys of one `const NAME = { … }` object: `async key(` lines until the
# object's closing `};`. A count guard catches a broken extractor (indentation
# changed) instead of passing green on nonsense.
keys() { # $1 = object name, $2 = file
  awk -v n="$1" '$0 ~ "(export )?const " n " = \\{" {f=1;next} f && /^};/{f=0} f' "$2" \
    | { grep -oE '^  async [a-z0-9_]+\(' || true; } | sed -E 's/^  async //; s/\(//' | sort
}

scene=$(keys SCENE_HANDLERS scripts/main.mjs)
addressed=$(keys ASK_HANDLERS scripts/addons/table.mjs)
unique=$( { keys UNIQUE_HANDLERS scripts/main.mjs
            keys TABLE_HANDLERS  scripts/addons/table.mjs
            keys CAMPAIGN_CODEX_HANDLERS  scripts/addons/campaign-codex.mjs
            keys ASSET_LIBRARIAN_HANDLERS scripts/addons/asset-librarian.mjs
            keys MINI_CALENDAR_HANDLERS   scripts/addons/mini-calendar.mjs
            keys MINI_SUITE_HANDLERS      scripts/addons/mini-suite.mjs
            keys AMBIENCE_HANDLERS  scripts/addons/ambience.mjs
            keys INSIGHT_HANDLERS   scripts/addons/insight.mjs
            keys SCENE_FX_HANDLERS  scripts/addons/scene-fx.mjs
            keys ITEM_PILES_HANDLERS scripts/addons/item-piles.mjs
            keys MASS_EDIT_HANDLERS  scripts/addons/mass-edit.mjs; } | sort -u )

mine=$(printf '%s\n%s\n%s\n' "$scene" "$addressed" "$unique" | grep . | sort -u)
[ "$(echo "$mine" | grep -c .)" -ge 30 ] \
  || bad "handler extraction" "only $(echo "$mine" | grep -c .) handlers found — check-parity.sh needs fixing"

# 1. Same set of commands on both sides.
theirs=$(jq -r '.[].cmd' "$tmp" | sort)
d=$(diff <(echo "$theirs") <(echo "$mine") || true)
if [ -z "$d" ]; then
  ok "handlers <-> client_* commands" "$(echo "$mine" | grep -c .)/$(echo "$theirs" | grep -c .)"
else
  bad "handlers <-> client_* commands" "$(echo "$d" | tr '\n' ' ')"
fi

# 2. Same delivery mode. A scene command handled as unique only answers the
# elected GM — a bug you only see with two browsers connected.
for mode in scene addressed unique; do
  want=$(jq -r --arg m "$mode" '.[]|select(.delivery==$m)|.cmd' "$tmp" | sort)
  case $mode in scene) got=$scene;; addressed) got=$addressed;; unique) got=$unique;; esac
  d=$(diff <(echo "$want") <(echo "$got") || true)
  if [ -z "$d" ]; then
    ok "delivery: $mode" "$(echo "$want" | grep -c .)"
  else
    bad "delivery: $mode" "$(echo "$d" | tr '\n' ' ')"
  fi
done

echo
if [ "$fail" -eq 0 ]; then
  echo "Both halves agree ($(echo "$mine" | grep -c .) handlers)."
else
  echo "The two halves have drifted — see above. A client_* tool with no handler times out at the table." >&2
fi
exit "$fail"
