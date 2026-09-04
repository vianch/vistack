# Playbook: session-pickup

**Match when** work is being resumed and its session is gone. Reconstructs state from
`.claude/state/<slug>.json` and its ledger.

If the coordinator session is still alive, this playbook is the wrong tool — attach to it
instead: `claude attach <coordinator-session-id>` from the `Engineering work — agent sessions`
comment.

## Steps

1. Resolve the slug. Given one, use it. Given none, list `.claude/state/*.json` with their
   modification times and ask which — this is a lookup, not a fence.
2. Read `.claude/state/<slug>.json`: every slice with its agent, model, session id,
   worktree, branch, PR, phase, blockers, and retry count.
3. Read `.claude/state/<slug>.tsv` from the end backwards until the run's shape is clear.
   The last row per slice is that slice's real phase.
4. Reconcile the state file against reality — it records intent, and intent can be stale:
   - `git worktree list` — does each recorded worktree still exist?
   - `git branch -a` — does each recorded branch exist, and where is its head?
   - `gh pr view <n>` — is each recorded PR open, draft, closed, or merged?
   - `gh issue view <n>` — is the ticket still open?
5. Write down every divergence found. A merged PR, a deleted branch, or a pruned worktree
   changes what remains to be done.
6. Rebuild the picture: slices done, slices in flight, slices blocked, slices never started.
7. Re-read the finish condition from the state file. If it is missing, restate it and get it
   confirmed before resuming an unattended run (FENCE 2).
8. Rewrite the state file to match reality, and append one ledger row per divergence with
   `decision: reconciled`.
9. Re-create only the worktrees still needed. Prune the rest with
   `cleanup-worktrees`.
10. Upsert the `Engineering work — agent sessions` comment with the new session ids
    (`session-ledger`). Never post a second comment.
11. Restart the standing monitor before resuming any slice: the old session's `/loop` died
    with it, so `monitor.status = active` in the state file describes nothing that is
    running. Run `/loop 10m /vistack babysit <slug>`, reset `monitor.last_pass_at` to null,
    and record the restart. Skip this only when every remaining slice is `merge-ready` or
    fenced.
12. Resume at the earliest unfinished phase, under the playbook the state file names.
