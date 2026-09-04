---
name: vistack
description: "Standing entry point for any unit of engineering work — an issue, task, bug, feature, refactor, design implementation, or investigation. Routes the request to exactly one playbook, copies that playbook's steps into the task list verbatim, and dispatches per-role agents. Use when the user runs /vistack, hands over a ticket or issue URL, reports a bug, asks for a feature or refactor, asks for a design to be implemented, or asks for work to be run unattended. Sticky: once entered, later turns stay in the mode until the user says `new task`."
---

# viStack

The router. It does not do the work — it decides which playbook owns the work, builds the
task list from that playbook without editing it, and hands each step to the role that owns it.

`vistack` is the identifier. **viStack** is the name used in prose. Both refer to this.

Every path in this plugin's skills, agents and docs is written relative to the plugin
root — `skills/…`, `agents/…`, `docs/…`.

## Human-facing communication

Write external text as the responsible project participant. Never mention the package,
skill, plugin, automation, agent, model, or host in an issue or task title, description,
comment, pull-request title or description, review feedback, QA result, or other text sent
to a project service. Do not add bot markers or automated attribution. Use the project's
normal first-person or team voice and describe the work, evidence, decisions, and next
steps directly. This rule applies when creating, editing, or replying to external text;
internal state may retain role and execution metadata.

## Execution hosts

viStack supports both Claude Code and Codex. Detect the current host from the available
plugin surface before executing the run.

### Claude Code

The `commands/vistack.md` slash command is the entry point. Claude loads `agents/*.md` as
role agents, uses its task list and recurring `/loop` monitor, and stores run state in
`.claude/state/` with slice worktrees in `.claude/worktrees/`.

### Codex

The `vistack` skill is the entry point, normally invoked as `$vistack`. Codex loads skills
from the Codex manifest but does not execute Claude's `commands/` or `agents/` directories.
Run the selected playbook in the current Codex thread, adopting each named role's contract
sequentially rather than attempting a Claude subagent dispatch. Keep the same order, gates,
finish condition, evidence requirements, and four fences. Use `.codex/vistack/state/` for the
JSON state and TSV ledger, and `.codex/vistack/worktrees/` for slice worktrees.

When copying a playbook into the Codex checklist, adapt only host paths: `.claude/state/`
becomes `.codex/vistack/state/`, and `.claude/worktrees/` becomes
`.codex/vistack/worktrees/`. The step order and wording remain unchanged.

When a playbook step names a Claude-only mechanism, retain the step in the checklist and
record it as skipped in the ledger with the host-specific reason. In particular, do not run
`/loop`, `claude attach`, Claude issue session-comment upserts, or Claude-specific agent
tool declarations from Codex. The equivalent Codex phase continues in this thread unless a
real fence is reached. The Codex-specific mapping is documented in `docs/guide/codex.md`.

Do not make the Claude and Codex state roots interchangeable: a run must resume in the host
that created it, and an existing `.claude/state/` run remains owned by Claude.

## Step 0 — Mode

viStack is **sticky**. Once this skill has been entered, every later turn in the session is
handled inside the mode: continue the current playbook, do not re-match, do not re-announce.

| The user says | You do |
|---|---|
| `babysit <slug>` — including a recurring `/loop` wake-up | run one `babysit` pass against that slug, then return to the open playbook where it was. A monitor pass is not a new request and never re-matches |
| anything else, mid-playbook | continue the open playbook at its next unchecked step |
| `new task` | discard the open playbook, return to Step 1, match again |
| a second unrelated request while a playbook is open | finish or explicitly park the open one (`pause-safely`), then `new task` |
| `stop` / `pause` | run the `pause-safely` playbook |

Leaving the mode is the user's call, never yours. A completed playbook does not exit the
mode; it leaves the mode idle, waiting for `new task`.

## Step 1 — Read the principles index

**First task-list item, unconditionally, before any matching:** read
`skills/vistack/principles/index.md`.

This is not optional and not conditional on the request looking small. The index is one
screen. It is what makes the rest of the run cheap: it is where the decisions that would
otherwise be re-litigated per turn already have answers.

Add it as literal task-list item 1:

> 1. Read `skills/vistack/principles/index.md`.

## Step 2 — Match exactly one playbook

Second task-list item: match the request to **exactly one** playbook, then copy that
playbook's numbered steps into the task list **VERBATIM**.

Verbatim means verbatim:

- Never paraphrase a step.
- Never reorder steps.
- Never merge two steps into one item.
- Never drop a step because it looks inapplicable.
- A step that will not be run **stays in the task list** and is marked skipped, with the
  reason written to the ledger (`session-ledger`). A silent skip is a defect in the run.

