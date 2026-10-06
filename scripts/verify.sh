#!/usr/bin/env bash
# The one verification command, locally and in CI: structure and lints, the Python tests, and
# the Node script tests. The test files are passed by glob because Node 24 loads a directory
# argument as a module and runs no tests.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

node scripts/check-playbooks.mjs
python3 -m unittest discover -t .
node --test skills/html-report/scripts/*.test.mjs skills/qa-video/scripts/*.test.mjs skills/review-pr/scripts/*.test.mjs skills/review-watch/scripts/*.test.mjs

# The deck mod: the engine's own manifest and source check, then its tests. CI has no claude CLI.
if command -v claude >/dev/null 2>&1; then
  claude plugin validate .
  claude plugin test .
fi

# A session loads the installed copy, not this checkout, so a change is not live until the two
# match. Compare them when the installed copy is on this machine; CI has none and skips this.
installed="${VISTACK_INSTALLED:-$HOME/.claude/plugins/marketplaces/vistack}"
if [ -d "$installed" ] && [ "$(cd "$installed" && pwd -P)" != "$(pwd -P)" ]; then
  # Paths the engine writes into a folder it loads a mod from (.claude-plugin/types/, tsconfig.json)
  # are excluded by anchored rsync patterns, so the root types/ contract is still compared.
  drift="$(rsync -rcn --delete --itemize-changes \
    --exclude /.git --exclude /.github --exclude /.claude --exclude /.claude-plugin/types/ --exclude /tsconfig.json \
    --exclude __pycache__ --exclude .DS_Store --exclude '*.pyc' \
    "$root/" "$installed/" | grep -v '^\.' || true)"
  if [ -n "$drift" ]; then
    echo "FAIL the installed copy at $installed differs from this checkout:" >&2
    printf '%s\n' "$drift" | head -20 >&2
    echo "Sync it with: rsync -a --delete --exclude /.git --exclude /.github --exclude /.claude --exclude /.claude-plugin/types/ --exclude /tsconfig.json \"$root/\" \"$installed/\"" >&2
    echo "Then start a new session so the hosts reload the plugin." >&2
    exit 1
  fi
fi
echo "PASS verify"
