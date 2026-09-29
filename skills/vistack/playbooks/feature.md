# Playbook: feature

**Match when new behavior is wanted behind specified acceptance criteria.** The feature
owner stays responsible for the design and reviews delegated implementation.

## Steps

1. Read the acceptance criteria. Restate each as a subject, verb, and check. An ambiguous
   criterion that changes behavior or a public contract is FENCE 2.
2. State the finish predicate and unchanged behavior.
3. Run a read-only architecture pass over the affected subsystem. Name the data shape and
   organizing structure before logic. Reuse existing patterns.
4. Write the throughput checkpoint with four entries: blocking steps, independent
   workstreams, shared mutable state, and the smallest safe decomposition. Keep an `n/a`
   reason for a dimension that does not apply.
5. Dispatch `analyst` for the impact map and `planner` for slices of at most 500 changed
   lines, file ownership, checks, dependencies, and the conflict matrix.
6. Run the advisor `plan` checkpoint on the impact map, slices, tiers, and conflict matrix
   before dispatch (`skills/advisor/SKILL.md`). Apply or rebut each point with evidence.
7. Serialize slices that share a file. Create one worktree per parallel slice and dispatch
   one owner per slice at its planned tier: `implementer` or `senior-implementer`.
8. Each owner writes the check first where practical, then code, then lint and tests.
   It passes the diff through comment cleanup and reports exact output.
9. Drain completed slices as queue events. Open each finished slice as a draft PR immediately.
   Over 500 lines or multiple concerns goes through `stack-split` first.
10. Run QA on each PR's own environment. Capture a screenshot at every assertion point and
    trace every scenario to a diff hunk.
11. Run `health-check` independently. A finding returns to the owning slice only.
12. Clear review automation comments through the project skill. Update state, ledger, and the
    session record on every transition.
13. Run the advisor `done` checkpoint on the PR set and its evidence before calling the run
    merge-ready (`skills/advisor/SKILL.md`). Resolve each gap it names or record why it does
    not apply.
14. Stop when every slice is merge-ready. Report the PR set, evidence, and open work. Never
    merge.
