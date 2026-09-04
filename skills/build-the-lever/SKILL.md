---
name: build-the-lever
description: "Build the smallest rerunnable script, generator, validator, or skill that performs or proves nontrivial work. Use for repeated edits, audits, plans, and overnight checks."
---

# build-the-lever

Nontrivial work should leave behind a tool a reviewer can rerun.

## Rules

- Build the smallest useful lever after learning the first unit's recipe.
- Make it safe to run twice and explicit about its inputs and outputs.
- Prefer a validator for structural contracts, a script for repeated edits, and a
  captured artifact for behavioral proof.
- Keep the lever outside the worker's write scope when workers use it as their contract.
- Skip a lever only for a few obvious edits that do not need a repeatable check.

## Test

Run the lever on the first unit, then rerun it. The second run must produce the same result
without duplicating files, state, or external comments.
