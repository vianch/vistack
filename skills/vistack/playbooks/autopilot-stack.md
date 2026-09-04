# Playbook: autopilot-stack

**The default for a groomed ticket.** Build and verify a linear reviewed stack unattended.
The terminal state is merge-ready draft PRs. It never merges.

## Steps

1. Confirm the groomed ticket, checkable finish predicate, verification target, and
   credential path. Missing inputs route to the matching fence.
2. Confirm the git realm and base branch. Do not add or fetch an unapproved remote.
3. Run the readiness gate. Dispatch `groomer` for reversible omissions and re-gate. A product
   decision is FENCE 2.
4. Dispatch `analyst` for the cited impact map and coverage gaps.
5. Dispatch `planner` for slices at most 500 changed lines, independent checks, file
   ownership, dependencies, and the conflict matrix.
6. Resolve host paths. Create state and ledger records before dispatch. Record the objective,
   permissions, escape hatch, and one monitor owner.
7. Establish exactly one monitor and verify it is live. Do not dispatch while this startup
   gate is unproven.
8. Create one worktree per eligible slice. Assert directory count equals in-flight slice
   count before each wave.
9. Dispatch parallel slices and serialize shared files. Each completion is drained as a
   queue event, verified, and followed by the next eligible dispatch.
10. Each slice runs its check, implementation, lint, tests, and comment cleanup. A stalled
    slice enters `blocker` without stopping independent slices.
11. Open each finished slice as a draft PR immediately. Assign reviewers. Use `stack-split`
    before opening when the diff is too large or carries multiple concerns.
12. Run QA against each PR's own target and capture evidence at every assertion point.
13. Run `health-check` against acceptance criteria, diff hunks, QA scenarios, and screenshots.
    Route every defect to its owning slice.
14. Clear review automation comments and re-run affected checks after every new head.
15. Update state, ledger, and session record on every transition. Record skips explicitly.
16. At every monitor pass, reconcile state with branches, worktrees, PRs, and agent status.
    Count only side effects as progress. Replace a lane that exceeds its limit without a
    side effect.
17. Stop the monitor when every slice is merge-ready or fenced. Report PRs, evidence, ledger,
    open fences, and next action. Never merge.
