---
name: coordinate
description: "Dispatch per-role agents through a playbook's phases, maintain the run's state file and decision ledger, and report at phase boundaries only. Use when a slice plan exists and work needs dispatching, or when a run's state file and ledger need updating on a transition."
---

# coordinate

The dispatch layer. It moves phases, launches roles, writes state, and reports at
boundaries. **It never edits product code** — the moment the coordinator writes code,
nobody is coordinating.

## Coordinator startup invariant

Every new coordinator must establish exactly one live review monitor before it dispatches a
slice or reviews a PR. A persisted `monitor.status: active` value is not evidence that the
monitor is running: the new coordinator must verify ownership in the current session or
start a new monitor. If the monitor cannot be verified as active, do not dispatch work;
record the blocker and return it as a fence.

The monitor belongs to the coordinator session, not to the worktree or an implementer. On
coordinator replacement or pickup, the new coordinator reclaims the monitor explicitly and
records the new owner before continuing. There is exactly one monitor per run.

## Setup, once per run

1. Derive the slug: the issue number and a short kebab descriptor, e.g. `21510-progressbar`.
2. Ensure `.claude/state/` is git-ignored. If it is not, add it to `.gitignore` — this is a
   per-repo input and a run must not commit its own bookkeeping. `.claude/worktrees/`
   likewise.
3. Confirm the realm: `git remote -v` shows only `the project organization and its approved repositories`.
4. Write the initial state file and open the ledger.

## The state file — `.claude/state/<slug>.json`

Keyed by slice. Updated on **every** transition, not at the end — it is the resume point
for `session-pickup`, and a state file written at the end is a state file that does not
exist when it is needed.

```json
{
  "slug": "21510-progressbar",
  "issue": "https://github.com/ORG/REPO/issues/123",
  "playbook": "autopilot-stack",
  "finish_condition": "ProgressBar renders at 0/50/100% in Storybook; the two Loader call sites use it; suite green",
  "unchanged": "existing Loader consumers keep their current visual output",
  "base_branch": "main",
  "coordinator_session_id": "session_011xyz…",
  "monitor": {
    "interval": "10m",
    "loop_command": "/loop 10m /vistack babysit <slug>",
    "status": "active",
    "last_pass_at": null
  },
  "slices": {
    "primitive": {
      "agent": "implementer",
      "model": "sonnet",
      "session_id": "session_011abc…",
      "worktree": ".claude/worktrees/21510-progressbar-primitive",
      "branch": "user/issue-progressbar-primitive",
      "pr": "https://github.com/ORG/REPO/pull/456",
      "phase": "qa",
      "blockers": [],
      "retries": 0
    }
  }
}
```

`phase` is one of: `planned` · `dispatched` · `implementing` · `pr-open` · `qa` ·
`audit` · `merge-ready` · `blocked` · `paused`.

`blockers[]` holds one entry per open blocker: `{ "summary", "attempts", "last_evidence" }`.

## The ledger — `.claude/state/<slug>.tsv`

One row per decision. Tab-separated, append-only, seven columns:

```
ts	phase	slice	decision	reason	evidence	result
```

Full column semantics and worked rows: `docs/guide/ledger-format.md`.

A decision without a row did not happen. This includes skipped playbook steps — the step
stays in the task list, and the reason lives here.

## Dispatch rules

- **Start and verify the monitor at coordinator startup.** In the current coordinator
  session, run `/loop 10m /vistack babysit <slug>` (or the consuming client's equivalent
  recurring-task command), record `monitor.status = active`, and append a monitor-started
  ledger row before any agent is launched. The existing `coordinator_session_id` identifies
  the owner. This is a startup gate and a standing routine, not a one-off reminder.
- The monitor owns no product changes. Every pass reads the state and ledger, enumerates
  every PR recorded under `slices.*.pr`, and runs the `babysit` checks against all of them:
  liveness, CI, draft status, size, concern scope, and review/QA evidence. It must also
  discover newly opened agent PRs and add their links to the state before checking them.
- If a pass finds a stalled agent, red CI, failed QA, review comment, invariant violation,
  or a newly opened PR, route or record the owning slice and update state → ledger → session
  comment in that order. A clean pass updates only `monitor.last_pass_at` and records a
  `monitor-pass` ledger row.
- A `monitor.status` of `active` is a claim about a loop, not proof of one. Any new
  coordinator, pass, or pickup that finds no running loop behind that claim, or finds a
  different coordinator session in `coordinator_session_id`, restarts exactly one monitor
  before doing more work and appends a monitor-started ledger row. The coordinator session
  id and ledger survive the session that created them.
- Do not start a second loop if one is already active. On `pause-safely`, a fence, or when
  every slice is `merge-ready`, cancel `/loop`, set `monitor.status = stopped`, and record
  the reason. A stopped loop is resumed only by a new coordinator session or explicit
  babysit request.

- One slice, one worktree, one agent. `.claude/worktrees/<slug>-<slice>`.
- Before dispatching, assert the invariant: the number of directories under
  `.claude/worktrees/` equals the number of in-flight slices. Not equal → stop.
- Slices sharing a file are serialized per the conflict matrix from `slice-plan`. The
  second starts from the first's branch, after its PR opens.
- Models come from agent frontmatter. Do not override per-run.
- Immediately after each dispatch, upsert the session comment (`session-ledger`).
- A finished slice raises its PR immediately. Never batch.

## Phase transitions

On every transition, in this order:

1. Write the state file.
2. Append the ledger row.
3. Upsert the `Engineering work — agent sessions` comment in the project's ordinary human voice.

Doing them in the other order loses the run if the session dies between steps.

## Reporting

Report at phase boundaries only. A boundary report is three things: what changed, the
evidence, and what is next. No narration between boundaries, no confirmations, no status
questions — outside the four fences (`autonomy-has-fences`).

## Exit

All slices `merge-ready`, or a fence hit. Report the PR set, the evidence per PR, the ledger
path, and anything left open. Leave every PR a draft. **Never merge.**
