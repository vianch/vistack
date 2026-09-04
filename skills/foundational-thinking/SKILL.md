---
name: foundational-thinking
description: "Choose the data shape, shared-state boundary, and scaffold order before writing workflow logic. Use when a change affects state, concurrency, routing, or many downstream phases."
---

# foundational-thinking

Structural choices protect simplicity. Choose the shared data and ownership rules before
writing the steps that consume them.

## Rules

- Define the core record and its legal states before adding lifecycle logic.
- Trace the dominant read and write paths before choosing a file or directory layout.
- Isolate state that concurrent actors could change. Do not rely on careful timing.
- Build shared scaffolding first when every later phase depends on it.
- Prefer explicit data and small commits over clever compatibility layers.
- Subtract dead weight before laying a new foundation.
