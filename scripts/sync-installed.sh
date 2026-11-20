#!/usr/bin/env bash
# The one supported way to sync this checkout into the installed copy the hosts load.
# It refuses when the installed copy is newer than the checkout, refuses to delete a file that
# exists only in the installed copy unless --allow-delete is passed, and backs the installed copy
# up before it writes. `--check-version` runs the newer-installed refusal alone, for verify.sh.
# usage: sync-installed.sh [--allow-delete | --check-version]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
installed="${VISTACK_INSTALLED:-$HOME/.claude/plugins/marketplaces/vistack}"
backup_root="${VISTACK_BACKUP_ROOT:-$HOME/.cache/vistack/installed-backups}"

excludes=(--exclude /.git --exclude /.github --exclude /.claude --exclude /.claude-plugin/types/ --exclude /tsconfig.json
  --exclude __pycache__ --exclude .DS_Store --exclude '*.pyc')

allow_delete=0
check_version=0
for argument in "$@"; do
  case "$argument" in
    --allow-delete) allow_delete=1 ;;
    --check-version) check_version=1 ;;
    *) echo "usage: sync-installed.sh [--allow-delete | --check-version]" >&2; exit 64 ;;
  esac
done

if [ ! -d "$installed" ]; then
  echo "no installed copy at $installed" >&2
  exit 66
fi
if [ "$(cd "$installed" && pwd -P)" = "$(cd "$root" && pwd -P)" ]; then
  echo "the installed copy is this checkout; nothing to sync" >&2
  exit 66
fi

read_version() {
  sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$1/.claude-plugin/plugin.json" 2>/dev/null | head -1
}

# Succeeds when version $1 is strictly newer than version $2; a pre-release suffix is ignored.
is_newer() {
  local left="${1%%[-+]*}" right="${2%%[-+]*}" left_part right_part
  local -a left_parts right_parts
  IFS=. read -r -a left_parts <<<"$left"
  IFS=. read -r -a right_parts <<<"$right"
  for index in 0 1 2; do
    left_part="${left_parts[index]:-0}"
    right_part="${right_parts[index]:-0}"
    if [ "$left_part" -gt "$right_part" ]; then return 0; fi
    if [ "$left_part" -lt "$right_part" ]; then return 1; fi
  done
  return 1
}

checkout_version="$(read_version "$root")"
installed_version="$(read_version "$installed")"
semver='^[0-9]+(\.[0-9]+){0,2}([-+].*)?$'
if ! [[ "$checkout_version" =~ $semver ]] || ! [[ "$installed_version" =~ $semver ]]; then
  echo "REFUSED: cannot read both versions from .claude-plugin/plugin.json (checkout '$checkout_version', installed '$installed_version')." >&2
  exit 1
fi

if is_newer "$installed_version" "$checkout_version"; then
  {
    echo "REFUSED: the installed copy at $installed is $installed_version, newer than this checkout at $checkout_version."
    echo "The installed copy holds work this checkout lacks, and a sync would erase it."
    echo "Recover it into the checkout (or restore the checkout's missing work), then rerun. List what it holds with:"
    printf '  rsync -rcn --itemize-changes %s"%s/" "%s/"\n' "$(printf '%q ' "${excludes[@]}")" "$installed" "$root"
  } >&2
  exit 1
fi
if [ "$check_version" -eq 1 ]; then
  exit 0
fi

changes="$(rsync -rcn --delete --itemize-changes "${excludes[@]}" "$root/" "$installed/" | grep -v '^\.' || true)"
if [ -z "$changes" ]; then
  echo "installed copy already matches this checkout ($checkout_version); nothing to do"
  exit 0
fi

installed_only="$(printf '%s\n' "$changes" | sed -n 's/^\*deleting[[:space:]]*//p')"
if [ -n "$installed_only" ] && [ "$allow_delete" -eq 0 ]; then
  {
    echo "REFUSED: the sync would delete these files that exist only in the installed copy:"
    printf '%s\n' "$installed_only" | sed 's/^/  /'
    echo "Rerun with --allow-delete once each is confirmed obsolete."
  } >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$backup_root/$installed_version-$stamp"
[ ! -e "$backup" ] || backup="$backup-$$"
mkdir -p "$backup"
rsync -a "$installed/" "$backup/"
echo "backed up the installed copy ($installed_version) to $backup"

rsync -ac --delete "${excludes[@]}" "$root/" "$installed/"
echo "synced $checkout_version into $installed"
echo "Start a new session so the hosts reload the plugin."
