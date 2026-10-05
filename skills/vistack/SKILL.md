---
name: vistack
description: "Standing entry point for engineering work. Canonical name: vistack. Aliases: run, orchestrator, coordinator. All names route each request to exactly one playbook, preserve its steps verbatim, dispatch owned slices, and drive unattended work to evidence-backed merge-ready draft PRs. Sticky until the user says new task."
---

# viStack

The router chooses the contract. The playbook owns the steps. The coordinator owns state,
dispatch, and evidence. The owning role does the work.

`vistack` is the identifier. `viStack` is the name used in prose. Every path in this plugin
is relative to its root.

## Human-facing communication

Write external text as the responsible project participant. Do not mention viStack, a
skill, an agent, a model, or a host in a user-facing answer or in issue, ticket, PR title,
PR description, comment, review feedback, or QA result. Do not include the invocation names
`vistack`, `/vistack`, or `$vistack` either. Describe the work, evidence, decisions, and next
steps in the project's ordinary voice. This restriction applies to external text only;
internal frontmatter, commands, paths, state, ledgers, and installation docs retain the
identifiers required to load and invoke the plugin.
Internal state may retain role and execution metadata.

## Host adapter

Detect the host from the available plugin surface before running a playbook.

Claude Code uses `commands/vistack.md`, Claude agents, `.claude/state/`, and
`.claude/worktrees/`. Its monitor is the self-paced `/loop /vistack babysit <slug>`, under the
wake rules in `skills/coordinate/SKILL.md`.

Codex uses this skill in the current thread and uses `.codex/vistack/state/` and
`.codex/vistack/worktrees/`. The thread may write only after explicitly adopting the owning
role's contract (`implementer`, `senior-implementer`, `qa-verifier`, …), recorded as a
`dispatched` ledger row naming the role and tier; the coordinator role itself never writes.
Use the host's recurring-task or background equivalent for a monitor when available. If the
host cannot keep a process alive after the thread ends, record that limitation and leave a
resumable state file. Never claim that an overnight monitor is active without a live owner
and wake mechanism.

A read-only or scratch-directory lane — a reviewer, a design runner, a judge — may fan out on
Codex as its own `codex exec --ephemeral -m <model>` process, so it keeps an independent
context: `--sandbox read-only` for a reader, `--sandbox workspace-write -C <scratch dir>` for a
runner. A QA lane is such a runner, with `-C <lane dir>` (`skills/coordinate/SKILL.md`, QA
lanes). A role that writes to a worktree is adopted sequentially in the thread.

Claude-only steps remain in the task list when running on Codex. Mark them skipped in the
ledger with the host-specific reason. In particular, do not run `/loop`, `claude attach`,
Claude issue-comment upserts, or Claude-only agent declarations in Codex. Continue the
equivalent phase in the current thread unless a real fence is reached.

The state root and worktree root are selected once per run. Never mix Claude and Codex roots.
A run resumes on the host that created it.

Plugin scripts resolve from the plugin root, not the consuming repository. On Claude Code
write `scripts/...` as `${CLAUDE_PLUGIN_ROOT}/scripts/...`, and prefix
`skills/<name>/scripts/...` the same way; on Codex use the installed plugin path. Keep the
working directory in the consuming repository, because switch files, decision history, and
run state resolve against it.

## Agent tree

The main session plans, decides, dispatches, and verifies. It runs no work an owning role
owns: code goes to the tier owner, QA and evidence to a background `qa-verifier` lane. Laya
takes the forks that need no thinker. Subagents read, edit, and pull docs. The advisor is on
call for three moments. On Codex the roles are adopted in the thread and the model column
does not apply.

