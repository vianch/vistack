# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

viStack is a **Claude Code and Codex plugin**, not an application. The deliverable is mostly
Markdown (skills, agents, playbooks, docs) plus host manifests and small dependency-free
validation scripts. Editing a contract changes agent behavior directly. There is no product
build.

This checkout is the source; its upstream is `github.com/vianch/viStack`. Claude Code loads
the installed copy at `~/.claude/plugins/marketplaces/vistack`, so an edit is live only once
that copy matches this one. `scripts/verify.sh` fails while they differ and prints the sync
command.

## Commands

```
/plugin install vistack           # install / pick up a new version
/plugin                           # confirm viStack is listed as enabled
claude plugin details vistack     # component inventory — count skills/agents to verify loading
/vistack:vistack <request>        # canonical plugin entry point
/vistack:run|orchestrator|coordinator <request> # equivalent aliases
codex plugin add vistack@vistack  # install from the Codex marketplace
$vistack:vistack <request>        # canonical Codex skill in a new thread
$vistack:run|orchestrator|coordinator <request> # equivalent aliases
```

Verification after any edit is one command, the same locally and in CI: `scripts/verify.sh`.
It runs the structural checker and its lints (`scripts/check-playbooks.mjs`), the Python tests,
and the Node script tests, then compares the installed copy when one is on the machine. Set
`QA_VIDEO_PLAYWRIGHT` to a Playwright package path to run the QA video recording tests instead
of skipping them, and run `claude plugin details vistack` for the component inventory. A skill
or agent that fails frontmatter or path rules loads as *nothing*, silently, with no error.

## Layout and load rules

| Path | Loads as |
|---|---|
| `.claude-plugin/plugin.json` | plugin manifest + semver |
| `.claude-plugin/marketplace.json` | marketplace entry |
| `.codex-plugin/plugin.json` | Codex plugin manifest |
| `.agents/plugins/marketplace.json` | Codex marketplace entry |
| `commands/vistack.md` | the canonical `/vistack:vistack` command — thin, delegates to the router skill |
| `commands/{run,orchestrator,coordinator}.md` | Claude alias commands that delegate to the router |
| `skills/<name>/SKILL.md` | a skill |
| `skills/vistack/SKILL.md` | the router (see below) |
| `skills/{run,orchestrator,coordinator}/SKILL.md` | Codex alias shims that delegate to the router |
| `skills/vistack/playbooks/*.md` | data read by the router, **not** skills |
| `skills/vistack/principles/index.md` | data read first on every run |
| `agents/<name>.md` | a subagent |
| `docs/guide/*.md` | reference prose linked from skills |
| `skills/<name>/references/*.md` | data read by that skill, **not** skills |
| `skills/<name>/assets/*` | templates a skill copies; data, **not** skills |
| `skills/<name>/scripts/*` | scripts bundled with a skill; their paths resolve from the plugin root |
| `laya/`, `prwatch/` | Python packages behind `scripts/vistack-decision.py` and `scripts/watch-pr.py` |
| `hooks/hooks.json` | the deck mod: names `hooks/register.tsx`, the Claude Code hooks module |
| `hooks/register.tsx`, `hooks/lib/`, `hooks/tabs/` | the deck's wiring, pure logic, and tab views; `docs/guide/deck.md` |
| `types/index.d.ts` | the deck's session-state contract, named by `"types"` in `.claude-plugin/plugin.json` |
| `tests/*.test.ts(x)` | the deck's tests, run by `claude plugin test .` |

Codex discovers the same top-level `skills/<name>/SKILL.md` files. It does not execute the
Claude-only `commands/` or `agents/` directories; `skills/vistack/SKILL.md` contains the host
adapter and uses `.codex/vistack/` for Codex run state and worktrees.

The deck mod is Claude Code only. `claude plugin validate .` must pass. It enforces two rules:
`$` is passed only to functions declared at the top level of `hooks/register.tsx`, and every
atom is declared in the file that uses it. Its `$.state` keys name the plugin (`vistack`), so
a plugin rename renames them in `hooks/register.tsx` and `types/index.d.ts`.

