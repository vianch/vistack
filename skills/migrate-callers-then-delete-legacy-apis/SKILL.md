---
name: migrate-callers-then-delete-legacy-apis
description: "Move all internal callers to a chosen API and remove the old path in the same wave. Use for internal renames, migrations, and workflow contract changes with no external compatibility requirement."
---

# migrate-callers-then-delete-legacy-apis

An internal migration is complete when the old path is gone. Keeping both paths makes the
next run guess which contract is real.

## Rules

- Inventory every caller before changing the API.
- Migrate callers in disjoint groups where the conflict matrix permits it.
- Delete the old API and tests that protect only its implementation details in the same
  planned wave.
- Use an adapter only when an external contract requires it. Record its owner and removal
  condition in the ledger.
- Verify the new contract and search for zero old callers before declaring done.
