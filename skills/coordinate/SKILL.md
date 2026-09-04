---
name: coordinate
description: "Dispatch per-role agents through a playbook, maintain resumable state and an append-only decision ledger, and report at phase boundaries. Use when a slice plan exists or a run needs a state transition."
---

# coordinate

The dispatch layer moves a run between phases. It owns coordination state and evidence. It
never edits product code.

## Host paths

Resolve these once at startup.

| Host | State root | Worktree root | Recurring monitor |
|---|---|---|---|
| Claude Code | `.claude/state/` | `.claude/worktrees/` | `/loop 10m /vistack babysit <slug>` |
| Codex | `.codex/vistack/state/` | `.codex/vistack/worktrees/` | the host's recurring-task or background equivalent |

In the contracts below, `<state-root>` and `<worktree-root>` mean the resolved paths. Do not
mix roots in one run. A run resumes only on the host that created it.

## Startup invariant

Establish exactly one live monitor before dispatching a slice or reviewing a PR. A persisted
`monitor.status: active` value is only a claim. Verify the current owner and live mechanism.
If either is missing, start one monitor and record it. If verification fails, record a
blocker and do not dispatch.

On pickup, the new coordinator reclaims the monitor explicitly. On pause, a fence, or the
last merge-ready slice, stop it. Never start a second monitor to cover a stale first one.

## Setup, once per run

1. Derive a stable slug from the issue and a short kebab descriptor.
2. Ensure `<state-root>` and `<worktree-root>` are git-ignored in the consuming repository.
   Do not commit run bookkeeping.
3. Confirm `git remote -v` stays inside the consuming project's approved repositories.
4. Write the initial state file and open the ledger before dispatch.
5. Record the objective, finish condition, unchanged behavior, host, monitor mechanism,
   permissions, and escape hatch. Preserve unknown keys when updating an existing state file.

## State file

`<state-root>/<slug>.json` is the resume point. Update it on every transition. The fields
below are additive to the existing schema, so pickup can read older runs.

```json
{
  "slug": "21510-progressbar",
  "issue": "https://github.com/ORG/REPO/issues/123",
  "playbook": "autopilot-stack",
  "mode": "unattended",
  "objective": "Replace the two Loader call sites with ProgressBar",
  "finish_condition": "ProgressBar renders at 0/50/100%; two call sites use it; suite green",
  "unchanged": "Existing Loader consumers keep their current visual output",
  "permissions": "Commit and push slice branches. Leave PRs as drafts. Do not merge.",
  "escape_hatch": "Stop with a blocker dossier after the bounded unblock loop",
  "base_branch": "main",
  "host": "claude-code",
  "coordinator_session_id": "session_011xyz",
  "monitor": {
    "interval": "10m",
    "mechanism": "/loop 10m /vistack babysit <slug>",
    "owner": "session_011xyz",
    "status": "active",
    "last_pass_at": null,
    "last_progress_at": null
  },
  "slices": {
    "primitive": {
      "agent": "implementer",
      "model": "sonnet",
      "session_id": "session_011abc",
      "worktree": ".claude/worktrees/21510-progressbar-primitive",
      "branch": "user/issue-progressbar-primitive",
      "pr": null,
      "phase": "planned",
      "blockers": [],
      "retries": 0
    }
  }
}
```

`phase` is one of `planned`, `dispatched`, `implementing`, `pr-open`, `qa`, `audit`,
`merge-ready`, `blocked`, or `paused`. `blockers[]` contains `{ "summary", "attempts",
"last_evidence" }`.

## Ledger

`<state-root>/<slug>.tsv` is append-only and keeps the existing seven columns:

```text
ts	phase	slice	decision	reason	evidence	result
```

Log playbook matches, skipped steps, dispatches, transitions, attempts, side fixes, monitor
restarts, reconciliations, and verification results. Evidence is a path, URL, SHA, command
output, or artifact. It is not a paragraph.

Use `decision: step-skipped` for every retained step that does not run. A decision without
a ledger row did not happen.

## Dispatch rules

- One slice uses one worktree, one branch, and one owning agent.
- Before each wave, the number of worktree directories must equal the number of in-flight
  slices. A mismatch stops dispatch.
- Read the conflict matrix before every wave. Shared files serialize. Disjoint slices may
  run in parallel.
- Every agent brief names the goal, scope, files it may not touch, acceptance checks, exact
  verification commands, timebox, forbidden actions, and report shape.
- A completion is a queue event. Drain it, update state, ledger, and session comment, then
  dispatch the next eligible unit without waiting for a human.
- A lane that reaches its expected runtime without a commit, captured artifact, check delta,
  or report is stalled. Route it to `unblock` or replace it after the playbook's limit.
- A finished slice raises its PR immediately. Never batch.
- Every PR is one concern, at most 500 changed lines excluding lockfiles and generated
  files, assigned to the configured reviewers, and left as a draft.
- No owner, coordinator, or monitor merges. Merging is FENCE 3.

## Transition order

For every phase transition, write in this order.

1. State file.
2. Ledger row.
3. Session comment, or a host-local equivalent when the host has no issue-comment surface.

Reconcile before acting after a restart. Compare state with worktrees, branches, PRs,
comments, and live agent status. Record each divergence as `decision: reconciled`.

## Reporting

Report at phase boundaries only. State what changed, the evidence that proves it, and what
is next. Do not narrate tool calls or ask for confirmation outside the four fences.

## Exit

Stop when every slice is merge-ready or a fence is reached. Report the PR set, evidence per
PR, ledger path, monitor status, and open work. Leave every PR a draft. Never merge.
