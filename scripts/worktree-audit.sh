#!/usr/bin/env bash

set -u

repo="${1:-$(git rev-parse --show-toplevel 2>/dev/null)}"
if [ -z "$repo" ]; then
  echo "not in a git repository; pass a repository path" >&2
  exit 1
fi
cd "$repo" || exit 1

printf "WORKTREE\tBRANCH\tHEAD\tAGE\tSTATUS\tREMOTE\n"
now=$(date +%s)

git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r worktree; do
  head=$(git -C "$worktree" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  branch=$(git -C "$worktree" symbolic-ref --quiet --short HEAD 2>/dev/null || echo "detached")
  timestamp=$(git -C "$worktree" log -1 --format='%ct' HEAD 2>/dev/null || echo 0)
  if [ "$timestamp" -gt 0 ] 2>/dev/null; then
    age="$(( (now - timestamp) / 86400 ))d"
  else
    age="?"
  fi
  porcelain=$(git -C "$worktree" status --porcelain 2>/dev/null)
  if [ -z "$porcelain" ]; then
    status="clean"
  else
    status="dirty:$(printf '%s\n' "$porcelain" | wc -l | tr -d ' ')"
  fi
  if [ "$branch" = "detached" ]; then
    remote="detached"
  elif git -C "$worktree" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    remote="tracked"
  else
    remote="no-remote"
  fi
  printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$worktree" "$branch" "$head" "$age" "$status" "$remote"
done
