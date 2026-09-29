#!/bin/sh
# Run one standing healthcheck headless and read-only. Keep a report only when the run
# printed something, so a quiet run leaves no file.
set -eu

usage="usage: run-healthcheck.sh <transcript-healthcheck|routine-healthcheck> <claude|codex|opencode>"
routine="${1:?$usage}"
host="${2:?$usage}"
case "$routine" in
  transcript-healthcheck | routine-healthcheck) ;;
  *) echo "unknown routine: $routine" >&2; exit 64 ;;
esac

report_dir="${VISTACK_HEALTHCHECK_DIR:-$HOME/.vistack/healthchecks}"
instruction="Print the report, or print nothing when nothing is worth proposing."
output="$(mktemp)"
trap 'rm -f "$output"' EXIT
cd "$HOME"

case "$host" in
  claude)
    claude -p "/vistack:$routine $instruction" --permission-mode plan --output-format text \
      --model "${VISTACK_HEALTHCHECK_MODEL:-sonnet}" >"$output"
    ;;
  codex)
    codex exec --ephemeral --sandbox read-only --skip-git-repo-check -C "$HOME" \
      -o "$output" "\$vistack:$routine $instruction" >/dev/null
    ;;
  opencode)
    opencode run --dir "$HOME" "Run the $routine skill. $instruction" >"$output"
    ;;
  *) echo "unknown host: $host" >&2; exit 64 ;;
esac

if grep -q '[^[:space:]]' "$output"; then
  mkdir -p "$report_dir"
  cp "$output" "$report_dir/$routine-$(date +%F).md"
fi
