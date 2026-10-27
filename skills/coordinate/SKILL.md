---
name: coordinate
description: "Dispatch per-role agents through a playbook, maintain resumable state and an append-only decision ledger, and report at phase boundaries. Use when a slice plan exists or a run needs a state transition."
---

# coordinate

The dispatch layer moves a run between phases. It owns coordination state and evidence and
never edits product code. The main session runs no work an owning role owns: code goes to
the tier owner, QA and evidence to a background `qa-verifier` lane.

## Host paths

Resolve these once at startup.

| Host | State root | Worktree root | Recurring monitor |
|---|---|---|---|
| Claude Code | `.claude/state/` | `.claude/worktrees/` | self-paced `/loop` (see Monitor) |
| Codex | `.codex/vistack/state/` | `.codex/vistack/worktrees/` | the host's recurring-task or background equivalent, or one `scripts/watch-pr.py` process |

Below, `<state-root>` and `<worktree-root>` mean the resolved paths. Do not mix roots in
one run. A run resumes only on the host that created it.

## Startup invariant

Establish exactly one live monitor before dispatching a slice or reviewing a PR. A persisted
`monitor.status: active` value is only a claim. Verify the current owner and live mechanism.
If either is missing, start one monitor and record it. If verification fails, record a
blocker and do not dispatch.

## Monitor

What the run is waiting on decides how the coordinator wakes.

| Waiting on | Wake |
|---|---|
| A host-tracked lane: a subagent or a background command | Its completion event, plus one fallback heartbeat 20 to 30 minutes out. Do not poll it on a short timer. |
| External state the host cannot see: PR checks, CI, reviews, preview builds | A poll at the rate that state changes: about 5 minutes while checks run, 20 to 30 minutes while waiting on reviewers, or the `watch-pr.py` process below, whose exit is the event. |

A lane that hangs or dies without an event surfaces at the heartbeat, under the stall rule.

On Claude Code the monitor is the self-paced `/loop /vistack babysit <slug>`, each pass
setting its next wake from the table; `/loop 10m /vistack babysit <slug>` is the fallback
when self-pacing is unavailable.

Every pass reads PR state with `scripts/watch-pr.py --status-only`. One long-running
`python3 scripts/watch-pr.py --pr <n,…> --interval <s> --timeout <s>`, `--interval` at the
poll rate, is the loop's external-state wake; on a host with none it is the monitor itself,
recorded as `monitor.mechanism`. Exit codes: 0 merge-ready or merged, 2 conflicts, 3
unresolved review threads, 4 failing checks, 5 timeout, 6 changes requested or closed, 7
query failure, 8 no reviewer. It never runs beside a second `watch-pr.py` or monitor, never
writes to GitHub, and never merges.

The pass that finds every slice merge-ready or fenced stops the monitor, sets
`monitor.status` to `stopped`, and records the terminal state. A pause stops it the same
way and deletes the run's `auth.json` files (Exit). On pickup, the new coordinator reclaims
the monitor; never start a second one to cover a stale first.

## Setup, once per run

1. Derive a stable slug from the issue and a short kebab descriptor.
2. Ensure `<state-root>` and `<worktree-root>` are git-ignored in the consuming repository.
   Do not commit run bookkeeping.
3. Confirm `git remote -v` stays inside the consuming project's approved repositories.
4. Write the initial state file and open the ledger before dispatch.
5. Record the objective, finish condition, unchanged behavior, host, monitor mechanism,
   permissions, and escape hatch, preserving unknown keys in an existing state file. Record
   the request verbatim as `request` and the router's enhanced text as `request_enhanced`
   (`skills/prompt-enhancer/SKILL.md`), and append its `prompt-enhanced` ledger row. Pickup
   resumes from these keys and does not enhance again.

## State file

`<state-root>/<slug>.json` is the resume point. Update it on every transition. Its fields
are additive to the existing schema, so pickup reads older runs. `phase` is one of
`planned`, `dispatched`, `implementing`, `pr-open`, `qa`, `audit`, `merge-ready`, `blocked`,
or `paused`. The full example, the `qa` lane fields, and the `monitor` fields are in
`skills/coordinate/references/state-file.md`; read it at Setup.

