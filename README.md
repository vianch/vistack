# viStack

<img width="1920" height="819" alt="vistack" src="https://github.com/user-attachments/assets/9835e9ba-0687-45a1-9de8-bb932d1a90f4" />


The standing entry point for a unit of engineering work — an issue, a task, a bug, a
feature, a refactor, a design implementation, an investigation. One entry point, one
playbook, one role phase per slice, stopping at merge-ready.

`vistack` is the identifier you install and invoke. **viStack** is what it is called in
prose. Same thing. It runs on Claude Code, Codex, Grok Build, and OpenCode.

**Version:** `0.24.0`

**Contents:** [install](#install) · [usage](#usage) ·
[QA evidence: screenshots and video](#qa-evidence-screenshots-and-video) ·
[what it gives you](#what-it-gives-you) ·
[reuse in another project repository](#reuse-in-another-project-repository) ·
[resuming](#resuming) · [update guide](#update-guide) · [limits](#limits) ·
[uninstall](#uninstall) · [troubleshooting](#troubleshooting)

---

## install

viStack supports Claude Code, Codex, Grok Build, and OpenCode. The repository carries a
manifest per host and keeps the same playbooks, principles, and skill names on all of them.

### Host manifests

Each host manifest carries the version, and the version line at the top of this README
repeats it. `scripts/check-playbooks.mjs` fails when any of them disagree.

| Host | Manifest |
|---|---|
| Claude Code | `.claude-plugin/plugin.json` |
| Codex | `.codex-plugin/plugin.json` |
| Grok Build | `.grok-plugin/plugin.json` |
| OpenCode | `integrations/opencode/vistack.js` (follows the checkout) |

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
- `/vistack:vistack` resolves — typing it offers the command rather than an unknown-command error.

If either fails, see [troubleshooting](#troubleshooting).

### Codex

Codex installs the same repository through `.agents/plugins/marketplace.json` and loads
`skills/vistack/SKILL.md` as `$vistack:vistack`:

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

5. Start a new Codex thread and invoke `$vistack:vistack`. Codex runs the playbook phases in the
current thread because Claude's `commands/` and `agents/` directories are not Codex runtime
components. Codex state uses `.codex/vistack/state/` and `.codex/vistack/worktrees/`. See the
[Codex guide](docs/guide/codex.md) for local development and update instructions.

### Grok Build and OpenCode

Grok Build reads `.grok-plugin/plugin.json`, which points at the same `skills/`, `commands/`,
and `agents/` directories. Its marketplace entry must pin a published commit SHA. OpenCode
loads the bridge at `integrations/opencode/vistack.js` from `.opencode/plugins/`, which adds the
decision and QA video tools. Both are covered step by step in
[`docs/guide/grok-opencode.md`](docs/guide/grok-opencode.md).

---

## usage

### Equivalent entrypoints

`vistack` is the canonical, backwards-compatible skill name. The following names are
equivalent entrypoints and do not select different playbooks, roles, state roots, host
adapters, or merge policies:

| Purpose | Claude Code | Codex |
|---|---|---|
| Canonical | `/vistack:vistack` | `$vistack:vistack` |
| Action-oriented alias | `/vistack:run` | `$vistack:run` |
| Role-oriented alias | `/vistack:orchestrator` | `$vistack:orchestrator` |
| Coordination-oriented alias | `/vistack:coordinator` | `$vistack:coordinator` |

Claude aliases are thin command shims. Codex aliases are thin skill shims; all delegate to
`skills/vistack/SKILL.md`, which remains the single orchestration implementation.

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

### A long run, reported at a phase boundary

```
/vistack Consolidate the open PR stack for https://github.com/ORG/REPO/issues/456 into
the fewest reviewable PRs. Done means every PR sits on the one below, merges cleanly into
the newest main, and has green CI. Keep every existing screenshot. You may rebuild and
push the stack branches, close absorbed PRs with a link to their new home, request
re-reviews, mark the PRs ready for review, and post the new list in the review thread.
Do not merge.
```

A long run reports only at phase boundaries. This is one boundary report from a run that
folded 26 open PRs into 9. Names, numbers, and endpoints are placeholders.

```text
Done
- Pushes: 8 branches rebuilt and pushed, 3 minutes apart. All 9 PRs sit in order, each on
  the one below, and all merge cleanly into the newest main, including a PR that merged
  meanwhile.
- Closed: 17 absorbed PRs, each with a comment linking the PR that now holds its commits.
- Descriptions: all 9 rewritten, each with what was folded in, production vs test lines,
  and a commit-by-commit review guide. All 38 existing screenshots carried over.
- Readiness: all 9 ready for review and mergeable, with the reviewer teams requested.
- Re-reviews: requested on the 5 PRs that grew after they were approved.
- Review thread: replied with the new list.

PR                            Approvals             CI
#101 card                     4                     green
#102 cart and confirmation    2 (re-review asked)   green
#103 pre-cart step            3 (re-review asked)   green
#104 labels and prompt skip   3 (re-review asked)   green
#105 detail sheet             2 (re-review asked)   running
#106 quantities and add       2 (re-review asked)   running
#107 scheduled time           0                     running
#108 seat add-ons             0                     running
#109 price categories         0                     running

Waiting on the GitHub rate limit, spent until 12:45Z and shared with the other sessions on
the account. Scheduled for right after: relink the 9 PRs in the stack view, and archive the
closed PRs' board cards.

Monitor: E2E reruns for the 9 PRs → green on all 9, each on its first run. Monitor stopped.

Live check on the new top preview (<sha>):
1. The buy button creates the hold first: the cart call returns 201. Only then does the
   add-on list open. The list itself creates nothing.
2. On the add-on sheet, before a time is picked, Add is disabled and no rows show.
3. The time list loads with the add-on list, not when the sheet opens: 6 times.
4. Picking a time loads its inventory: three ticket types, each starting at 0.
5. Add stays disabled until at least one unit is chosen.
Screenshot at step 4. This morning's failures were staging outages, not the code.

Next: posting the QA result on the top PR needs the screenshots attached first. Asked,
not assumed.
```

The owners ran as parallel lanes beside the main session, which ran Opus 5.5 with 1M
context at xhigh:

```text
◯ review-climber           handles the open human review threads          4h 16m
◯ main-climber             runs climb 6 of the stack                       3h 01m
◯ stack-consolidator-plan  plans how to consolidate the stack              2h 09m
◯ consolidator             executes the chosen consolidation option        1h 44m
◯ body-writer              drafts titles and descriptions for the 9 PRs      43m
```

The report has four parts and no narration: what changed, the evidence table, what is
waiting and why, and what is next. A rate limit is a scheduled wait, not a fence. The
monitor stopped as soon as its predicate held. The live check names every assertion point
and the call behind it. Only side effects counted as progress: pushes, closed PRs, and
green runs. For a run this long, keep the Mac awake from a side terminal with
`caffeinate -d -i -m -s -u`.

The prompt granted rebuilding and pushing branches, closing absorbed PRs, re-review
requests, ready-for-review, and the thread post. Without that grant viStack stops at
draft PRs and posts nothing.

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

### A report or diagram

```
/vistack Make an HTML timeline of the login incident from the ledger and the linked PRs.
Done means one page with every state change in order and a source link on each entry.
```

Matches `html-report`: the deliverable is a page, so no worktree and no PR. The page lands at
`<state-root>/reports/` as one self-contained file, with a private artifact link on Claude
Code. A run with more than one slice, or any unattended run, ends with a run report the same
way.

### A QA pass with video

```
/vistack Run QA on https://github.com/ORG/REPO/pull/321. Done means every assertion point
has a screenshot on the PR head and every browser scenario has a checked video.
```

Matches `qa-verification`. Each assertion point gets its screenshot, and each browser
scenario gets a video with one chapter per assertion point. See
[QA evidence](#qa-evidence-screenshots-and-video) below.

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

### Local decision engine

viStack includes a local decision subsystem that improves high-frequency workflow choices
without turning the model into another coding agent. The router, playbooks, coordinator,
worktrees, state, ledgers, verification, QA, PR creation, fences, and merge-ready boundary
remain authoritative. Laya only answers bounded questions such as “is this ticket ready?”,
“should these slices run in parallel?”, or “does the evidence cover the acceptance
criteria?”

The data flow is deliberately one-way:

```text
task and viStack state
        -> DecisionContext
        -> deterministic policy          sharp -> runs in code
        -> split forks only: Jev (opt-in) -> Cloudflare clef-flash (opt-in, free daily Neurons) -> Ollama clef-flash (local, opt-in)
        -> safety validation             sharp -> runs in code
        -> advisory Decision             split -> the main session decides
        -> existing viStack rule and coordinator
```

Every `Decision` says `fork: sharp` or `fork: split`. Sharp forks — which playbook, which
file, which tool, which tier, retry or stop — are applied without a model turn; only split
forks reach the main session.

The engine is enabled by default. Default-on means the decision hook is allowed to run; it
does not mean a model download or cloud request happens automatically. With no configured
model, `auto` returns the deterministic policy.

Turn refinement off for the current consuming project:

```bash
python3 scripts/vistack-decision.py decisions off
python3 scripts/vistack-decision.py decisions status
```

Turn it back on:

```bash
python3 scripts/vistack-decision.py decisions on
```

For Claude-hosted state, use `--config .claude/vistack/decisions.json`. For a single request,
pass `--disable-laya`. For an environment-wide emergency switch, set
`VISTACK_LAYA_ENABLED=0`. All of these switches leave the deterministic viStack policy
active. They only disable optional model refinement.

Evaluate a decision directly:

```bash
python3 scripts/vistack-decision.py decision grooming \
  --context examples/laya/grooming.json
```

The JSON result is typed and machine-consumable. It includes the decision type, action,
bounded confidence, rationale, evidence considered, risks, required evidence, alternatives,
conditions for changing the recommendation, backend, and fallback status. Every result is
`advisory-only`; there is no action in the schema that grants permission to merge, force-push,
deploy, delete data, change secrets, or bypass a fence.

The hook is available at these decision boundaries:

| Boundary | Decision types | What remains authoritative |
|---|---|---|
| Intake and grooming | `intake-analysis`, `grooming` | readiness fields and FENCE 2 |
| Route matching | `playbook-selection` | the playbook table and selected playbook |
| Slice planning | `decomposition`, `tier-selection` | file ownership, conflict matrix, 500-line limit, tier rule |
| Pre-dispatch and monitoring | `dispatch-readiness`, `runtime-progress` | coordinator state, dependencies, monitor, ledger |
| QA | `verification` | artifacts mapped to acceptance criteria |
| Retrospective review | `skill-improvement` | explicit human review and an evidence-backed change |

The model cannot create evidence. A verification recommendation of `accept` is rejected
unless captured artifacts cover every acceptance criterion. A parallelization recommendation
is rejected when the conflict matrix or dependency state says the lanes must serialize. A
dispatch recommendation is rejected when the brief, writable file list, dependency proof, or
verification command is missing.

To reduce latency for repeated decisions, run one resident process:

```bash
python3 scripts/vistack-decision.py serve
```

A missing model, an unreachable server, a malformed result, a timeout, a low-confidence
result, or a failed safety gate all return the deterministic fallback. No cloud LLM is
required for the decision layer.

Hosted [Jev](https://docs.typesafe.ai/models) settled 7 of 10 labelled split forks, none
wrong, in about 350 ms. It is opt-in because it sends the redacted decision state to TypeSafe: `decisions on --jev` for a project or
`VISTACK_LAYA_JEV=1` for a shell, with the key in `TYPESAFE_API_KEY` or `TYPESAFE_KEY`. An
opted-in Jev leads the ladder, and the next tier answers when Jev is refused or offline.

Cloudflare Workers AI serves the same model as `@cf/cloudflare/clef-flash`. It is opt-in
because it sends the redacted decision state to Cloudflare: `decisions on --cloudflare` for a
project or `VISTACK_LAYA_CLOUDFLARE=1` for a shell, with `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in the environment. Credentials alone do not opt in. It stays inside
the 10,000 free Neurons a day (default cap 9,000), and at the cap split forks go to the local
tier. One live decision cost about 1.8 Neurons. Its 0.85 floor is inherited from the Ollama
measurements and not yet measured on Workers AI:
[`docs/guide/decision-engine.md`](docs/guide/decision-engine.md#hosted-fork-tier-cloudflare-workers-ai).

[Ollama](https://ollama.com) runs the local tier with no key, and the state never leaves the
machine. The one supported model is [`clef-flash`](https://ollama.com/library/clef-flash),
Cloudflare's 9B System One decision model, which needs Ollama 0.35.1 or newer:

```bash
ollama pull clef-flash                                              # about 11 GB
python3 scripts/vistack-decision.py decisions on --ollama-model clef-flash
```

`/vistack:decisions-on` asks whether to use it and pulls it when you pick it. It answers the
split forks the cloud tiers left unsettled, and it accepts an answer only at 0.85 confidence or higher,
its own measured threshold. Measured end to end on the 108 labelled scenarios, on an Apple M3
Pro with 36 GB, it settled 7 of 10 split forks with none wrong, at about 1 s per fork it
handles. It holds 14.2 GB of memory while loaded and takes about 7 s to load, which
`decisions on` pays up front. The guide has the table, the threshold evidence, and the
confidence-scale caveat:
[`docs/guide/decision-engine.md`](docs/guide/decision-engine.md#local-fork-tier-ollama).

Each decision can be recorded in local JSONL history. Use `override` when a human changes a
recommendation, `outcome` when the lane finishes, and `feedback` to find repeated overrides:

```bash
python3 scripts/vistack-decision.py override dec_123 pause \
  --recommended-action continue \
  --reason "The lane reached a safe stop."
python3 scripts/vistack-decision.py outcome dec_123 completed --evidence test-output.txt
python3 scripts/vistack-decision.py feedback
```

Feedback produces review proposals; it never edits `skills/vistack/SKILL.md` automatically.
Use [`docs/guide/decision-engine.md`](docs/guide/decision-engine.md) for the full
schema, protocol references, measurements, failure behavior, and extension procedure.

### Host integrations

- Claude Code and Codex use the shared Python CLI and the `decisions-on`, `decisions-off`,
  and `decisions-status` commands. The Claude commands run the plugin's script
  through `${CLAUDE_PLUGIN_ROOT}`, so they work from any consuming project.
- Grok Build support is declared in `.grok-plugin/plugin.json` and uses the same skills,
  agents, commands, and local decision switch. The xAI marketplace entry must be pinned to
  the published commit SHA; generate it with
  `python3 scripts/grok-marketplace-entry.py --sha <sha>`.
- OpenCode support is in `integrations/opencode/vistack.js`. Copy it to
  `.opencode/plugins/vistack.js` to expose `vistack_decision`, `vistack_decisions_toggle`, and
  `vistack_qa_video`.

See [`docs/guide/grok-opencode.md`](docs/guide/grok-opencode.md) for marketplace and plugin
installation details.

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
The lifecycle skill provides the same controls through `vistack:visualizer on`, `off`, and
`status`.

### Deck: an in-session pane (Claude Code)

viStack ships a Claude Code mod: a docked pane with eight tabs (Board, Agents, Cost, Session,
Changes, Timeline, Flow, Recall). It shows what waits on you, each subagent with its model,
tokens, and cost, cost per model and per execution, context and rate limits, the files
edited, where a turn's time went, viStack run state and worktrees, and a search over the
session's prompts. `/deck` opens it, `/deck <tab>` jumps to a tab, `1` to `8` switch tabs in
the pane, and `g` opens lazygit beside the session.

It loads with the plugin: after an install or update, run `/reload-plugins`. PR listing and
lazygit stay off until you set your realm:

```json
{ "pluginConfigs": { "vistack": { "options": { "realm": "github.com/your-org" } } } }
```

See [`docs/guide/deck.md`](docs/guide/deck.md) for the tabs, options, model suggestions, and
what the deck reads and runs.

---

## QA evidence: screenshots and video

A QA pass ends with a results table, one row per assertion point. The screenshot taken at
that point decides pass or fail. Each browser scenario is also recorded as a video, so a
reviewer can see how the page reached that state: the transition, the order of events, the
timing. A video never turns a fail into a pass.

| Row field | Comes from |
|---|---|
| screenshot | `<scenario>-<step>.png`, captured at the end of the step |
| video | `<scenario>.mp4 @ 00:04-00:09`, with times read from the scenario's manifest |
| diff hunk | the `file:line` that made the scenario necessary |

The [`qa-video`](skills/qa-video/SKILL.md) skill does the recording. It runs the same way on
every host.

| Host | Runs it with |
|---|---|
| Claude Code | `node "${CLAUDE_PLUGIN_ROOT}/skills/qa-video/scripts/qa-video.mjs"` inside the plugin |
| Codex, Grok Build | the same script from the installed plugin path |
| OpenCode | the `vistack_qa_video` tool in `integrations/opencode/vistack.js` |

Run directly from a consuming project (the evidence directory is git-ignored):

```bash
QA=/path/to/vistack/skills/qa-video/scripts/qa-video.mjs
node "$QA" doctor
cp /path/to/vistack/skills/qa-video/assets/scenario.example.mjs .claude/state/qa/321/checkout.mjs
node "$QA" record --scenario .claude/state/qa/321/checkout.mjs --out .claude/state/qa/321 \
  --url https://preview.example.app --head abc1234 --title-card
node "$QA" finish --manifest .claude/state/qa/321/checkout.manifest.json --mp4 --sheet
node "$QA" check --manifest .claude/state/qa/321/checkout.manifest.json
```

| Command | Does | Needs |
|---|---|---|
| `doctor` | reports what this machine can produce | nothing |
| `record` | runs the scenario module, writes the `.webm`, one PNG per step, and the manifest | Playwright in the project, plus its browser |
| `finish` | writes `.vtt` and `.srt` captions, plus the MP4 fitted to 10 MB, GIF, screenshot slideshow, and contact sheet when asked | ffmpeg with libx264 for video outputs, ImageMagick for the sheet |
| `check` | validates the manifest, file signatures, step times, and the size budget | nothing |

The scenario module logs in through a separate context that is not recorded, so credentials
are never typed on camera. Credentials come from environment variables, never from
command-line arguments. Without ffmpeg the `.webm` is still produced, and the outputs that
need it are marked `skipped`.

The script is Node with no dependencies because Playwright is a Node package first, and a
project that uses it already has its browsers installed. Shelling out to ffmpeg and
ImageMagick with argument lists avoids the quoting bugs of a bash pipeline. Hand edits such
as trimming, speeding up, side-by-side before and after, and palette GIFs are in
[`skills/qa-video/references/ffmpeg-imagemagick.md`](skills/qa-video/references/ffmpeg-imagemagick.md).

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
| [`agent-design`](skills/vistack/playbooks/agent-design.md) | a new agent, bot, or subagent for Claude Code, Codex, or OpenCode |
| [`correct`](skills/vistack/playbooks/correct.md) | agents keep repeating a mistake; make it impossible with a structure, type, lint, or test |
| [`worktree-cleanup`](skills/vistack/playbooks/worktree-cleanup.md) | an evidence-based audit of stale worktrees |
| [`html-report`](skills/vistack/playbooks/html-report.md) | the deliverable is a page: report, chart, diagram, timeline, board, toggle editor, design tokens |
| [`session-pickup`](skills/vistack/playbooks/session-pickup.md) | resuming work whose session is gone; state file and ledger exist |
| [`pause-safely`](skills/vistack/playbooks/pause-safely.md) | stop now, stay resumable, hold nothing |
| [`babysit`](skills/vistack/playbooks/babysit.md) | a run is dispatched; watch it, unstick it, report at boundaries |

### Agents

| Agent | Owns | Model | Effort |
|---|---|---|---|
| [`coordinator`](agents/coordinator.md) | phase transitions, dispatch, state file, ledger, session comment. Never edits code | `opus` | session |
| [`groomer`](agents/groomer.md) | raw request → specified ticket, through the readiness gate | `opus` | session |
| [`analyst`](agents/analyst.md) | explorer: read-only call sites, blast radius, existing patterns, coverage | `opus` | `medium` |
| [`researcher`](agents/researcher.md) | researcher: external docs pinned to the installed version, cited | `opus` | `medium` |
| [`planner`](agents/planner.md) | slices ≤500 lines, file-level ownership, tiers, the conflict matrix | `opus` | session |
| [`implementer`](agents/implementer.md) | worker, mechanical tier: repetitive edits, basic utils, unit tests | `sonnet` | session |
| [`senior-implementer`](agents/senior-implementer.md) | worker, complex tier: data shapes, contracts, boundaries, hot paths | `opus` | `xhigh` |
| [`design-implementer`](agents/design-implementer.md) | the same, sourced from Figma; reports deviations instead of inventing values | `sonnet` | session |
| [`unblocker`](agents/unblocker.md) | the bounded blocker loop and its escalation dossier | `opus` | session |
| [`pr-author`](agents/pr-author.md) | draft PRs, the stacked chain over 500 lines, reviewer assignment | `opus` | session |
| [`qa-verifier`](agents/qa-verifier.md) | the QA contract: scenarios from the diff, screenshots, scenario videos, results table | `sonnet` | session |
| [`health-check`](agents/health-check.md) | adversarial audit of the diff against the acceptance criteria | `haiku` | — |
| [`advisor`](agents/advisor.md) | fallback reviewer when the advisor tool is off: plan, repeat, done | `fable` | `xhigh` |
| [`design-runner`](agents/design-runner.md) | one independent `architect` candidate: usage first, then types and a rationale | `opus` | session |
| [`reviewer`](agents/reviewer.md) | one independent `interrogate` reviewer, or the `architect` judge. Read-only | `opus` | session |
| [`report-writer`](agents/report-writer.md) | renders one self-contained HTML page from state, ledger, diff, or code map; never publishes | `sonnet` | session |
| [`agent-designer`](agents/agent-designer.md) | designs one new Claude Code, Codex, or OpenCode agent and verifies it loads | `opus` | session |

Models and effort sit in agent frontmatter, not in a run. The rule behind the split: put the
model where the *uncertainty* is. The main session runs Opus 5.5 at `xhigh` and plans,
decides, and verifies. Reading and doc lookups run on Opus at `medium`. Mechanical code goes
to Sonnet and complex code to Opus at `xhigh`. The adversarial audit stays on Haiku. Fable
5.1 advises at three checkpoints and never writes code.

```text
AGENT TREE · OPUS 5.5 WORKS · FABLE 5.1 ON CALL

Fable 5.1 · advisor · on call           Opus 5.5 · main session · xhigh
reads the whole session                 plans + decides
  ◇ before a plan ───────────────────▶        │
                                              ▼
                                 laya · fork layer
                                 which playbook · which file · which tier · retry or stop
                                 sharp → runs in code     split → Opus
                                              │
                          delegate · medium effort, complex code at xhigh
                  ┌───────────────────────────┼──────────────────────────┐
                  ▼                           ▼                          ▼
               worker                      explorer                 researcher
     implementer · sonnet               analyst · opus           researcher · opus
     senior-implementer · opus xhigh    medium                   medium
     edits + runs tests                 reads the code           pulls the docs
  ◇ error repeats ──▶ worker                  │                          │
                  └───────────────────────────┼──────────────────────────┘
                                              ▼
  ◇ before done ─────────────────────▶ back to main session · xhigh
                                       review + verify
```

### Principles

The indexed principles at [`skills/vistack/principles/index.md`](skills/vistack/principles/index.md)
are each invocable by name. The index is read first on every run, unconditionally. A reply that
invokes a principle must name the decision the principle changed.

### Specialist skills

[`coordinate`](skills/coordinate/SKILL.md) (dispatch, state, ledger) ·
[`advisor`](skills/advisor/SKILL.md) (the three checkpoints) ·
[`architect`](skills/architect/SKILL.md) (design before code) ·
[`interrogate`](skills/interrogate/SKILL.md) (adversarial multi-reviewer pass) ·
[`figma-sync`](skills/figma-sync/SKILL.md) (the live Figma line) ·
[`slice-plan`](skills/slice-plan/SKILL.md) (decomposition, conflict matrix) ·
[`unblock`](skills/unblock/SKILL.md) (the bounded loop) ·
[`qa-verify`](skills/qa-verify/SKILL.md) (the QA contract) ·
[`qa-video`](skills/qa-video/SKILL.md) (scenario videos and media edits) ·
[`stack-split`](skills/stack-split/SKILL.md) (the >500-line split) ·
[`session-ledger`](skills/session-ledger/SKILL.md) (the issue comment) ·
[`swarm`](skills/swarm/SKILL.md) (parallel verification) ·
[`show-me-your-work`](skills/show-me-your-work/SKILL.md) (overnight ledger audit) ·
[`build-the-lever`](skills/build-the-lever/SKILL.md) (rerunnable checks) ·
[`unslop`](skills/unslop/SKILL.md) (concrete prose) ·
[`html-report`](skills/html-report/SKILL.md) (pages and the run report) ·
[`visualizer`](skills/visualizer/SKILL.md) (the local workflow observer).

Direct entries include [`overnight`](skills/overnight/SKILL.md),
[`automate-me`](skills/automate-me/SKILL.md), [`design-agent`](skills/design-agent/SKILL.md),
[`transcript-healthcheck`](skills/transcript-healthcheck/SKILL.md),
[`routine-healthcheck`](skills/routine-healthcheck/SKILL.md), and [`correct`](skills/correct/SKILL.md)
(`/vistack:correct`, operator-invoked). How much design a change deserves:
[`docs/guide/design.md`](docs/guide/design.md). Editing a contract:
[`docs/guide/writing-contracts.md`](docs/guide/writing-contracts.md).

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

For scenario videos, the project also needs Playwright in its `node_modules` and its browser
installed (`npx playwright install chromium`). ffmpeg and ImageMagick are optional. Without
them the video stays a `.webm`, and `qa-video.mjs doctor` reports what is missing.

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

The Codex manifest at [`.codex-plugin/plugin.json`](.codex-plugin/plugin.json) and the Grok
manifest at [`.grok-plugin/plugin.json`](.grok-plugin/plugin.json) carry the same release
version. Keep all three and the README version line aligned. Codex cachebusters are added only to the Codex manifest
during local iteration and do not replace the release semver.

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

2. Refresh the marketplace snapshot, then install/update the plugin:

```bash
codex plugin marketplace upgrade vistack
codex plugin add vistack@vistack
```

3. Confirm `vistack` reports the version in `.claude-plugin/plugin.json` and is enabled:

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
| **`qa-video.mjs record` exits 2 with "Playwright not installed in <dir>"** | the script runs from the plugin, so it resolves Playwright from the current directory, not its own | run it from the consuming project, or set `QA_VIDEO_PLAYWRIGHT` to the Playwright package path |
| **The QA video stays `.webm` and `mp4` is `skipped`** | no system ffmpeg with libx264. Playwright's bundled ffmpeg only writes VP8 | install ffmpeg (`brew install ffmpeg`, or the platform package), then rerun `finish` |
| **`finish` marks the MP4 `over-budget`** | the scenario is too long for the attachment budget even after the bitrate re-encode | split it into shorter scenarios, or attach the slideshow or contact sheet |

---

Author: the viStack maintainers
