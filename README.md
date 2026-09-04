# viStack

The standing entry point for a unit of engineering work — an issue, a task, a bug, a
feature, a refactor, a design implementation, an investigation. One entry point, one
playbook, one role phase per slice, stopping at merge-ready.

`vistack` is the identifier you install and invoke. **viStack** is what it is called in
prose. Same thing.

---

## install

viStack supports both Claude Code and Codex. The repository carries both manifests and keeps
the same playbooks, principles, and skill names across the two hosts.

### Current versions

| Host | Version | Manifest |
|---|---:|---|
| Claude Code | `0.4.0` | `.claude-plugin/plugin.json` |
| Codex | `0.4.0` | `.codex-plugin/plugin.json` |

### Claude Code

viStack ships `.claude-plugin/marketplace.json` at the repository root. From Claude Code, add
the repository marketplace and install the plugin:

1. Start Claude Code in any project.
2. Add the marketplace once:

```text
/plugin marketplace add https://github.com/vianch/viStack
```

3. Install the plugin:

```text
/plugin install vistack
```

4. Verify the installation:

- `/plugin` lists **viStack** as enabled.
- `/vistack` resolves — typing it offers the command rather than an unknown-command error.

If either fails, see [troubleshooting](#troubleshooting).

### Codex

Codex installs the same repository through `.agents/plugins/marketplace.json` and loads
`skills/vistack/SKILL.md` as `$vistack`:

1. Confirm the Codex CLI is available:

```bash
codex --version
```

2. Add the repository as a marketplace once:

```bash
codex plugin marketplace add https://github.com/vianch/viStack
```

If it is already configured, check it with `codex plugin marketplace list` and do not add it
again.

3. Install the plugin:

```bash
codex plugin add vistack@vistack
```

4. Verify it is installed and enabled:

```bash
codex plugin list
```

5. Start a new Codex thread and invoke `$vistack`. Codex runs the playbook phases in the
current thread because Claude's `commands/` and `agents/` directories are not Codex runtime
components. Codex state uses `.codex/vistack/state/` and `.codex/vistack/worktrees/`. See the
[Codex guide](docs/guide/codex.md) for local development and update instructions.

---

## usage

One command. The request shape is what makes it work.

```
/vistack <what you observed or want>. Done means <checkable condition>.
Keep <behaviour that must not change>.
```

| Part | What it decides |
|---|---|
| what you observed or want | which playbook matches |
| `Done means …` | when the run stops, and what the health check measures the diff against |
| `Keep …` | what counts as a regression, so the QA scenarios have something to protect |

Omit the finish condition and viStack asks for it before starting an autonomous run. It is
the one question it blocks on.

### A bug, with a reproduction required

```
/vistack The primitive Modal renders fullscreen below md when it should render as a
sheet — https://github.com/ORG/REPO/issues/789. Done means Modal renders as a
sheet below md with a failing-then-passing test covering it, and a screenshot at 375px
on the PR preview. Keep the md-and-up dialog layout and every current Modal consumer
unchanged.
```

Matches `bug-fix`. The reproduction comes before the fix — the playbook will not let a fix
be written until the wrong behaviour has been observed and captured. If it does not
reproduce, the run stops and reports what was tried; that is an answer, not a failure.

### A groomed ticket, run unattended

```
/vistack Run https://github.com/ORG/REPO/issues/123 unattended. Done means a
ProgressBar primitive rendering at 0/50/100% with correct aria-valuenow, both Loader
call sites using it, Storybook stories present, and the suite green. Keep every
existing Loader consumer's visual output.
```

Matches `autopilot-stack` — the default for a groomed ticket. Intake → plan → parallel
implement → PR → QA → audit → bot-comment cleanup, with no human in the loop, reporting at
phase boundaries only. It stops at merge-ready. **It never merges.**

### An overnight run

```
/vistack I am going to bed. Migrate every caller to the new parser in a fresh worktree.
Done means zero old callers, all parser fixtures pass, and the old API is deleted.
Keep parser output unchanged. Commit and push branches, but do not merge.
If the blocker loop is exhausted, stop with the full dossier.
```

Matches `overnight`. It records the permissions, escape hatch, host wake mechanism, and
decision trail before dispatch. Each iteration makes one evidence-backed change, checks the
real artifact, and records whether the predicate moved. It stops at merge-ready drafts or a
fence.

For a queue of independent items, say `full autopilot` and name each item and its finish
check. That matches `autopilot-full`, which runs one owner per item and leaves every PR as a
draft.

### A read-only investigation

```
/vistack Why do Portal's error messages render inconsistently between InputField and
Alert — https://github.com/ORG/REPO/issues/101. Investigation only: write no
product code. Done means an impact map with file:line refs for every error-render path,
what is uncovered by tests, and a recommended approach posted as a comment on the issue.
```

Matches `investigation`, which is read-only by contract: no edits, no branches, no
worktrees, no PRs. If the answer turns out to need a change, the run says so and ends —
`new task` starts the right playbook.

### Sticky mode

- **Follow-up turns stay in the mode.** Answering a question, adding a constraint, or asking
  for a change continues the open playbook at its next unchecked step. Do not re-invoke
  `/vistack`.
- **`new task` forces a fresh playbook match** — it discards the open playbook and starts
  again at the principles index.
- `stop` or `pause` runs `pause-safely` and hands back the resume command.
- A finished playbook leaves the mode idle, not exited. `new task` is how you move on.

Longer version, including the four fences: [`docs/guide/usage.md`](docs/guide/usage.md).
The failures that cost the most:
[`docs/guide/common-mistakes.md`](docs/guide/common-mistakes.md).

### Workflow observer

Run the local HTML observer to see coordinator state, agent lanes, skills, playbooks, ledger
evidence, pull requests, and addressed or open review threads:

```bash
node scripts/visualizer-server.mjs --enable
open http://127.0.0.1:47319
```

Use `node scripts/visualizer-server.mjs --status` and `--disable` to control the detached
server. The page's `LIVE SYNC` toggle pauses polling without stopping it. See
[`docs/guide/visualizer.md`](docs/guide/visualizer.md) for data sources and offline fixtures.

---

## what it gives you

### Playbooks

The steps are the executable contract. They are copied into the task list verbatim — the
files are the source of truth, so they are not restated here.

| Playbook | Use it when |
|---|---|
| [`intake`](skills/vistack/playbooks/intake.md) | the request is raw — no ticket, or one that has not passed a readiness gate |
| [`investigation`](skills/vistack/playbooks/investigation.md) | the ask is to understand, not to change. Read-only by contract |
| [`feature`](skills/vistack/playbooks/feature.md) | new behaviour behind a specified acceptance criterion |
| [`bug-fix`](skills/vistack/playbooks/bug-fix.md) | reported wrong behaviour. A reproduction comes before the fix |
| [`refactor`](skills/vistack/playbooks/refactor.md) | structure must change and behaviour must not |
| [`design-implementation`](skills/vistack/playbooks/design-implementation.md) | the source of truth is a Figma file, not prose |
| [`blocker`](skills/vistack/playbooks/blocker.md) | work is open and stuck on one identified obstacle |
| [`pr-stack`](skills/vistack/playbooks/pr-stack.md) | a branch is done and the diff needs to become a PR or a chain |
| [`qa-verification`](skills/vistack/playbooks/qa-verification.md) | a PR exists and needs behavioural evidence against a live env |
| [`autopilot-stack`](skills/vistack/playbooks/autopilot-stack.md) | **the default for a groomed ticket.** The whole thing, unattended |
| [`autopilot-full`](skills/vistack/playbooks/autopilot-full.md) | independent PR queue, one owner per item, all to merge-ready drafts |
| [`overnight`](skills/vistack/playbooks/overnight.md) | one task or bounded queue while the user is away |
| [`perf-issue`](skills/vistack/playbooks/perf-issue.md) | one measured performance fix |
| [`prototype`](skills/vistack/playbooks/prototype.md) | a throwaway experiment that settles a design or behavior question |
| [`multi-phase-plan`](skills/vistack/playbooks/multi-phase-plan.md) | large or cross-cutting work that needs a durable execution plan |
| [`authoring-skill`](skills/vistack/playbooks/authoring-skill.md) | creating or modifying a workflow contract |
| [`automate-me`](skills/vistack/playbooks/automate-me.md) | capturing working preferences in a reusable mode skill |
| [`worktree-cleanup`](skills/vistack/playbooks/worktree-cleanup.md) | an evidence-based audit of stale worktrees |
| [`session-pickup`](skills/vistack/playbooks/session-pickup.md) | resuming work whose session is gone; state file and ledger exist |
| [`pause-safely`](skills/vistack/playbooks/pause-safely.md) | stop now, stay resumable, hold nothing |
| [`babysit`](skills/vistack/playbooks/babysit.md) | a run is dispatched; watch it, unstick it, report at boundaries |

### Agents

| Agent | Owns | Model |
|---|---|---|
| [`coordinator`](agents/coordinator.md) | phase transitions, dispatch, state file, ledger, session comment. Never edits code | `opus` |
| [`groomer`](agents/groomer.md) | raw request → specified ticket, through the readiness gate | `opus` |
| [`analyst`](agents/analyst.md) | read-only: call sites, blast radius, existing patterns, coverage | `opus` |
| [`planner`](agents/planner.md) | slices ≤500 lines, file-level ownership, the conflict matrix | `opus` |
| [`implementer`](agents/implementer.md) | one slice, one worktree, repo conventions, green lint and tests | `sonnet` |
| [`design-implementer`](agents/design-implementer.md) | the same, sourced from Figma; reports deviations instead of inventing values | `sonnet` |
| [`unblocker`](agents/unblocker.md) | the bounded blocker loop and its escalation dossier | `opus` |
| [`pr-author`](agents/pr-author.md) | draft PRs, the stacked chain over 500 lines, reviewer assignment | `opus` |
| [`qa-verifier`](agents/qa-verifier.md) | the QA contract: scenarios from the diff, screenshots, results table | `sonnet` |
| [`health-check`](agents/health-check.md) | adversarial audit of the diff against the acceptance criteria | `haiku` |

Models sit in agent frontmatter, not in a run. The rule behind the split: put the model
where the *uncertainty* is. Judgment and prose to Opus; precisely-specified implementation
to Sonnet; mechanical work and the adversarial audit to Haiku.

### Principles

The indexed principles at [`skills/vistack/principles/index.md`](skills/vistack/principles/index.md)
are each invocable by name. The index is read first on every run, unconditionally. A reply that
invokes a principle must name the decision the principle changed.

### Specialist skills

[`coordinate`](skills/coordinate/SKILL.md) (dispatch, state, ledger) ·
[`slice-plan`](skills/slice-plan/SKILL.md) (decomposition, conflict matrix) ·
[`unblock`](skills/unblock/SKILL.md) (the bounded loop) ·
[`qa-verify`](skills/qa-verify/SKILL.md) (the QA contract) ·
[`stack-split`](skills/stack-split/SKILL.md) (the >500-line split) ·
[`session-ledger`](skills/session-ledger/SKILL.md) (the issue comment) ·
[`swarm`](skills/swarm/SKILL.md) (parallel verification) ·
[`show-me-your-work`](skills/show-me-your-work/SKILL.md) (overnight ledger audit) ·
[`build-the-lever`](skills/build-the-lever/SKILL.md) (rerunnable checks) ·
[`unslop`](skills/unslop/SKILL.md) (concrete prose).

Direct entries include [`overnight`](skills/overnight/SKILL.md) and
[`automate-me`](skills/automate-me/SKILL.md).

---

## reuse in another project repository

viStack is **repo-agnostic**. Nothing in it hardcodes a repository, a branch name, a
reviewer team, or a service. Three inputs come from the repo it runs in:

| Input | What it is |
|---|---|
| **base branch** | what PRs target, and what a diff is measured against |
| **reviewer team** | resolved by `requesting-reviewers` for that repo |
| **verification target** | the environment a QA scenario runs against |

Before `autopilot-stack`, `autopilot-full`, or `overnight` will run in a new repo, that repo must provide:

1. **A QA env recipe, or coverage by `the project QA environment procedure`.** A per-PR preview
   is the best case; a claimable QA tenant works; a repo with neither has no way to produce
   behavioural evidence, and `autopilot-stack` will stop rather than accept a green build in
   its place.
2. **An approved credential procedure** for the target environment. Confirm its path is
   ignored before writing to it. A credential about to be written to a tracked file is
   FENCE 4.
3. **A lint command and a test command the implementer can run**, both green on the base
   branch before a run starts. A suite already red gives every slice the same false signal.

Also worth setting up once: `.claude/state/`, `.claude/worktrees/`, `.codex/vistack/state/`,
and `.codex/vistack/worktrees/` in `.gitignore`. The coordinator checks them before the first
run.

**Anything outside `the project organization and its approved repositories` is out of scope by design.** No remote, clone,
fetch, submodule, or vendored copy leaves the realm — see
[`keep-origins-in-realm`](skills/keep-origins-in-realm/SKILL.md). A pattern from
outside gets authored, not copied.

---

## resuming

**The session is still alive** → attach through the host's coordinator-session operation:

```
<host attach command> <coordinator-session-id>
```

The id is on the resume line of the `Engineering work — agent sessions` record. Attach to
the coordinator, not to an implementer. An implementer gives you one slice. The coordinator
gives you the run.

**The session is gone** → reconstruct from disk:

```
/vistack session-pickup <slug>
```

It reads the host's state file and ledger, reconciles them against
`git worktree list`, `git branch -a`, `gh pr view` and `gh issue view`, writes down every
divergence as a `reconciled` ledger row, prunes the worktrees no longer needed, upserts the
session comment with the new session ids, and resumes at the earliest unfinished phase.

The state file records intent and the ledger records what happened. After a crash they
disagree, and reconciliation is the step that decides which is true. Column semantics:
[`docs/guide/ledger-format.md`](docs/guide/ledger-format.md).

---

## update guide

Semver in [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json):

The Codex manifest at [`.codex-plugin/plugin.json`](.codex-plugin/plugin.json) carries the same
release version. Keep both versions aligned; Codex cachebusters are added only to the Codex
manifest during local iteration and do not replace the release semver.

| Bump | For |
|---|---|
| **patch** | wording, a clarified step, a fixed link, a better example |
| **minor** | a new playbook, a new principle, a new agent |
| **major** | a changed state-file or ledger schema |

Major is reserved for schema because `session-pickup` reads state files written by earlier
versions. Renaming a column or a key breaks the resume of every run in flight.

**One version bump per PR, in its own commit**, with the changed skills named in the body.
A bump bundled into a content commit makes it impossible to tell from the log which version
introduced which behaviour.

### Update an existing Claude Code installation

1. Check the installed plugin:

```bash
claude plugin details vistack
```

2. Update it from its configured marketplace:

```bash
claude plugin update vistack
```

The equivalent interactive command is `/plugin update vistack`.

3. Restart Claude Code. The update is applied when the next session starts.

4. Verify the component inventory and entry point again:

```bash
claude plugin details vistack
```

Then run `/plugin` and `/vistack` inside Claude Code.

If the marketplace was changed locally or the update is not found, reinstall explicitly:

```
/plugin install vistack
```

### Update an existing Codex installation

1. Check the configured marketplace and installed plugin:

```bash
codex plugin marketplace list
codex plugin list
```

2. Refresh the installed plugin from the marketplace:

```bash
codex plugin add vistack@vistack
```

3. Confirm `vistack` reports version `0.4.0` and is enabled:

```bash
codex plugin list
```

4. Start a new Codex thread and invoke `$vistack`. Existing threads may retain the previous
skill inventory.

For local development, update the Codex cachebuster before reinstalling:

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py /absolute/path/to/vistack
codex plugin add vistack@vistack
```

---

## limits

**The fences.** Control returns to you in exactly four cases: a blocker unresolved after the
loop; ambiguity that changes acceptance criteria or a public contract; an irreversible action
(force-push to a shared branch, history rewrite, shared-env migration, secret rotation,
production deploy, dependency major bump, merging anything); credentials missing, expired, or
about to be written to a tracked file. Outside those four it runs unattended and reports at
phase boundaries. If you want a supervised run, this is the wrong tool.

**≤500 changed lines per PR**, excluding lockfiles and generated files. Over that, the diff
becomes a parent→child chain. This is a cap, not a target — it is not negotiable per-run,
and a diff that "really needs" 900 lines is a diff that has not been read for its second
concern yet.

**It stops at merge-ready and never merges.** Every PR is left as a draft. Merging is FENCE 3
and belongs to a human. It also never marks a child of a stack ready before its parent.

**It is the wrong tool for a one-line copy change or a config tweak.** The router, the
principles index, the slice plan, the conflict matrix, the state file and the audit all cost
tokens, and they cost the same on a one-line change as on a four-slice feature. Below roughly
a slice's worth of work, just make the change.

**It cannot verify what it cannot reach.** No preview and no QA tenant means no behavioural
evidence, and it will not substitute a green build for one.

---

## uninstall

```
/plugin uninstall vistack
```

Then audit and prune anything left behind under the host's worktree root:

```
/cleanup-worktrees
```

`cleanup-worktrees` lists what is there, categorizes it by whether its PR is
open, merged, or closed, and asks before deleting. A worktree with unpushed commits is worth
looking at before it goes.

State files under the host's state root are small, git-ignored, and the only record of why a
run decided what it did. Delete them by hand if you want them gone.

---

## troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| **A skill does not load** | its identifier is not lowercase-kebab. Every skill and agent `name` must match `^[a-z0-9]+(-[a-z0-9]+)*$`, and the directory name must match the `name` in frontmatter. `viStack` in a `name:` field or a directory breaks the load silently | rename to lowercase-kebab; keep `viStack` in prose only |
| **A principle skill does not load** | it was nested — `skills/principles/<name>/SKILL.md`. Claude Code discovers a skill only at `skills/<name>/SKILL.md`; one level deeper and the inventory silently reports zero | move it to `skills/<name>/`. `claude plugin details vistack` prints the component inventory — count the skills |
| **`/vistack` does not resolve** | the plugin is disabled | `/plugin` → find viStack → enable. Then confirm it is listed as enabled, not just installed |
| **`$vistack` does not activate in Codex** | the plugin is not installed or the current thread predates the install | run `codex plugin list`, reinstall `vistack@vistack`, and start a new thread |
| **Two agents writing to the same directory** | the conflict matrix was never produced, so dispatch had nothing to serialize against | stop the run, re-run [`slice-plan`](skills/slice-plan/SKILL.md), and dispatch from the matrix. No matrix, no dispatch |
| **The QA step fails at login** | access ran before the PR target finished building, or the approved credential procedure is unavailable | wait for the target to finish, then check access. Do not substitute another environment or credential path |
| **`/plugin install vistack` cannot find it** | more than one registered marketplace carries the name, or the entry is missing from `marketplace.json` | qualify it: `/plugin install vistack`, using the `name` field from `.claude-plugin/marketplace.json` |
| **A run stops to ask something every few minutes** | the request had no checkable finish condition, so nothing can settle a step | re-state it with `Done means <checkable condition>` and start again |

---

Author: the viStack maintainers 
