---
name: outcome-oriented-execution
description: "Drive migrations and multi-phase work toward a named, verifiable end state instead of preserving throwaway intermediate states. Use when a run could drift into compatibility layers or partial completion."
---

# outcome-oriented-execution

The finish condition is the target. Intermediate states are allowed only when they are
planned, scoped, and reversible.

## Rules

- Name the end state before starting the run.
- Give every intermediate state an owner, a next transition, and a check.
- Do not preserve a temporary compatibility path just to make an incomplete migration
  look stable.
- Keep the high-signal checks running while work is in progress.
- Run the full static and runtime verification at the end.
- Never relax the finish condition because the run plateaued.
