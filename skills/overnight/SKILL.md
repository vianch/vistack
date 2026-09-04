---
name: overnight
description: "Run a bounded engineering task while the user is away. Use when the user says going to bed, stepping away, run until done, or asks for unattended work with a checkable finish condition."
---

# overnight

Use `skills/vistack/playbooks/overnight.md` as the executable contract. This skill is a
direct entry point for the same mode.

Before starting, record the objective, the exact finish predicate, unchanged behavior,
granted permissions, withheld permissions, escape hatch, state root, worktree root, and
wake mechanism. Missing finish criteria are FENCE 2.

Run one task or a clearly bounded queue in isolated worktrees. Make one evidence-backed
change, verify it against the real artifact, commit only when the predicate moves, and
append the decision to the run ledger. Discard changes that did not help.

Keep one monitor. Reconcile its owner and the run state after restarts. A stale active flag
does not keep work alive. Stop on the predicate, a real fence, or the explicit user stop.

viStack leaves PRs as drafts and never merges. Merge, production deployment, data deletion,
secret changes, and other irreversible actions remain human-owned fences.
