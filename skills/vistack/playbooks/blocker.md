# Playbook: blocker

**Match when one open unit is stuck on one identified obstacle.** The loop is bounded at 20
attempts and aborts early when evidence stops changing.

## Steps

1. State the expected result, actual result, and exact error text.
2. Confirm this is one blocker. Separate symptoms use separate runs.
3. Record the baseline command, full output, commit, worktree, and branch.
4. For each attempt, state a distinct hypothesis, change exactly one variable, run the
   command, capture full output, and append one ledger row.
5. Abort after three consecutive attempts with identical evidence. Do not burn the remaining
   budget on a loop that is not learning.
6. Never widen scope, skip or delete tests, loosen types, add a blanket catch, force-push,
   reset shared work, or rerun an identical command. Such an attempt is void.
7. On resolution, state the root cause with `file:line`, apply the cause-level fix, and
   rerun the original baseline. Record `root-cause-fixed` and return to the prior phase.
8. On abort or exhaustion, write the six-part FENCE 1 dossier: blocker, baseline, attempts,
   ruled-out causes, remaining candidates, and the check that would settle each.
9. Park the slice as `blocked`, update the state and session record, and let independent
   slices continue.
