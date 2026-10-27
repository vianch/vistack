---
name: vistack
description: "Standing entry point for engineering work. Canonical name: vistack. Aliases: run, orchestrator, coordinator. All names route each request to exactly one playbook, preserve its steps verbatim, dispatch owned slices, and drive unattended work to evidence-backed merge-ready draft PRs. Sticky until the user says new task."
---

# viStack

The router chooses the contract. The playbook owns the steps. The coordinator owns state,
dispatch, and evidence. The owning role does the work.

Every path in this plugin is relative to its root. External text follows the External naming boundary in
`skills/vistack/principles/index.md`.

## Step 0. Sticky mode

Once this skill starts, every later turn stays inside the open playbook.

| User input | Action |
|---|---|
| `babysit <slug>` or a monitor wake | Run one babysit pass, then return to the open playbook. Do not re-match. |
| A request for a report, chart, diagram, flow, architecture view, or other page about the open run | Run `skills/html-report/SKILL.md` against the run's state and ledger, then return to the open playbook. Do not re-match. |
| A request to review, comment on, or give feedback on someone else's PR by URL | Run `skills/review-pr/SKILL.md`, then return to the open playbook, or to idle when none is open. Do not re-match. |
| A how, why, teach, or recall question that needs only an answer in the thread | Run `skills/understanding/SKILL.md`, then return to the open playbook, or to idle when none is open. Do not re-match. |
| A request for a handoff, or to pick one up | Run `skills/handoff/SKILL.md`, then return to the open playbook, or to idle when none is open. Do not re-match. |
| `/vistack:review-watch` with `on`, `off`, `status`, or `pass`, or its loop firing | Run `skills/review-watch/SKILL.md` with that argument, then return to the open playbook, or to idle when none is open. Do not re-match. |
| The operator corrects how an agent works, not what the work is | Route the fix to the role that owns the mistaken work, add a `correction-recorded` ledger row, and propose `/vistack:correct` for that class in the next phase report. Do not re-match. |
| Any other mid-run input | Continue the next unchecked playbook step. |
| `new task` | Close the current run if safe, then return to the principles index and match again. |
| A second unrelated request | Finish or run `pause-safely`, then wait for `new task`. |
| `stop` or `pause` | Run `pause-safely`. |
| `going to bed`, `run until done`, or `don't stop` | Enter `overnight` and keep going through reversible work. |

A completed playbook leaves the mode idle until `new task`.

## Step 1. Read the principles index

Read the index in full before matching, and add this literal first task-list item:

> 1. Read `skills/vistack/principles/index.md`.

Read the leaf skill for every principle that changes a decision.

On the match path (first request or `new task`), run `skills/prompt-enhancer/SKILL.md` on
the request. If the `analyst` project shape is a React frontend
(`skills/frontend-code-style/SKILL.md`, Project-shape detection), brief implementers with
that skill.

## Step 2. Match exactly one playbook

Add a second task-list item for the match, then copy every numbered step from the selected
playbook into the task list verbatim: no paraphrase, reorder, merge, or silent omission. A
skipped step stays in the list as `skip: <reason>`.

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
explicit request for an HTML page, chart, diagram, or artifact matches `html-report`. A
request to understand or explain something that needs a recommendation, several angles, or a
report matches `investigation`, whose report step renders through `html-report`; one that
needs only an answer in the thread runs `skills/understanding/SKILL.md` from Step 0.

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

Agent frontmatter sets each role's model and effort; never override either per run. The
planner sets the code tier, or `tier-selection` (`skills/laya-decision/SKILL.md`) where none
ran. Every brief is standalone and written by the brief rule in `skills/coordinate/SKILL.md`.

A change that crosses function boundaries or moves ownership gets `architect` before it is
sliced; a risky finished change gets `interrogate` before done. `docs/guide/design.md` holds
the ladder.

## Step 5. Dispatch and drain

Enter `skills/coordinate/SKILL.md` and follow it. The main session never writes product code
and runs no work an owning role owns, even for a playbook step that names no owner: code goes
to its tier owner and QA to a background `qa-verifier` lane, under the Dispatch rules and QA
lanes of `skills/coordinate/SKILL.md`.

The advisor speaks at three checkpoints: `plan`, `repeat`, and `done`. The matched playbook
names the step where each runs, and `skills/advisor/SKILL.md` owns the questions, the
blind-spot pass, and the ledger record; an unavailable advisor is recorded and never blocks
the run.

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

A fix unrelated to the finish predicate goes in a separate PR, and the run returns to the
original predicate.

## Merge boundary

viStack stops at merge-ready. Every PR stays a draft. A clean QA result and health check are
not merge authority. Merging is FENCE 3 and belongs to the human. Approving a PR or
requesting changes on it is a merge decision and belongs to the human too;
`skills/review-pr/SKILL.md` posts comments only.

## Host adapter

Detect the host from the available plugin surface before running a playbook.

Claude Code uses `commands/vistack.md`, Claude agents, `.claude/state/`, and
`.claude/worktrees/`.

Codex uses this skill in the current thread and uses `.codex/vistack/state/` and
`.codex/vistack/worktrees/`. The thread may write only after explicitly adopting the owning
role's contract, such as `implementer`, `senior-implementer`, or `qa-verifier`, recorded as
a `dispatched` ledger row naming the role and tier; the coordinator role itself never
writes. If the host cannot keep a process alive after the thread ends, record that
limitation and leave a resumable state file. Never claim that an overnight monitor is active
without a live owner and wake mechanism.