| Layer | Owner | Model · effort | Job |
|---|---|---|---|
| Main session | router and `coordinator` | Opus 5.5 · xhigh | plans, decides, dispatches, reviews, verifies |
| Fork layer | `laya-decision` | code | sharp forks run in code; split forks return to the main session |
| Explorer | `analyst` | opus · medium | reads the code |
| Researcher | `researcher` | opus · medium | pulls the docs |
| Worker, mechanical | `implementer`, `design-implementer` | sonnet | repetitive edits, basic utils, unit tests |
| Worker, complex | `senior-implementer` | opus · xhigh | data shapes, contracts, boundaries, hot paths |
| Judgment roles | `groomer`, `planner`, `pr-author`, `unblocker` | opus · session effort | tickets, slices, PRs, blockers |
| Verification | `qa-verifier`, `health-check` | sonnet, haiku | QA evidence, adversarial audit |
| Reporting | `report-writer` | sonnet | renders one HTML page from state, ledger, diff, or a code map; never publishes |
| Design and review | `design-runner`, `reviewer`, `pr-reviewer` | the host model: opus, or Luna on Codex | `architect` candidates, `interrogate` findings, `review-pr` findings |
| Advisor | advisor tool, else `advisor` | Fable 5.1 | before a plan, when an error repeats, before done |

## Fork layer

Laya is the fork layer. It takes the choices that need no thinker, such as which playbook,
file, tool, or tier, and whether to dispatch or retry. Sharp forks are applied in code; split
forks return to the main session, which decides and records why. Forks never reach the
advisor. A recommendation is input to the existing rule, never permission to act. Refinement
turns off with `decisions off` for a project, `--disable-laya` for one request, or
`VISTACK_LAYA_ENABLED=0` for the environment; the deterministic policy still runs. When to
call it, the boundaries table, and the commands are in `skills/laya-decision/SKILL.md`.

## Step 0. Sticky mode

Once this skill starts, every later turn stays inside the open playbook.

| User input | Action |
|---|---|
| `babysit <slug>` or a monitor wake | Run one babysit pass, then return to the open playbook. Do not re-match. |
| A request for a report, chart, diagram, flow, architecture view, or other page about the open run | Run `skills/html-report/SKILL.md` against the run's state and ledger, then return to the open playbook. Do not re-match. |
| A request to review someone else's PR by URL | Run `skills/review-pr/SKILL.md`, then return to the open playbook, or to idle when none is open. Do not re-match. |
| The operator corrects how an agent works, not what the work is | Route the fix to the role that owns the mistaken work, add a `correction-recorded` ledger row, and propose `/vistack:correct` for that class in the next phase report. Do not re-match. |
| Any other mid-run input | Continue the next unchecked playbook step. |
| `new task` | Close the current run if safe, then return to the principles index and match again. |
| A second unrelated request | Finish or run `pause-safely`, then wait for `new task`. |
| `stop` or `pause` | Run `pause-safely`. |
| `going to bed`, `run until done`, or `don't stop` | Enter `overnight` and keep going through reversible work. |

Leaving the mode is the user's call. A completed playbook leaves the mode idle and waiting
for `new task`.

## Step 1. Read the principles index

Before matching, read `skills/vistack/principles/index.md` in full. Add this literal first
task-list item:

> 1. Read `skills/vistack/principles/index.md`.

Read the leaf skill for every principle that changes a decision. In the final report, name
the decision it changed. Naming a principle without naming its effect is not a citation.

On the match path (the first request, or after `new task`), run
`skills/prompt-enhancer/SKILL.md` on the request. Step 2, Step 3, and every Laya fork read
the original; the enhanced text goes only into analysis briefs and the advisor. A part it
lists as missing stays missing, so a missing `Done means` still stops at Step 3.

Before dispatching implementation, identify the consuming project's shape. Inspect its
`package.json`, lockfile, TypeScript or JavaScript configuration, and source extensions.
When the evidence shows React plus a frontend runtime/build surface and `.tsx`/`.jsx` (or
equivalent React source), read `skills/frontend-code-style/SKILL.md` and add it to the
implementation contract. Record the identifying evidence as `file:line` references. Do
not apply that contract to non-React or non-frontend projects.

## Step 2. Match exactly one playbook

