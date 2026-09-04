# Playbook: babysit

**Match when** a run is already dispatched and needs watching rather than starting. Unstick
it, keep it honest, report at boundaries. Writes no product code.

## Steps

1. Read `.claude/state/<slug>.json` and the tail of `.claude/state/<slug>.tsv`. Establish
   the current phase per slice before looking at anything else. Then check the monitor
   itself: if `monitor.status` is `active` while no recurring loop is running in this
   session, if `coordinator_session_id` identifies a different coordinator, or if
   `monitor.last_pass_at` is older than two intervals, the monitor is orphaned — restart
   exactly one `/loop 10m /vistack babysit <slug>`, update the coordinator session id, and
   record it with `decision: reconciled`.
   An orphaned monitor is why a run goes quiet with slices still open.
2. Enumerate every `slices.*.pr`, then query the repository for agent PRs linked to the
   parent issue that are missing from state. Add each newly opened PR to its owning slice
   before checking it; never monitor only the PRs known at startup.
3. Check liveness per slice: is its agent still running, and has its ledger advanced since
   the last check? A slice with no new row and no running agent is stalled, not working.
4. Check CI on every open PR with `the project CI checks`. A red build is a
   blocker for that slice.
5. Check the invariants, cheaply and every pass:
   - one worktree per in-flight slice, no shared directories
   - no slice running concurrently with a slice it shares a file with
   - every remote inside `the project organization and its approved repositories`
   - every PR still a draft, ≤500 lines, one concern
6. Route a stalled slice into `unblock`. Do not fix its code yourself — the owning slice
   owns the fix.
7. Route a red CI or a failed QA scenario back to the owning slice with the evidence
   attached. Never to a different slice, and never to a broad re-run.
8. Watch for the honest-report failures: a pass with no screenshot, a criterion marked met
   with no diff hunk, a "should work". Each returns to its owner
   (`evidence-over-inference`).
9. Count retries. A slice at its retry ceiling escalates as FENCE 1 with its dossier rather
   than looping again.
10. Update `monitor.last_pass_at`, the state file, and the `Engineering work — agent sessions` comment
    after each pass; append a `monitor-pass` ledger row even when no PR changed.
11. Report at phase boundaries only. A pass that found nothing produces no message.
12. When every slice is merge-ready or fenced, cancel the recurring loop, set
    `monitor.status` to `stopped`, report the set, and stop. Never merge.
