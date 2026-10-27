#!/usr/bin/env bash
set -euo pipefail

handoff_dir="${HANDOFF_DIR:-$HOME/.claude/handoff-documents}"

usage() {
  cat <<'USAGE'
usage: handoff.sh new            create the handoff folder and print the variables for a new handoff
       handoff.sh latest [N]     list the N newest handoffs for this project (default 5), newest first
exit codes: 0 done; 1 no handoff found for this project; 2 usage error
USAGE
}

project_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd -P
}

project_slug() {
  local slug
  slug="$(basename "$(project_root)" | tr '[:upper:]' '[:lower:]' | tr -s ' \t' '-' | tr -cd 'a-z0-9.-' | cut -c1-60)"
  printf '%s' "${slug:-unknown-project}"
}

frontmatter_value() {
  sed -n '2,/^---$/p' "$2" | sed -n "s/^$1: //p" | head -1
}

new_handoff() {
  mkdir -p "$handoff_dir"
  local slug stamp file
  slug="$(project_slug)"
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="$handoff_dir/$slug-$stamp.md"
  if [ -e "$file" ]; then
    file="$handoff_dir/$slug-$stamp-$$.md"
  fi
  printf 'HANDOFF_FILE=%s\n' "$file"
  printf 'PROJECT_SLUG=%s\n' "$slug"
  printf 'PROJECT_ROOT=%s\n' "$(project_root)"
  printf 'CWD=%s\n' "$PWD"
  printf 'TIMESTAMP=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'BRANCH=%s\n' "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo not-a-git-repo)"
  printf 'HEAD=%s\n' "$(git rev-parse --short HEAD 2>/dev/null || echo none)"
  printf 'UNCOMMITTED_FILES=%s\n' "$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
}

list_latest() {
  local count="${1:-5}" root slug file cwd listed=0
  case "$count" in '' | *[!0-9]*) usage >&2; exit 2 ;; esac
  root="$(project_root)"
  slug="$(project_slug)"
  local same_root=() same_slug=()
  while IFS= read -r file; do
    cwd="$(frontmatter_value cwd "$file")"
    case "$cwd" in
      "$root" | "$root"/*) same_root+=("$file") ;;
      *) same_slug+=("$file") ;;
    esac
  done < <(ls -1t "$handoff_dir/$slug"-*.md 2>/dev/null || true)
  local chosen=("${same_root[@]+"${same_root[@]}"}")
  if [ "${#chosen[@]}" -eq 0 ]; then
    chosen=("${same_slug[@]+"${same_slug[@]}"}")
  fi
  for file in "${chosen[@]+"${chosen[@]}"}"; do
    [ "$listed" -lt "$count" ] || break
    printf '%s\t%s\t%s\t%s\n' "$file" "$(frontmatter_value timestamp "$file")" \
      "$(frontmatter_value branch "$file")" "$(frontmatter_value next_session_focus "$file")"
    listed=$((listed + 1))
  done
  [ "$listed" -gt 0 ] || exit 1
}

case "${1:-}" in
  new) new_handoff ;;
  latest) list_latest "${2:-5}" ;;
  -h | --help) usage ;;
  *) usage >&2; exit 2 ;;
esac
