# Playbook: perf-issue

**Match when a measured performance problem needs one fix.** The measurement decides. A
sustained search against a target uses `overnight` or a separately scoped queue.

## Steps

1. State the slow behavior, the matching surface, the metric, the direction that is better,
   and the finish threshold.
2. Capture a baseline with the repository's performance or control procedure. Record the
   command, workload, commit, repetitions, and artifact path.
3. Run `how` or the repository's equivalent read-only architecture pass. Use the trace to
   form hypotheses. Do not claim a bottleneck from source inspection alone.
4. Choose one hypothesis and one variable to change. Prefer deletion before caching,
   batching, indirection, lazy work, or scheduling. Name the mechanism the trace supports.
5. If the fix crosses a function or service boundary, record the design decision before
   implementation. Dispatch one owner in one worktree with a precise scope.
6. Capture the post-fix artifact with the same workload and measurement procedure. Run the
   regression checks.
7. Compare baseline and post-fix artifacts. An inconclusive or wrong-surface result is not a
   pass. Revert a change that does not beat noise or breaks the regression gate.
8. Record the baseline, post-fix value, delta, and artifact paths in the ledger and PR.
9. Run `pr-stack` or the PR creation procedure. Keep the PR draft, scoped, and below 500
   changed lines.
10. Report the metric, baseline, result, delta, artifact, and any remaining hypothesis.
