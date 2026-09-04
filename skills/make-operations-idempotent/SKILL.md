---
name: make-operations-idempotent
description: "Design lifecycle steps, commands, and monitor loops to converge after crashes, retries, and duplicate execution. Use when adding resume, overnight, scheduling, or state transitions."
---

# make-operations-idempotent

Every lifecycle operation answers two questions. What happens if it runs twice? What
happens if it stops halfway?

## Rules

- Reconcile existing state before creating new state.
- Identify work by stable content or ids, not creation order.
- Make retries converge instead of creating duplicate worktrees, comments, monitors, or
  ledger rows that claim different truths.
- Treat a persisted `active` flag as a claim. Verify the owner and the live process before
  reusing it.
- On restart, compare intent in the state file with reality, record each divergence, then
  resume the earliest unfinished phase.

## Test

Run the operation twice in a clean fixture. Then simulate a crash after each state-changing
step. The result must be one coherent state, one owner for shared resources, and a ledger
that records reconciliation rather than silently duplicating work.