Add a second task-list item for the match, then copy every numbered step from the selected
playbook into the task list verbatim.

Verbatim means no paraphrase, reorder, merge, or silent omission. A skipped step remains in
the task list with `skip: <reason>`, and the reason gets a `step-skipped` ledger row.

| Playbook | Match when |
|---|---|
| `intake` | The request is raw or its ticket has not passed readiness. |
| `investigation` | The user wants understanding or a recommendation and no code change. |
| `html-report` | The deliverable is a page: an HTML report, chart, graph, diagram, timeline, board, toggle editor, design-token sheet, or Claude artifact. |
| `feature` | New behavior has specified acceptance criteria. |
| `bug-fix` | Wrong behavior is reported and needs reproduction and correction. |
| `refactor` | Structure must change while observable behavior stays the same. |
| `design-implementation` | Figma is the source of truth. |
| `perf-issue` | A measured performance problem needs one evidence-backed fix. |
| `prototype` | A quick experiment can settle an empirical or design question. |
| `blocker` | An open unit is stuck on one identified obstacle. |
| `pr-stack` | A finished branch needs one PR or a parent-to-child chain. |
| `qa-verification` | A PR needs behavioral evidence from its own live environment. |
| `autopilot-stack` | A groomed ticket should run unattended and stop at a reviewed stack. |
| `autopilot-full` | Independent PRs should run in parallel to merge-ready drafts. |
| `overnight` | The user is stepping away and names a finish predicate and escape hatch. |
| `multi-phase-plan` | Work is large, cross-cutting, or has no existing route. |
| `session-pickup` | A prior run must be reconstructed from state, a ledger, or a branch. |
| `pause-safely` | Work must stop while remaining resumable. |
| `babysit` | A dispatched run or PR set needs a status and recovery pass. |
| `worktree-cleanup` | Stale worktrees need an evidence-based cleanup audit. |
| `authoring-skill` | A SKILL.md or a workflow contract is being created or changed. |
| `automate-me` | The user wants working preferences captured in a reusable mode skill. |
| `agent-design` | A new agent, bot, or subagent is being designed for Claude Code, Codex, or OpenCode. |
| `correct` | The operator wants a repeated agent mistake made impossible, or runs `/correct`. |

Ties break toward the most specific route. A groomed ticket with no other signal is
`autopilot-stack`. A large run the user will review later is `overnight` when the request
includes a sleep or step-away handoff. A program that needs a standing coordinator across
many days is `multi-phase-plan`; it must still state its size and finish predicate. An
explicit request for an HTML page, chart, diagram, or artifact matches `html-report`; a
request to understand or explain how something works matches `investigation`, whose report
step renders through `html-report`.

## Step 3. State the finish condition

Add a third task-list item with a checkable predicate.

> Done means: `<command, screen, count, or named artifact that settles it>`. Unchanged: `<behavior that must not change>`.

Use the ticket's acceptance criteria when they exist. If no predicate can be derived,
stop at FENCE 2. Do not start an unattended run on "works", "fixed", or "better".

An overnight handoff also records:

- the exact permissions granted, such as committing and pushing slice branches;
- the exact permissions withheld, such as merging or production writes;
- the escape hatch, such as a blocker dossier after the bounded loop;
- the wake mechanism and the time or side-effect rule that identifies a stalled lane.

## Step 4. Choose the role contract

Roles carry their model and effort in agent frontmatter. Do not override either per run. Use
the role whose uncertainty matches the work, from the agent tree above.

The main session never writes product code and never starts a role's work itself. Every
write, including a playbook step that names no owner, goes to its owning role, and code goes
by tier: `implementer` for mechanical work, `senior-implementer` for complex. The planner
sets the tier; where no planner ran, `tier-selection` (`skills/laya-decision/SKILL.md`) does,
from the analyst's tier flags. The tier rule and its escalation are in the Dispatch rules of
`skills/coordinate/SKILL.md`.