A read-only or scratch-directory lane, such as a reviewer, a design runner, or a judge, may
fan out on Codex as its own `codex exec --ephemeral -m <model>` process, so it keeps an
independent context: `--sandbox read-only` for a reader, `--sandbox workspace-write -C
<scratch dir>` for a runner. A role that writes to a worktree is adopted sequentially in the
thread.

On Codex a Claude-only step stays in the task list, skipped under Step 2 with the host as
the reason: do not run `/loop`, `claude attach`, Claude issue-comment upserts, or
Claude-only agent declarations. Continue the equivalent phase in the current thread unless a
real fence is reached.

The state root and worktree root are selected once per run. Never mix Claude and Codex roots.
A run resumes on the host that created it.

Plugin scripts resolve from the plugin root, not the consuming repository. On Claude Code
write `scripts/...` as `${CLAUDE_PLUGIN_ROOT}/scripts/...`, and prefix
`skills/<name>/scripts/...` the same way; on Codex use the installed plugin path. Keep the
working directory in the consuming repository, because switch files, decision history, and
run state resolve against it.

## Agent tree

The work runs on three levels. The owner is the human client. The coordinator is the main
session. Workers are independent lanes with one job each, and they run in parallel. On Codex
the roles are adopted in the thread, writers one after another (Host adapter), and the model
column does not apply.

| Layer | Role | Model · effort | Job |
|---|---|---|---|
| Owner | the human client | human | sets requirements, corrects, answers fences, merges |
| Coordinator (main session) | router and `coordinator` | Opus 5.5 · xhigh | hears every owner requirement, plans, decides, delegates, reviews worker output, verifies evidence; writes only the state file, the ledger, and the session record |
| Fork layer | `laya-decision` | code | sharp forks run in code; split forks return to the main session |
| Explorer | `analyst` | opus · medium | reads the code |
| Researcher | `researcher` | opus · medium | pulls the docs |
| Worker, mechanical | `implementer`, `design-implementer` | sonnet · high | repetitive edits, basic utils, unit tests |
| Worker, complex | `senior-implementer` | opus · xhigh | data shapes, contracts, boundaries, hot paths |
| DevOps | `devops` | opus · medium | CI failures a slice did not cause, pipelines, environments, dependency and health audits |
| Judgment roles | `groomer`, `planner`, `pr-author`, `unblocker` | opus · high; `pr-author` medium | tickets, slices, PRs, blockers |
| Verification | `qa-verifier`, `health-check` | sonnet · medium, haiku | QA evidence, adversarial audit |
| Reporting | `report-writer` | sonnet · medium | renders one HTML page from state, ledger, diff, or a code map; never publishes |
| Design and review | `design-runner`, `reviewer`, `pr-reviewer`, `mention-responder` | opus · high, `mention-responder` medium; Luna on Codex | `architect` candidates, `interrogate` findings, `review-pr` findings, `review-watch` replies |
| Advisor | advisor tool, else `advisor` | Fable 5.1 | before a plan, when an error repeats, before done |

What crosses levels:

- Owner to coordinator: requests, kept verbatim; corrections; fence answers.
- Coordinator to owner: phase reports (Final report), fence questions
  (`skills/autonomy-has-fences/SKILL.md`), and merge decisions (Merge boundary).
- Coordinator and workers: a standalone brief goes down and a report with its evidence comes
  up (`skills/coordinate/SKILL.md`). A worker's question for the owner travels in that report.

| Job | Owning role |
|---|---|
| Analysis | `analyst` |
| Research | `researcher` |
| Advice and consult | the advisor at its checkpoints; `reviewer` through `interrogate` or `architect` |
| Development | `implementer`, `senior-implementer`, `design-implementer`, by tier |
| Addressing review comments | the slice's tier owner, through the project's `address-ai-reviews` |
| Answering comments that tag the operator on another author's PR | `mention-responder`, through `skills/review-watch/SKILL.md` |
| Feedback | the role that owns the mistaken work, with a `correction-recorded` row (Step 0); a repeat goes to `skills/correct/SKILL.md` |
| DevOps and project health | `devops`; `health-check` audits one diff, not the project |

## Fork layer

Laya is the fork layer. It takes the choices that need no thinker, such as which playbook,
file, tool, or tier, and whether to dispatch or retry. When to call it, its boundaries, its
off switches, and its commands are in `skills/laya-decision/SKILL.md`.

## Reuse existing skills

viStack supplies routing, coordination, run state, the conflict matrix, and the ledger.
Invoke the project's existing skills for ticket work, PR creation, review assignment, QA,
and worktree cleanup instead of writing a second implementation. Comment pruning is
viStack's own, `skills/pruning-comments/SKILL.md`, bound by path because another plugin may
ship a skill with the same name.

## Final report

Report at phase boundaries only. State what changed, the evidence, what is next, and any
open fence. For overnight or other long runs, include the decision-trail path, iterations,
progress side effects, discarded attempts, final predicate state, and a short Attention
section for anything the human should inspect first.

A run with more than one slice, and every unattended run, ends with a run report rendered by
`skills/html-report/SKILL.md` at `<state-root>/reports/<slug>.html`. On Claude Code, publish
it as a private Claude artifact when the Artifact tool exists. The final message gives the
path or link with the short text summary.
