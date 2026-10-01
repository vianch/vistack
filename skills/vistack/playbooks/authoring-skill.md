# Playbook: authoring-skill

**Match when a SKILL.md or workflow contract is being changed.** The contract is the
product. A broken skill can silently disable the process it describes.

## Steps

1. State the behavior the skill should trigger, the host surfaces it supports, and a
   checkable load or routing condition.
2. Read the current skill, its linked files, the principles index, and the affected
   playbooks in full. Identify duplicate or obsolete instructions to delete.
3. Define the smallest contract. Keep routing in the router, execution in playbooks,
   coordination in `coordinate`, and domain rules in leaf skills. Follow
   `docs/guide/writing-contracts.md`.
4. Preserve the existing state and ledger keys unless a migration is explicitly planned.
   Add optional fields without deleting unknown fields during reconciliation.
5. Write or update the skill and its playbook. Use sentence-case headings, concrete
   instructions, and links to existing skills instead of pasted copies. Put recorded failure
   points in a Gotchas section, templates in `assets/`, detail read on demand in
   `references/`, and repeatable work in `scripts/`.
6. Validate frontmatter, name and path agreement, referenced files, route coverage, host
   adapters, numbered steps, and no silent skip rules.
7. Run `scripts/check-playbooks.mjs`. Fix every structural error. Run the repository's
   manifest or plugin inventory command when available.
8. When the change edits a skill description or a route row, measure trigger or route
   accuracy before and after on cases drawn from real requests, split into train and
   held-out sets before the first edit. Use the `claude-api` skill's `build-eval` and
   `hillclimb` workflows where available. Keep the edit only when the held-out set improves
   or holds; revert one that improves only the train set. Never paste a failing case into
   the skill.
9. Run `unslop` over the final prose. Read the final diff as a fresh agent. Remove
   instructions that do not change a decision. Record the decisions and validation output in
   the ledger.
10. Open a draft PR through `pr-stack`. Keep the version bump separate when the repository's
    release rules require one.