## Ledger

`<state-root>/<slug>.tsv` is append-only and keeps the existing seven columns:

```text
ts	phase	slice	decision	reason	evidence	result
```

Log playbook matches, prompt enhancements, skipped steps, dispatches, QA lane dispatches and
supersessions, transitions, attempts, side fixes, monitor restarts, reconciliations, advisor
consultations, tier escalations, pilot results, failure triage, plan deviations,
verification results, and run reports. Evidence is a path, URL,
SHA, command output, or artifact, never a paragraph.

Use `decision: step-skipped` for every retained step that does not run. A decision without
a ledger row did not happen.

## Dispatch rules

- One slice uses one worktree, one branch, and one owning agent.
- Every write goes to the role that owns it, including a playbook step that names no owner:
  code, tests, and contract files to the slice's tier owner, a blocker fix to `unblocker`,
  an agent file to `agent-designer`, a page to `report-writer`, PR text to `pr-author`, and
  QA evidence to a `qa-verifier` lane. The coordinator writes only the state file, the
  ledger, the session record, and a lane's `otp.txt`. On Codex the thread adopts the role
  instead, under the router's Host adapter.
- Dispatch each slice to its tier's owner: mechanical work (repetitive edits, basic
  utilities, unit tests, a change that follows a named pattern) to `implementer`, complex
  work (a changed data shape or public contract, a boundary crossing, concurrency, auth,
  money, a measured hot path, or no pattern to follow) to `senior-implementer`.
  The planner sets the tier. Where no planner ran, call `tier-selection`
  (`skills/laya-decision/SKILL.md`) with the original request, the named pattern, and the
  analyst's tier flags, or the blast radius the playbook recorded. An unclear tier is
  complex. A `tier-mismatch` report re-dispatches the same slice, worktree, and branch to
  `senior-implementer`; record `tier-escalated`.
- Run the advisor `plan` checkpoint before the first wave and the `done` checkpoint before
  reporting merge-ready (`skills/advisor/SKILL.md`). Record `advisor-consulted` or
  `advisor-unavailable`.
- Before each wave, the worktree directory count must equal the in-flight slice count, or
  dispatch stops. A QA lane is not a slice and is not counted.
- Read the conflict matrix before every wave. Shared files serialize. Disjoint slices may
  run in parallel.
- A wave or queue of five or more lanes dispatches one pilot lane first. Fan out after the
  pilot's first side effect (a commit, captured artifact, or check delta) proves the brief,
  and record `pilot-passed`. A pilot that fails gets its brief fixed before any other lane
  starts, so a brief defect costs one lane instead of the wave.
- Write every brief in two parts. The role's static header comes first and stays identical
  across dispatches of that role: the role, the pointer to
  `skills/vistack/principles/index.md`, forbidden actions, the stall and flattened-returns
  stop rules below, and report shape. Slice fields come last: goal, writable files, files it
  may not touch, context as `file:line` pointers, acceptance checks with exact verification
  commands, and timebox. This order's reason is in
  `skills/guard-the-context-window/SKILL.md`. Run `skills/prompt-enhancer/SKILL.md` over the
  slice fields.
- A completion is a queue event. Drain it, update state, ledger, and session comment, then
  dispatch the next eligible unit without waiting for a human.
- A lane that reaches its expected runtime without a commit, captured artifact, check delta,
  or report is stalled. Route it to `unblock` or replace it after the playbook's limit.
- A lane whose last two iterations produced side effects but did not move the predicate
  stops and reports instead of spending the rest of its timebox: its returns have flattened,
  and the coordinator chooses the next approach. The stall rule covers a lane with no side
  effect, so the two never apply to the same lane.
- Two lanes serialized on the same file twice in one run go back to `slice-plan` to be
  re-cut: the slice boundary is wrong, and every later wave pays for it.
- A finished slice raises its PR immediately. Never batch.
- Every PR is one concern, at most 500 changed lines excluding lockfiles and generated
  files, assigned to the configured reviewers, and left as a draft.