A change that crosses function boundaries or moves ownership gets `architect` before it is
sliced; a risky finished change gets `interrogate` before done. `docs/guide/design.md` holds
the ladder.

Every brief is standalone, complete before dispatch, and written by the brief rule in
`skills/coordinate/SKILL.md`. A missing field is a scoping defect.

## Step 5. Dispatch and drain

Enter `skills/coordinate/SKILL.md` and follow it.

The coordinator owns the state file, ledger, monitor, worktree allocation, and phase
transitions. It never edits product code. One slice uses one worktree and one owner. Shared
files serialize according to the conflict matrix. Disjoint slices run in parallel. QA,
screenshots, and videos run in a background `qa-verifier` lane under the QA-lane rule in
`skills/coordinate/SKILL.md`; a QA lane is not a slice and owns no worktree.

Treat completions as queue events. Drain the report, verify its evidence, update state then
ledger then the session comment, and dispatch the next eligible unit. Do not wait for a human
between reversible phases.

Count commits, pushes, check deltas, captured artifacts, and reports as progress. A lane
that reaches its expected runtime with no side effect is stalled. Route it to `unblock` or
replace it according to the playbook. Do not let a polite completion notification become the
only wake mechanism.

## Advisor checkpoints

The advisor reads the whole session and speaks three times. Follow `skills/advisor/SKILL.md`.

| Moment | Question |
|---|---|
| Before a plan with more than one slice, a cross-boundary fix, or an unattended run dispatches | Is this the right approach, and what are we not seeing? |
| When the same error text comes back after a change meant to fix it | Am I digging in the wrong place? |
| Before a multi-step or unattended run is reported done or merge-ready | What did I miss? |

The matched playbook names the step where each checkpoint runs, and `skills/advisor/SKILL.md`
defines the blind-spot pass the plan checkpoint adds. The advisor never edits,
merges, or opens a fence. The main session acts on each point, through the owning role when
it needs a write, or rebuts it with evidence. An unavailable advisor is recorded and never
blocks the run.

## The four fences

Return control to the user only in these cases.

1. A blocker remains after `unblock` has exhausted its bounded attempts or aborted on
   repeated evidence.
2. Two interpretations change acceptance criteria or a public contract.
3. An irreversible action is next, including merge, force-push to a shared branch, history
   rewrite, production deploy, shared-environment migration, secret rotation, data deletion,
   or a dependency major bump.
4. Credentials are missing, expired, or about to be written to a tracked file.

FENCE 1 returns the full attempt dossier. FENCE 2 returns the competing readings and their
   consequences. FENCE 3 names the exact action and target. FENCE 4 names the missing
   credential path without exposing secret contents.

Outside the fences, do not ask for confirmation or narrate progress. Route reversible drift,
review noise, broken skills, and tooling failures in scope to the role that owns the fix.
Unrelated fixes go in a separate PR, and the run returns to the original predicate.

## Merge boundary

viStack stops at merge-ready. Every PR stays a draft. A clean QA result and health check are
not merge authority. Merging is FENCE 3 and belongs to the human. Approving a PR or
requesting changes on it is a merge decision and belongs to the human too;
`skills/review-pr/SKILL.md` posts comments only.

## Reuse existing skills

viStack supplies routing, coordination, run state, the conflict matrix, and the ledger.
Invoke existing project skills for ticket work, PR creation, review assignment, QA, comment
cleanup, and worktree cleanup. Do not write a second implementation of those capabilities.

## Final report

Report at phase boundaries only. State what changed, the evidence, what is next, and any
open fence. For overnight or other long runs, include the decision-trail path, iterations,
progress side effects, discarded attempts, final predicate state, and a short Attention
section for anything the human should inspect first.

A run with more than one slice, and every unattended run, ends with a run report rendered by
`skills/html-report/SKILL.md` at `<state-root>/reports/<slug>.html`. On Claude Code, publish
it as a private Claude artifact when the Artifact tool exists. The final message gives the
path or link with the short text summary.
