---
name: minimize-reader-load
description: "Reduce the layers and hidden state a maintainer must hold to understand a workflow. Use when reviewing playbooks, state schemas, or repeated orchestration prose."
---

# minimize-reader-load

Maintainability is the work a reader must do to answer a question about the system.

## Rules

- Collapse pass-through instructions and one-use wrappers.
- Put each invariant at one boundary instead of repeating it in every consumer.
- Prefer a small table or state record over prose that hides a branching rule.
- Keep mutable state local and derive status from canonical records.
- Before adding a layer, name the reader work it removes.

## Test

A new maintainer should be able to answer where a run is, who owns it, and what can change
it from the state file and its linked contract in under 30 seconds.
