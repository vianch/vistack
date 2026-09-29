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
6. Run the advisor `plan` checkpoint on the impact map, slices, tiers, and conflict matrix
   before dispatch (`skills/advisor/SKILL.md`). Apply or rebut each point with evidence.
7. Resolve host paths. Create state and ledger records before dispatch. Record the objective,
   permissions, escape hatch, and one monitor owner.
8. Establish exactly one monitor and verify it is live. Do not dispatch while this startup
   gate is unproven.
9. Create one worktree per eligible slice. Assert directory count equals in-flight slice
   count before each wave.
10. Dispatch parallel slices at their planned tier and serialize shared files. Each
    completion is drained as a queue event, verified, and followed by the next eligible
    dispatch.
11. Each slice runs its check, implementation, lint, tests, and comment cleanup. A stalled
    slice enters `blocker` without stopping independent slices.
12. Open each finished slice as a draft PR immediately. Assign reviewers. Use `stack-split`
    before opening when the diff is too large or carries multiple concerns.
13. Run QA against each PR's own target and capture evidence at every assertion point.
14. Run `health-check` against acceptance criteria, diff hunks, QA scenarios, and screenshots.
    Route every defect to its owning slice.
15. Clear review automation comments and re-run affected checks after every new head.
16. Update state, ledger, and session record on every transition. Record skips explicitly.
17. At every monitor pass, reconcile state with branches, worktrees, PRs, and agent status.
    Count only side effects as progress. Replace a lane that exceeds its limit without a
    side effect.
18. Run the advisor `done` checkpoint on the PR set, QA evidence, and health-check verdicts
    before calling the run merge-ready (`skills/advisor/SKILL.md`). Resolve each gap it
    names or record why it does not apply.
19. Stop the monitor when every slice is merge-ready or fenced. Report PRs, evidence, ledger,
    open fences, and next action. Never merge.