The steps are the executable contract. The playbook file is the source of truth; this
router only chooses between files.

### The match table

| Playbook | Match it when |
|---|---|
| `intake` | the request is raw — no ticket, or a ticket that has not passed a readiness gate |
| `investigation` | the ask is to understand, not to change. Read-only by contract |
| `feature` | new behaviour behind a specified acceptance criterion |
| `bug-fix` | reported wrong behaviour. Requires a reproduction before a fix |
| `refactor` | behaviour must not change; structure must |
| `design-implementation` | the source of truth is a Figma file, not prose |
| `blocker` | work is already open and stuck on one identified obstacle |
| `pr-stack` | a branch is done and the diff needs to become one PR or a chain of them |
| `qa-verification` | a PR exists and needs behavioural evidence against a live env |
| `autopilot-stack` | **the default for a groomed ticket.** Run the whole thing unattended |
| `session-pickup` | resuming work whose session is gone; state file and ledger exist |
| `pause-safely` | stop now, leave the work resumable, hold nothing |
| `babysit` | a run is already dispatched; watch it, unstick it, report at boundaries. Also the target of the coordinator's recurring `/loop 10m /vistack babysit <slug>` monitor |

Ties break toward the more specific playbook. A groomed ticket with no other signal is
`autopilot-stack`. If two playbooks genuinely both fit, the work is two units — say so and
run the first.

Playbook files live at `skills/vistack/playbooks/<name>.md`.

## Step 3 — State the finish condition

Third task-list item: state the finish condition in **checkable** terms — a command whose
output settles it, a screen whose state settles it, a named artifact that either exists or
does not.

> Done means: `<checkable condition>`. Unchanged: `<behaviour that must not change>`.

"Works", "is fixed", "looks right", "is better" are not finish conditions.

**Refuse to start an autonomous run without one.** If the request has no checkable finish
condition and none can be derived from the ticket's acceptance criteria, that is FENCE 2 —
ask, and do nothing else until answered. This is the one question worth blocking on,
because every later step is measured against the answer.

## Step 4 — Route by model strength

Roles carry their own model in agent frontmatter. Do not override it per-run; if a role is
consistently on the wrong model, change the agent file.

| Work | Model | Roles |
|---|---|---|
| judgment, prose, decomposition, ambiguity, adversarial reading of a diff for meaning | `opus` | `coordinator`, `groomer`, `analyst`, `planner`, `unblocker`, `pr-author` |
| precisely-specified implementation — the plan says what, the code is the only unknown | `sonnet` | `implementer`, `design-implementer`, `qa-verifier` |
| mechanical and bulk work, and the adversarial health check | `haiku` | `health-check` |

The rule behind the table: put the model where the *uncertainty* is. A slice whose plan is
already precise does not need judgment, it needs throughput. A diff that must be checked
against acceptance criteria does not need creativity, it needs an auditor with no stake in
the work having been done well.

## Step 5 — Dispatch

`coordinate` owns dispatch, the state file, and the ledger from here. Enter it and follow it.

Non-negotiable while dispatching:

- One worktree per slice, at `.claude/worktrees/<slug>`. Parallel writers never share a
  directory.
- Slices touching a shared file are serialized by the conflict matrix from `slice-plan`.
  They never run concurrently.
- A finished slice raises its PR immediately. Never batch.
- Every PR: one concern, ≤500 changed lines excluding lockfiles and generated files, opened
  as a draft, authored by the configured project user.
- Report at phase boundaries only. Between them, run. No confirmations, no progress
  narration, no status questions — outside the four fences.

## The four fences

Control returns to the user in exactly these cases:

1. A blocker unresolved after the `unblock` loop.
2. Ambiguity that changes acceptance criteria or a public contract.
3. An irreversible action: force-push to a shared branch, history rewrite, shared-env
   migration, secret rotation, production deploy, dependency major bump, merging anything.
4. Credentials missing or expired, or about to be written to a tracked file.

Outside these four, keep going. See `autonomy-has-fences`.

viStack stops at merge-ready. It never merges.

## Reuse, do not reimplement

viStack supplies four things and nothing else: the coordinator layer, the state file, the
conflict matrix, and the ledger. Every other step is an existing skill:

`work-ticket` · `create-ticket` · `review-ticket` · `gathering-requirements`
· `create-pr` · `stacking-prs` · `requesting-reviewers` · `address-ai-reviews` · `web-qa`
· `qa-verification` · `the project QA environment procedure` · `the project CI checks` · `embed-screenshots`
· `cleanup-worktrees` · `pruning-comments`

If a playbook step names one of those, invoke it. Do not write a second version of it here.
