# Playbook: worktree-cleanup

**Match when stale worktrees or local build state need cleanup.** The audit is read-only.
Deletion is FENCE 3 unless the user explicitly authorizes the exact confirmed targets.

## Steps

1. List worktrees from `git worktree list`. Do not infer paths from names or delete a broad
   directory.
2. For each worktree, record size, age, branch, head SHA, clean or dirty status, remote
   tracking, and PR state. Use `scripts/worktree-audit.sh` when available.
3. Reconcile each candidate with viStack state files, open PRs, branches, and active agent
   sessions. A persisted state entry is not proof that a worktree is in use, and a missing
   entry is not proof that it is safe.
4. Classify candidates as active, holding uncommitted work, holding an open PR, clean and
   merged, or needs review. Name the evidence for every classification.
5. Proceed only with the non-destructive audit. Hold every deletion, branch removal, cache
   purge, and simulator removal at FENCE 3 with the exact target list.
6. Report disk usage before and after the audit, the candidates, and the held actions. Do
   not claim space was reclaimed when nothing was deleted.
