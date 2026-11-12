#!/bin/sh
# Run one nightly repository routine headless, inside the repository, under a per-repository
# lock and a watchdog. Exits with the host's exit code, 124 when the watchdog killed the run,
# and 0 when another run of the same repository holds the lock.
set -eu

usage="usage: run-routine.sh <maintenance|crash-hunt> <repo-dir> <claude|codex>"
[ "$#" -eq 3 ] || { echo "$usage" >&2; exit 64; }
routine="$1"
repo_arg="$2"
host="$3"
case "$routine" in
  maintenance | crash-hunt) ;;
  *) echo "unknown routine: $routine" >&2; exit 64 ;;
esac
case "$host" in
  claude | codex) ;;
  *) echo "unknown host: $host" >&2; exit 64 ;;
esac
if [ -z "$repo_arg" ] || [ ! -d "$repo_arg" ]; then
  echo "no such repository directory: $repo_arg" >&2
  exit 66
fi
repo="$(cd "$repo_arg" && pwd -P)"

max_minutes="${VISTACK_ROUTINE_MAX_MINUTES:-240}"
limit_seconds="$(awk -v minutes="$max_minutes" 'BEGIN { if (minutes ~ /^[0-9]+(\.[0-9]+)?$/) printf "%d", minutes * 60 }')"
if [ -z "$limit_seconds" ] || [ "$limit_seconds" -lt 1 ]; then
  echo "VISTACK_ROUTINE_MAX_MINUTES must be a number of at least 0.017: $max_minutes" >&2
  exit 64
fi
grace_seconds="${VISTACK_ROUTINE_GRACE_SECONDS:-30}"
case "$grace_seconds" in
  '' | *[!0-9]*) echo "VISTACK_ROUTINE_GRACE_SECONDS must be a whole number: $grace_seconds" >&2; exit 64 ;;
esac

umask 077
root="${VISTACK_ROUTINE_DIR:-$HOME/.vistack/routines}"
name="$(basename "$repo" | tr -c 'A-Za-z0-9._\n-' '_')"
checksum="$(printf '%08x' "$(printf '%s' "$repo" | cksum | cut -d' ' -f1)" | cut -c1-6)"
key="$name-$checksum"
mkdir -p "$root/$key"
log="$root/$key/$routine-$(date +%F).log"
lock="$root/$key.lock"

note() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$log"
}

case "$routine" in
  maintenance) subject="a scheduled maintenance routine" ;;
  crash-hunt) subject="a scheduled crash hunt" ;;
esac
instruction="This is $subject; nobody answers questions: decide from the evidence at hand and follow the playbook to its report step."

holder_alive() {
  [ -n "$1" ] || return 1
  kill -0 "$1" 2>/dev/null || return 1
  command -v ps >/dev/null 2>&1 || return 0
  holder_command="$(ps -o command= -p "$1" 2>/dev/null || true)"
  case "$holder_command" in
    *run-routine.sh*) return 0 ;;
  esac
  return 1
}

acquire() {
  mkdir "$lock" 2>/dev/null && return 0
  holder="$(cat "$lock/pid" 2>/dev/null || true)"
  if [ -z "$holder" ]; then
    sleep 1
    holder="$(cat "$lock/pid" 2>/dev/null || true)"
  fi
  if holder_alive "$holder"; then
    return 1
  fi
  note "stale lock of pid ${holder:-unknown} removed"
  rm -rf "$lock"
  mkdir "$lock" 2>/dev/null
}

tree() {
  ps -A -o pid= -o ppid= | awk -v root="$1" '
    { pid[NR] = $1; parent[NR] = $2 }
    END {
      seen[root] = 1
      print root
      do {
        added = 0
        for (row = 1; row <= NR; row++) {
          if (!(pid[row] in seen) && (parent[row] in seen)) {
            seen[pid[row]] = 1
            print pid[row]
            added = 1
          }
        }
      } while (added)
    }'
}

any_alive() {
  for member in $1; do
    if kill -0 "$member" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

terminate() {
  members="$(tree "$1")"
  # shellcheck disable=SC2086
  kill -TERM $members 2>/dev/null || true
  waited=0
  while any_alive "$members" && [ "$waited" -lt "$grace_seconds" ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if any_alive "$members"; then
    # shellcheck disable=SC2086
    kill -KILL $members 2>/dev/null || true
  fi
}

locked=0
child=""
watchdog=""
cleanup() {
  if [ -n "$watchdog" ]; then
    # shellcheck disable=SC2046
    kill -TERM $(tree "$watchdog") 2>/dev/null || true
  fi
  if [ -n "$child" ]; then
    terminate "$child"
  fi
  if [ "$locked" -eq 1 ]; then
    rm -rf "$lock"
  fi
  return 0
}
trap cleanup EXIT
trap 'exit 143' HUP INT TERM

if ! acquire; then
  running="$(cat "$lock/routine" 2>/dev/null || true)"
  running="${running:-$routine}"
  if [ "$running" = "$routine" ]; then
    note "skipped: $routine already running"
  else
    note "skipped: $routine already running (repository held by $running)"
  fi
  exit 0
fi
locked=1
printf '%s\n' "$$" >"$lock/pid"
printf '%s\n' "$routine" >"$lock/routine"

cli="$host"
if ! command -v "$cli" >/dev/null 2>&1; then
  note "failed: $cli is not on PATH"
  exit 127
fi

run_host() {
  case "$host" in
    claude)
      if [ -n "${VISTACK_ROUTINE_MODEL:-}" ]; then
        claude -p "/vistack:$routine $instruction" \
          --permission-mode "${VISTACK_ROUTINE_PERMISSION_MODE:-auto}" --permission-prompts none \
          --max-budget-usd "${VISTACK_ROUTINE_BUDGET_USD:-25}" --output-format text \
          --model "$VISTACK_ROUTINE_MODEL"
      else
        claude -p "/vistack:$routine $instruction" \
          --permission-mode "${VISTACK_ROUTINE_PERMISSION_MODE:-auto}" --permission-prompts none \
          --max-budget-usd "${VISTACK_ROUTINE_BUDGET_USD:-25}" --output-format text
      fi
      ;;
    codex)
      codex exec --sandbox workspace-write -C "$repo" "\$vistack:$routine $instruction"
      ;;
  esac
}

cd "$repo"
note "start: $routine $host $repo (limit ${max_minutes}m)"
run_host >>"$log" 2>&1 &
child=$!
(
  sleep "$limit_seconds"
  : >"$lock/timeout"
  terminate "$child"
) &
watchdog=$!

status=0
wait "$child" || status=$?
child=""
if [ -e "$lock/timeout" ]; then
  wait "$watchdog" || true
  status=124
  note "killed: $routine ran past ${max_minutes} minutes"
fi
note "finished: $routine exit $status"
exit "$status"
