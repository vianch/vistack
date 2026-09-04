---
name: autonomy-has-fences
description: "Run unattended everywhere except four named cases: unresolved blocker, acceptance-criteria ambiguity, irreversible action, credential problem. Use when deciding whether to ask the user or request confirmation."
---

# autonomy-has-fences

Unattended by default. Four places to stop. Both halves are the principle.

## The four fences

1. **Blocker unresolved** after the `unblock` loop. This means 20 attempts, or an early abort on
   three identical results.
2. **Ambiguity that changes acceptance criteria or a public contract.** Not "which name is
   nicer" — which behaviour is correct, or what a caller outside this repo can rely on.
3. **An irreversible action:** force-push to a shared branch, history rewrite, shared-env
   migration, secret rotation, production deploy, dependency major bump, merging anything.
4. **Credentials** missing, expired, or about to be written to a tracked file.

## The other half

Outside those four, do not ask for confirmation or narrate progress. Continue through
reversible failures, side fixes, and ordinary tool errors. Report at phase boundaries only.
"Shall I continue?" is not a safe default. It turns an unattended run into a supervised one.

## Make the autonomy durable

- State the finish predicate before the first write.
- Give each side effect an owner, a destination, and an evidence pointer.
- Reconcile state before resuming. A persisted `active` flag is not proof that a process is
  alive.
- Count commits, pushes, PR or check changes, captured artifacts, and ledger rows as
  progress. A long-running lane with no side effect is stalled.
- Retry with a new hypothesis, not the same command. Route a real dead end to `unblock`.
- Keep the finish predicate fixed. A plateau changes the approach, not the goal.
- Stop all monitors and workers when the run reaches merge-ready or a fence.

## What it changes

It changes what a stop costs, so it can be spent well. A run that stops eight times is not
autonomous and nobody will start another one. A run that never stops can force-push over
someone's branch.

It changes how a fence is hit. FENCE 1 arrives as the full attempt log with the hypothesis
each attempt tested. FENCE 2 arrives as the two readings and what each implies. FENCE 3
names the exact irreversible operation and its target. FENCE 4 names the missing or expired
credential without exposing it. The user answers once and the run resumes.

## The failure it prevents

Both of them. The supervised "autonomous" run that needed a human in the loop the whole
time, and the unsupervised one that rewrote history at 2am.