- No owner, coordinator, or monitor merges. Merging is FENCE 3.

## QA lanes

QA, screenshots, and QA videos always run in a `qa-verifier` lane dispatched in the
background, so other lanes keep moving while a preview is exercised. A step that captures
QA evidence, a reproduction video included, dispatches one.

- **One lane per PR per head SHA.** A newer head supersedes the older lane: cancel it, set
  its `status` to `superseded`, and record `qa-superseded`. A stale lane's result is never
  posted or accepted.
- **Dispatch after the preview is ready**, waiting on the head's preview through the
  external-state wake. The stall rule counts from dispatch, so a building preview never
  charges the lane.
- **Its own evidence directory, no worktree:**
  `<state-root>/qa/<slug>/<slice-or-pr>/<head7>/`. Lanes share no evidence path.
- **`doctor` once per run.** The first QA lane is the pilot: it runs `qa-video.mjs doctor`
  before any other lane starts, and later briefs name its JSON so their lanes skip the
  install.
- **Shared resources serialize.** A shared QA tenant, login account, or mutable test event is
  a column in the conflict matrix (`skills/slice-plan/SKILL.md`); lanes that share one run
  in sequence. Posts to one PR serialize by the one-lane-per-PR rule.
- **Ordering.** `health-check` and the advisor `done` checkpoint wait for the lane's
  completion, because both read its results table.
- **Writes.** The lane appends its `qa-scenario` rows single-line with `printf >>`
  (`docs/guide/ledger-format.md`). `<slug>.json` and the session record stay
  coordinator-only.
- **OTP.** A lane's OTP message is a wake: set its `qa.status` to `waiting-otp`. Once
  `<dir>/otp-request.json` in its evidence directory exists with no `answeredAt` or
  `timedOutAt`, ask the user in chat for the code in one line, write it to `<dir>/otp.txt`
  with the Write tool, never a shell command, and set `running`. A late code is not
  written, and a request whose `requestedAt` plus `timeoutSeconds` has passed is treated as
  timed out even when the file lacks `timedOutAt`, because a killed lane writes nothing.
  The ledger's only OTP row is the lane's `otp-requested`, which records the
  `waiting-otp` transition. A timeout is not a fence: the lane parks at `waiting-otp` and
  the next monitor pass re-dispatches it once the user answers. An unattended run logs in
  once while the user is present, which covers only a target that exists before the run;
  each per-PR preview parks at `waiting-otp` until the user answers
  (`skills/qa-verify/SKILL.md`, OTP handshake).
- **Record.** Dispatch is a `dispatched` row in its QA lane form
  (`docs/guide/ledger-format.md`). The drain writes the slice's `qa` status, then a
  `progress` or `defect-routed` row.
- **Codex.** The lane runs as `codex exec --ephemeral --sandbox workspace-write -C <lane dir>`,
  with absolute paths for `--playwright` and the credential file because neither resolves
  under `-C`. Network access inside that sandbox is unverified; when the lane cannot reach
  the target, the thread adopts the `qa-verifier` role with a `dispatched` row. The thread
  posts the results to the PR after the lane exits.

## Transition order

For every phase transition, write in this order.

1. State file.
2. Ledger row.
3. Session comment, or a host-local equivalent when the host has no issue-comment surface.

Reconcile before acting after a restart. Compare state with worktrees, branches, PRs,
comments, and live agent status. Record each divergence as `decision: reconciled`.

## Reporting

Report per the router's Final report. Do not narrate tool calls or ask for confirmation
outside the four fences.

## Exit

Stop when every slice is merge-ready or a fence is reached. At exit, a pause, or a fence,
delete every `auth.json` under `<state-root>/qa/<slug>/`; it is a session credential.
When the router's Final report rule applies, render the run report
(`skills/html-report/SKILL.md`) before the advisor `done` checkpoint and refresh it at exit.
The coordinator records `report-rendered` with the page path, and `report-published` with
the artifact URL once published. Report the PR set, evidence per PR, ledger path, run report
path, monitor status, and open work. Leave every PR a draft. Never merge.
