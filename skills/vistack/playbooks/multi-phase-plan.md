# Playbook: multi-phase-plan

**Match when work is large, cross-cutting, or has no narrow route.** The deliverable is a
plan a fresh coordinator can execute. Do not implement while writing it.

## Steps

1. State the end-state predicate, affected repositories or services, rough unit count,
   expected effort, dependencies, and wall-clock budget. If one agent can finish it in the
   current session, use `overnight` instead.
2. Read the principles index. Use `foundational-thinking` to identify shared data and
   scaffolding, `subtract-before-you-add` to remove unnecessary units, and
   `never-block-on-the-human` for reversible planning choices.
3. Explore the affected area in disjoint read-only slices. Each finding cites files, lines,
   commands, or artifacts. Keep the main plan compact.
4. Settle empirical questions with `prototype` before asking the human. Ask only about a
   product decision or public contract that no experiment can settle. Record unresolved
   readings and their consequences as FENCE 2 dossiers.
5. Write one plan section per PR or independently verifiable unit. Every section names the
   files, owner, dependency, check, evidence, and rollback or stop condition.
6. Build the conflict matrix. Shared files serialize. Disjoint units may run in parallel in
   separate worktrees. Re-cut a plan whose matrix is dense.
7. Choose `autopilot-stack`, `autopilot-full`, or `overnight` as the execution playbook and
   state who may merge. viStack's default is draft PRs and no merge.
8. Validate the plan with the repository's structural checker when one exists. Otherwise
   run `scripts/check-playbooks.mjs` and inspect every referenced path.
9. Record the plan path and evidence in the ledger. Stop planning here. Execution begins only
   when the chosen execution playbook is entered.
