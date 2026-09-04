---
name: never-block-on-the-human
description: "Proceed with reversible work and let the human review the result later. Use when an agent is tempted to ask for permission on implementation, decomposition, documentation, or other recoverable work."
---

# never-block-on-the-human

The human supervises asynchronously. Make a reasonable reversible choice, record it, and
continue. Waiting is a cost, not a safety mechanism.

## Rules

- Proceed with code, tests, docs, task splits, worktree setup, and other recoverable work.
- Record the choice, its reason, and the evidence in the run ledger.
- Surface the result at the next phase boundary so the human can redirect it.
- Ask only when the answer changes product behavior, a public contract, or an irreversible
  action.
- A request to state a plan is not permission to execute it. State it and wait for an
  explicit go when the playbook requires one.

## Test

If the action can be reverted without data loss, force-push, a production change, a secret
operation, or an external message, proceed. If not, route it to the matching fence.
