# Playbook: session-pickup

**Match when a prior run must resume after its session is gone.** State records intent. The
ledger and the repository record reality.

## Steps

1. Resolve the host and slug. If no slug is supplied, list state files with modification
   times and ask which run to resume.
2. Read `<state-root>/<slug>.json`, preserving unknown fields. Read the ledger from the end
   backward until every slice's phase and last decision are clear.
3. Reconcile intent against `git worktree list`, branches, PR state, issue state, and live
   agent status. A persisted active monitor is not proof that it is running.
4. Record every divergence as `reconciled` before changing state. Do not silently infer that
   a merged PR, missing branch, or pruned worktree is still active.
5. Rebuild the sets of finished, in-flight, blocked, and never-started slices. Read the
   finish predicate. Missing criteria are FENCE 2 before unattended work resumes.
6. Re-create only needed worktrees. Keep one worktree per in-flight slice and serialize all
   shared-file work.
7. Reclaim exactly one monitor. Reset its last-pass time and record the new owner and wake
   mechanism. Skip this only when every slice is merge-ready or fenced.
8. Update state, ledger, and the session record in that order.
9. Resume at the earliest unfinished phase under the playbook named in state. Do not redo a
   verified unit unless reconciliation shows its evidence is invalid.
