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
6. Serialize slices that share a file. Create one worktree per parallel slice and dispatch
   one `implementer` per slice.
7. Each implementer writes the check first where practical, then code, then lint and tests.
   It passes the diff through comment cleanup and reports exact output.
8. Drain completed slices as queue events. Open each finished slice as a draft PR immediately.
   Over 500 lines or multiple concerns goes through `stack-split` first.
9. Run QA on each PR's own environment. Capture a screenshot at every assertion point and
   trace every scenario to a diff hunk.
10. Run `health-check` independently. A finding returns to the owning slice only.
11. Clear review automation comments through the project skill. Update state, ledger, and the
    session record on every transition.
12. Stop when every slice is merge-ready. Report the PR set, evidence, and open work. Never
    merge.