Two hard constraints that break loading silently when violated:

- **Claude Code discovers a skill only at `skills/<name>/SKILL.md`.** One level deeper
  (`skills/principles/<name>/SKILL.md`) yields zero skills. All principles therefore sit at
  the top level of `skills/` rather than being nested.
- **Every skill and agent `name` must match `^[a-z0-9]+(-[a-z0-9]+)*$`, and the directory or
  filename must match the frontmatter `name`.** `viStack` in a `name:` field or a directory
  name breaks the load. `viStack` is prose only; `vistack` is the identifier.

## Architecture

The design is a **router → playbook → agent** chain, with all coordination state on disk.

1. **Router** (`skills/vistack/SKILL.md`) picks *exactly one* playbook and copies its
   numbered steps into the task list **verbatim** — no paraphrase, no reorder, no merge, no
   silent drop. A step that will not run stays in the list, marked skipped, with the reason
   written to the ledger. The playbook file is the executable contract; the router only
   chooses between files.
2. **Router is sticky.** Once entered, later turns continue the open playbook. `new task`
   forces a re-match; `stop`/`pause` runs `pause-safely`.
3. **`coordinate`** (`skills/coordinate/SKILL.md`) owns dispatch, the state file and the
   ledger from Step 5 onward. It never edits product code.
4. **Agents** are per-role and carry their model, and effort where the tree sets it, in
   frontmatter. The main session runs Opus 5.5 at xhigh and plans, decides, and verifies.
   `analyst` (explorer) and `researcher` run on opus at medium. Code goes by tier: sonnet
   `implementer` for mechanical work — repetitive edits, basic utils, unit tests — and opus
   `senior-implementer` at xhigh for complex work. Haiku runs the adversarial health check. Sonnet `report-writer` renders pages.
   Models and effort are never overridden per-run — change the agent file instead.
5. **Advisor on call.** Fable 5.1 reads the whole session and speaks at three checkpoints
   (`skills/advisor/SKILL.md`). It reviews; the main session ships. When the advisor tool is
   off, the `advisor` agent reviews a dossier instead.
6. **Laya is the fork layer.** Forks that need no thinker — which playbook, which file,
   which tool, which tier, retry or stop — go to `laya-decision`: deterministic policy
   first, then, for split forks only, opted-in Jev, then opted-in Cloudflare Workers AI
   `@cf/cloudflare/clef-flash` inside the free daily Neurons, then a local Ollama
   `clef-flash`. Sharp forks run in code; split forks go to the main session. Forks never
   reach the advisor.

### Run state (schema-bearing — see "Versioning")

Two git-ignored files per run in the *consuming* repo, never here. Claude uses:

- `.claude/state/<slug>.json` — where the run is, keyed by slice; updated on **every**
  transition, because it is the resume point for `session-pickup`.
- `.claude/state/<slug>.tsv` — append-only decision ledger, seven tab-separated columns
  `ts phase slice decision reason evidence result`, no header. Column semantics and the
  `decision` vocabulary: `docs/guide/ledger-format.md`.

The state file records intent, the ledger records what happened; after a crash they disagree
and `session-pickup` reconciles them.

### Invariants the content must keep

These recur across playbooks, agents and skills — a change in one place must be made
everywhere it appears:

- **The four fences** (blocker unresolved after `unblock`; ambiguity changing acceptance
  criteria or a public contract; irreversible action; credentials missing/expired/about to be
  written to a tracked file). Outside those four, runs are unattended and report at phase
  boundaries only.
- **Stops at merge-ready, never merges.** Every PR is left a draft. Merging is FENCE 3.
- **Advisor at three checkpoints.** Consult the advisor before a large plan, when an error
  repeats, and before calling a long task done. It never edits, merges, or opens a fence,
  and an unavailable advisor never blocks a run.
- **≤500 changed lines per PR**, excluding lockfiles and generated files; over that,
  `stack-split` makes a parent→child chain.
- **One worktree per slice** at `.claude/worktrees/<slug>`; slices sharing a file are
  serialized by the conflict matrix from `slice-plan`, never run concurrently.
