# Playbook: babysit

**Match when a dispatched run or PR set needs a status and recovery pass.** Babysit writes
coordination state, not product code, and never merges.

## Steps

1. Read the state file and ledger tail before polling anything. Check the monitor owner,
   mechanism, status, and last pass. Reclaim an orphaned monitor before more work.
2. Enumerate every recorded PR and discover new PRs linked to the run. Add new PRs to state
   before checking them.
3. Check liveness. A lane with no live owner and no new ledger row or side effect is stalled.
4. Check CI, draft state, size, concern scope, reviewer assignment, QA evidence, and health
   verdict on every open PR.
5. Check one-worktree-per-slice, shared-file serialization, approved remotes, and the
   finish predicate on every pass.
6. Route stalled lanes to `blocker`. Route red CI, failed QA, and review findings to the
   owning slice with exact evidence. Do not fix product code here.
7. Reject passes with no screenshot, criteria with no diff hunk, and claims such as "should
   work". Return them to the owner under `evidence-over-inference`.
8. Record retries and escalate at the playbook's limit with a FENCE 1 dossier.
9. Update `last_pass_at`, state, ledger, and session record. A clean pass still gets a
   `monitor-pass` row.
10. Stop the monitor when all slices are merge-ready or fenced. Report the frontier, evidence,
    and open work. Never merge.
