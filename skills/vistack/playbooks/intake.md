# Playbook: intake

**Match when** the request is raw — no ticket, or a ticket that has not passed a readiness
gate. Ends by handing to another playbook. Writes no product code.

## Steps

1. Restate the request in one sentence: the behaviour observed, or the change wanted.
2. Classify it: bug · feature · refactor · design-implementation · investigation · unclear.
3. State the finish condition in checkable terms, and name the behaviour that must not
   change. If neither can be stated, stop — FENCE 2.
4. Dispatch `groomer`: raw request → specified ticket via `create-ticket`,
   shaped by `gathering-requirements`.
5. Run the readiness gate: `review-ticket`. Not ready → return to step 4
   with the gate's findings. Blocked on a product decision → FENCE 2.
6. Dispatch `analyst` read-only for the impact map: call sites, blast radius, existing
   patterns, and current test coverage of the touched paths, each with `file:line` refs.
7. Write `.claude/state/<slug>.json` with the ticket, the finish condition, and the impact
   map reference. Open the ledger.
8. Upsert the `Engineering work — agent sessions` comment on the issue (`session-ledger`), using the project's ordinary human voice.
9. Hand to the matching playbook from step 2, or to `autopilot-stack` if the ticket is now
   groomed and the run is unattended. Record the handoff as a ledger row.