- **Host-specific state.** Codex uses `.codex/vistack/state/` and
  `.codex/vistack/worktrees/`. A run does not switch state roots when it changes hosts.
- **Codex lanes.** Codex roles run in the thread; only a read-only or scratch-directory lane
  fans out as its own `codex exec --ephemeral` process.
- **A long or unattended run ends with a run report.** A run with more than one slice, or any
  unattended run, renders one through `skills/html-report/SKILL.md`, published as a private
  artifact on Claude Code.
- **Repo-agnostic.** Nothing hardcodes a repository, branch, reviewer team, or service. The
  three per-repo inputs are base branch, reviewer team, and verification target.
- **Reuse, do not reimplement.** viStack supplies only the coordinator layer, state file,
  conflict matrix and ledger. Every other step invokes an existing skill (`work-ticket`,
  `create-pr`, `stacking-prs`, `requesting-reviewers`, `address-ai-reviews`,
  `qa-verification`, `pruning-comments`, `cleanup-worktrees`, …). Do not write a second
  version of one here.

### Writing style for principle invocations

A reply that names a principle must name **the decision the principle changed**. Restating a
principle's name is a citation with no content and should be deleted. Keep that standard in
any prose added to the skills.

## Versioning

Semver lives in `.claude-plugin/plugin.json`; `.codex-plugin/plugin.json` and
`.grok-plugin/plugin.json` carry the same version:

- **patch** — wording, a clarified step, a fixed link, a better example
- **minor** — a new playbook, principle, or agent
- **major** — a changed state-file or ledger schema, because `session-pickup` reads state
  files written by earlier versions; renaming a column or key breaks every run in flight

**One version bump per PR, in its own commit**, with the changed skills named in the body.

## Paths in content

Every path written inside skills, agents and docs is relative to the plugin root
(`skills/…`, `agents/…`, `docs/…`). Keep it that way — the plugin is installed at a
different absolute path on every machine.

Runtime commands resolve from the plugin root (`${CLAUDE_PLUGIN_ROOT}` on Claude Code) while the
working directory stays in the consuming repository.

Editing a contract: read `docs/guide/writing-contracts.md` first.

## Rules and what enforces them

Each rule here was broken at least twice. `/vistack:correct` (`skills/correct/SKILL.md`) adds
a row when the operator corrects a mistake, and a row whose mistake can no longer happen is
dropped. An exception goes on the offending line as
`lint-ok: <rule>; <reason>; expires YYYY-MM-DD; approved-by <name>`.

| Rule | Enforced by | Proved against |
|---|---|---|
| Supported Ollama decision models and the tier ladder each have one home | `OLLAMA_MODELS` in `laya/ollama_models.py` and `LADDER` in `laya/engine.py`, read by the CLI and status; `scripts/check-playbooks.mjs` fails a retired tier name and a `decisions-*` description that disagrees with `LADDER` | the 0.21.0 tree: `commands/decisions-off.md:2` listed (Jev, Ollama, Laya) against a six-tier ladder |
| `node --test` takes test files, not a directory | `scripts/verify.sh` is the one command; `scripts/check-playbooks.mjs` fails a directory passed to `node --test` | the directory form recorded in the claude5-tuneup and qa-video ledgers (`skills/html-report/scripts/`) |
| A script path resolves from the plugin root; the working directory stays in the consuming repository | `scripts/check-playbooks.mjs` fails "from the plugin root" without "resolves" | 0.21.0 `skills/routine-healthcheck/SKILL.md:49` and this file's layout table |
| An edit is live only when the installed copy matches this checkout | `scripts/verify.sh` drift step | this change against the installed 0.21.0 copy |
| Routes, playbooks, skill names, and referenced paths agree | `scripts/check-playbooks.mjs` | 15 recorded FAIL lines while adding `html-report` and `qa-video` |
| One version bump per change, in its own commit | nothing for the bump itself: a forgotten bump shows only in git history. `scripts/check-playbooks.mjs` fails when the three manifests or the README version line disagree | a README version line left at 0.22.0 against 0.23.0 manifests |
