# Playbook: babysit

**Match when a dispatched run or PR set needs a status and recovery pass.** Babysit writes
coordination state, not product code, and never merges.

## Steps

1. Read the state file and ledger tail before polling anything. Check the monitor owner,
   mechanism, status, and last pass. Reclaim an orphaned monitor before more work.
2. Enumerate every recorded PR and discover new PRs linked to the run. Add new PRs to state
   before checking them.
3. Check liveness. A lane with no live owner and no new ledger row or side effect is stalled.
4. Read every open PR with `python3 scripts/watch-pr.py --pr <n,…> --status-only`:
   conflicts, changes requested, checks, unresolved review threads, reviewer assignment, and
   size. Then check concern scope, QA evidence, and health verdict. The pass reads once; it
   never starts a second watcher. Act only on check results from the PR's current head SHA;
   a result from an older head is stale and is not a reason to retry.
5. Check one-worktree-per-slice, shared-file serialization, approved remotes, and the
   finish predicate on every pass.
6. Route stalled lanes to `blocker`. Send red CI to `devops` (`agents/devops.md`) for
   triage under `skills/prove-it-works/SKILL.md` first. Route caused-by-diff failures, failed
   QA, and review findings to the owning slice with exact evidence. Pre-existing and flaky
   failures stay with `devops`, which routes each by its table. Do not fix product code here.
7. Reject passes with no screenshot, criteria with no diff hunk, and claims such as "should
   work". Return them to the owner under `evidence-over-inference`.
8. Record retries. When a lane fails again with the same evidence, run the advisor `repeat`
   checkpoint before the next retry. Escalate at the playbook's limit with a FENCE 1 dossier.
9. Update `last_pass_at`, state, ledger, and session record. A clean pass still gets a
   `monitor-pass` row. On a self-paced loop, choose the next delay by the monitor rules in
   `skills/coordinate/SKILL.md`.
10. Stop the monitor when all slices are merge-ready or fenced; this pass ends the loop
    (`skills/coordinate/SKILL.md`). Report the frontier, evidence, and open work. Never
    merge.
