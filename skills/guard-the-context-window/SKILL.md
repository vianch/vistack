---
name: guard-the-context-window
description: "Treat context as the scarce resource — delegate reading, keep conclusions, and let per-role agents hold their own detail. Use when about to read many files, when a run is long, or when deciding what to put in the state file versus the transcript."
---

# guard-the-context-window

Context is the budget. Everything else is cheap by comparison.

## The rule

- Delegate the reading. A role that must read twelve files reads them in its own session
  and returns the conclusion. The coordinator holds conclusions, not file dumps.
- Write state to disk, not to the transcript. `.claude/state/<slug>.json` and its ledger
  are the memory; the transcript is a cache that will be summarized.
- Do not re-derive. A fact established once, in the ledger, is not re-established.
- No progress narration. Every "now I'll look at…" is spend with no return.
- A run that needs the whole repo in context is mis-sliced. Go back to `slice-plan`.

## What it changes

It changes who reads. `analyst` reads the call sites and returns an impact map of
`file:line` refs; the coordinator never opens those files. It changes what a phase
boundary reports: the decision and its evidence, not the path taken to it.

It changes the state file's job. The state file exists so that a session can die without
taking the run with it — which is only true if it is written on every transition rather
than at the end.

## The failure it prevents

The run that gets dumber as it goes. Early context is summarized away, the invariants go
with it, and by phase four an agent re-litigates a decision made in phase one and reaches
the other answer.
