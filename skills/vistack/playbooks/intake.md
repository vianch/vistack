# Playbook: intake

**Match when the request is raw or its ticket is not ready.** Intake writes no product code.
It ends by handing a specified unit to the matching execution playbook.

## Steps

1. Restate the observed behavior or requested change in one sentence. Preserve the user's
   scope and finish language.
2. Classify it as bug, feature, refactor, design implementation, performance, investigation,
   or unclear. If it is unclear, name the two readings.
3. State the finish predicate and unchanged behavior. If neither can be derived, stop at
   FENCE 2.
4. Dispatch `groomer` to verify claims against the repository, derive acceptance criteria,
   and create or update the ticket through the project's ticket skill.
5. Run the readiness gate. If it fails for a reversible omission, return to step 4 with the
   gate findings. If it needs a product decision, return FENCE 2 with both readings.
6. Dispatch `analyst` for an evidence-backed impact map. Every entry cites `file:line`, a
   command, or an artifact.
7. Resolve the host paths. Write `<state-root>/<slug>.json` with the ticket, predicate,
   unchanged behavior, impact-map path, and next playbook. Open `<state-root>/<slug>.tsv`.
8. Upsert the session record or host-local equivalent. Do not create duplicate run records.
9. Hand off to the matching playbook, or `autopilot-stack` when the ticket is groomed and
   the user requested unattended execution. Record the handoff in the ledger.
