---
name: show-me-your-work
description: "Review the durable decision trail for an unattended or multi-phase viStack run. Use for morning audits, catch-up reports, or work the user reviews after stepping away."
---

# show-me-your-work

viStack's `<state-root>/<slug>.tsv` is the canonical decision trail. Do not create a second
log with a competing schema. The state file records intent. The ledger records what happened.

## Audit the trail

1. Read the state file and ledger from the start. Use the last row per slice to establish
   the current phase.
2. Check that every row maps to a real action or checkpoint.
3. Follow every evidence pointer. A path, URL, SHA, command output, or artifact that does
   not resolve is an open gap.
4. Find important pivots, discarded attempts, reconciliations, skipped steps, and fences
   that are missing from the ledger. Add a truthful row before reporting.
5. Check that the final predicate was not relaxed and that no irreversible action was taken
   without a fence.
6. Return the run as a short review report with the current state, decisions that mattered,
   evidence, discarded work, open gaps, and an Attention section.

Keep ledger cells single-line and append-only. Use `docs/guide/ledger-format.md` for the
seven-column format and the allowed decision vocabulary.
