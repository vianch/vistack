# Playbook: blocker

**Match when** work is already open and stuck on one identified obstacle. Owned by
`unblocker`. Bounded: **20 attempts**, with an early abort.

## Steps

1. State the blocker in one sentence: what was expected, what happened, and the exact error
   text quoted.
2. Confirm it is one blocker. Two symptoms with different causes are two runs of this
   playbook.
3. Record the baseline: the exact command, its full output, and the commit it ran against.
4. Enter the attempt loop (`unblock`). Each attempt: state a hypothesis **distinct from
   every prior attempt**, change **exactly one variable**, run, and append a ledger row with
   command, output, and verdict.
5. Abort early if three consecutive attempts produce identical evidence. That is a knowledge
   gap, not a solvable defect — go to step 8.
6. Never widen scope, skip a test, loosen a type, add a blanket `catch`, or force-push to
   get unblocked. An attempt that does any of those is void and does not count against the
   budget.
7. On resolution: state the root cause, apply the fix that addresses it, and confirm the
   original command now succeeds. Record the cause in the ledger.
8. On abort or exhaustion: assemble the escalation dossier — the blocker, every hypothesis
   tried with its evidence, what the evidence rules out, the two or three remaining
   candidates, and what would settle each.
9. Escalate as FENCE 1 with the full log. Park the slice in the state file with
   `phase: blocked` and its blocker list.
10. Update the `Engineering work — agent sessions` comment. Other slices keep running; a blocker on
    one slice does not stop the others unless the conflict matrix says it must.
