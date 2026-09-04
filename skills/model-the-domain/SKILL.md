---
name: model-the-domain
description: "Encode stateful workflow rules in a state machine, typed record, queue, or registry instead of scattered conditionals. Use when a process adds phases, modes, retries, or shared invariants."
---

# model-the-domain

Choose a structure that matches the work before adding another branch.

## Rules

- Use a state machine for lifecycle phases and legal transitions.
- Use a typed record for a slice, its owner, its evidence, and its blockers.
- Use a queue for independent work and a conflict matrix for shared files.
- Use a registry or table for route matching instead of repeating keyword checks in prose.
- Put invariants at the boundary where state changes. Do not make every phase remember
  them separately.
- Keep plain local code when the current shape is already clear. An abstraction must remove
  branches, invalid states, duplicate rules, or lifecycle risk.

## Test

List the legal states and transitions. A state that the data can represent but the process
cannot handle is a bug in the model.
