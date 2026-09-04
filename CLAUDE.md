# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

viStack is a **Claude Code and Codex plugin**, not an application. The deliverable is mostly
Markdown (skills, agents, playbooks, docs) plus host manifests and small dependency-free
validation scripts. Editing a contract changes agent behavior directly. There is no product
build.

The working copy sits inside `~/.claude/plugins/marketplaces/vistack` and is **not a git
repository** at that path. The upstream is `github.com/vianch/viStack`.

## Commands

```
/plugin install vistack           # install / pick up a new version
/plugin                           # confirm viStack is listed as enabled
claude plugin details vistack     # component inventory — count skills/agents to verify loading
/vistack <request>                # the plugin's own entry point
codex plugin add vistack@vistack  # install from the Codex marketplace
$vistack <request>                # invoke the Codex skill in a new thread
```

Verification after any edit is the inventory and the structural checker:
`node scripts/check-playbooks.mjs`. A skill or agent that fails frontmatter or path rules
loads as *nothing*, silently, with no error.

## Layout and load rules

| Path | Loads as |
|---|---|
| `.claude-plugin/plugin.json` | plugin manifest + semver |
| `.claude-plugin/marketplace.json` | marketplace entry |
| `.codex-plugin/plugin.json` | Codex plugin manifest |
| `.agents/plugins/marketplace.json` | Codex marketplace entry |
| `commands/vistack.md` | the `/vistack` slash command — thin, delegates to the router skill |
| `skills/<name>/SKILL.md` | a skill |
| `skills/vistack/SKILL.md` | the router (see below) |
| `skills/vistack/playbooks/*.md` | data read by the router, **not** skills |
| `skills/vistack/principles/index.md` | data read first on every run |
| `agents/<name>.md` | a subagent |
| `docs/guide/*.md` | reference prose linked from skills |

Codex discovers the same top-level `skills/<name>/SKILL.md` files. It does not execute the
Claude-only `commands/` or `agents/` directories; `skills/vistack/SKILL.md` contains the host
adapter and uses `.codex/vistack/` for Codex run state and worktrees.

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
4. **Agents** are per-role and carry their model in frontmatter (opus for judgment/prose,
   sonnet for precisely-specified implementation, haiku for the adversarial health check).
   Models are never overridden per-run — change the agent file instead.

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
- **≤500 changed lines per PR**, excluding lockfiles and generated files; over that,
  `stack-split` makes a parent→child chain.
- **One worktree per slice** at `.claude/worktrees/<slug>`; slices sharing a file are
  serialized by the conflict matrix from `slice-plan`, never run concurrently.
- **Host-specific state.** Codex uses `.codex/vistack/state/` and
  `.codex/vistack/worktrees/`. A run does not switch state roots when it changes hosts.
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

Semver lives in `.claude-plugin/plugin.json`:

- **patch** — wording, a clarified step, a fixed link, a better example
- **minor** — a new playbook, principle, or agent
- **major** — a changed state-file or ledger schema, because `session-pickup` reads state
  files written by earlier versions; renaming a column or key breaks every run in flight

**One version bump per PR, in its own commit**, with the changed skills named in the body.

## Paths in content

Every path written inside skills, agents and docs is relative to the plugin root
(`skills/…`, `agents/…`, `docs/…`). Keep it that way — the plugin is installed at a
different absolute path on every machine.
