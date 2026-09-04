---
name: unblock
description: "The bounded blocker loop — at most 20 attempts, each with a distinct hypothesis and exactly one changed variable, aborting early on three identical results and escalating with a full dossier. Use when a slice is stuck on one identified obstacle."
---

# unblock

A blocker gets a bounded, logged, hypothesis-driven loop. Not unlimited retries, and not a
single guess followed by a shrug.

## Enter with

- The blocker in one sentence: expected, actual, and the **exact error text quoted**.
- The baseline: the exact command, its full output, and the commit it ran against.
- One blocker. Two symptoms with different causes are two loops.

## The loop

**Budget: 20 attempts per blocker.**

Each attempt, without exception:

1. **State a hypothesis distinct from every prior attempt.** Not a variation in wording — a
   different proposed cause. Re-running the same idea with a different value is the same
   attempt.
2. **Change exactly one variable.** One config value, one line, one flag, one version. Two
   changes make the result uninterpretable and burn an attempt for nothing.
3. **Run it**, and capture the full output.
4. **Append a ledger row**: the hypothesis, the command, the output, the verdict.

## Early abort

**Three consecutive attempts producing identical evidence → stop.** That pattern means the
loop is not learning: the failure is upstream of everything being changed. It is a knowledge
gap, not a solvable defect, and attempts 4 through 20 will produce the same row.

Go to escalation.

## Never

None of these count as an attempt, and each is a defect in its own right:

- Widening scope to make the failure go away.
- Skipping, deleting, or `.skip`-ing a test.
- Loosening a type, adding `any`, or adding a blanket `catch`.
- Force-pushing, resetting a shared branch, or rewriting history.
- Re-running an identical command to see if it passes this time.

An attempt that does one of these is void: revert it, and the budget does not move.

## On resolution

1. State the root cause in one sentence with `file:line`
   (`fix-root-causes`).
2. Apply the fix that addresses the cause, not the symptom.
3. Confirm the original baseline command now succeeds, with its output.
4. Ledger row: `decision: root-cause-fixed`, with the cause as the reason.
5. Return the slice to its playbook at the phase it left.

## On abort or exhaustion — the escalation dossier

Escalate as **FENCE 1** with all six parts:

1. The blocker, and the exact error text.
2. The baseline command, output, and commit.
3. Every hypothesis tried, in order, with the one variable changed and the evidence
   returned.
4. **What the evidence rules out** — this is the part that has value to the human.
5. The two or three remaining candidate causes.
6. For each candidate, the one check that would settle it, and why it could not be run here.

Then park the slice: `phase: blocked`, its `blockers[]` entry filled in, the session comment
updated. Other slices keep running unless the conflict matrix says otherwise.
