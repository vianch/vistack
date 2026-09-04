---
name: autonomy-has-fences
description: "Run unattended everywhere except four named cases — unresolved blocker, acceptance-criteria ambiguity, irreversible action, credential problem. Use when deciding whether to ask the user, and when tempted to narrate progress or request confirmation."
---

# autonomy-has-fences

Unattended by default. Four places to stop. Both halves are the principle.

## The four fences

1. **Blocker unresolved** after the `unblock` loop — 20 attempts, or an early abort on
   three identical results.
2. **Ambiguity that changes acceptance criteria or a public contract.** Not "which name is
   nicer" — which behaviour is correct, or what a caller outside this repo can rely on.
3. **An irreversible action:** force-push to a shared branch, history rewrite, shared-env
   migration, secret rotation, production deploy, dependency major bump, merging anything.
4. **Credentials** missing, expired, or about to be written to a tracked file.

## The other half

Outside those four: no confirmations, no progress narration, no status questions. Report at
phase boundaries only. "Shall I continue?" mid-phase is a fence violation in the other
direction — it converts an unattended run into a supervised one and wastes the reason for
running it.

## What it changes

It changes what a stop costs, so it can be spent well. A run that stops eight times is not
autonomous and nobody will start another one. A run that never stops force-pushes over
someone's branch.

It changes how a fence is hit: with a dossier, not a question. FENCE 1 arrives as the full
attempt log with the hypothesis each attempt tested. FENCE 2 arrives as the two readings
and what each implies. The user answers in one message and the run resumes.

## The failure it prevents

Both of them. The supervised "autonomous" run that needed a human in the loop the whole
time, and the unsupervised one that rewrote history at 2am.
