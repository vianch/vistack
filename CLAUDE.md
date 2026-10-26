## What this repository is

viStack is a **Claude Code and Codex plugin**, not an application: Markdown skills, agents,
playbooks, and docs, plus host manifests and small dependency-free validation scripts. Editing
a contract changes agent behavior directly.

This checkout is the source (upstream `github.com/vianch/viStack`). Claude Code loads the
installed copy at `~/.claude/plugins/marketplaces/vistack`; `scripts/verify.sh` fails while they
differ and prints the sync command.

## Commands

```
/plugin install vistack          # install / pick up a new version
/plugin                          # confirm viStack is listed as enabled
claude plugin details vistack    # component inventory; count skills/agents to verify loading
/vistack:vistack <request>       # canonical plugin entry point
/vistack:run|orchestrator|coordinator <request> # equivalent aliases
codex plugin add vistack@vistack # install from the Codex marketplace
$vistack:vistack <request>       # canonical Codex skill in a new thread
$vistack:run|orchestrator|coordinator <request> # equivalent aliases
```

`scripts/verify.sh` is the one verification command, locally and in CI:
`scripts/check-playbooks.mjs` and its lints, Python and Node tests, the installed-copy check.
`QA_VIDEO_PLAYWRIGHT`, a Playwright package path, turns on the otherwise skipped QA video tests.

## Layout and load rules

| Path | Loads as |
|---|---|
| `.claude-plugin/plugin.json` | plugin manifest + semver |
| `.claude-plugin/marketplace.json` | marketplace entry |
| `.codex-plugin/plugin.json` | Codex plugin manifest |
| `.agents/plugins/marketplace.json` | Codex marketplace entry |
| `commands/vistack.md` | the canonical `/vistack:vistack` command, delegating to the router |
| `commands/{run,orchestrator,coordinator}.md` | Claude alias commands for the router |
| `skills/<name>/SKILL.md` | a skill |
| `skills/vistack/SKILL.md` | the router |
| `skills/{run,orchestrator,coordinator}/SKILL.md` | Codex alias shims for the router |
| `skills/vistack/playbooks/*.md` | data read by the router, **not** skills |
| `skills/vistack/principles/index.md` | data read first on every run |
| `agents/<name>.md` | a subagent |
| `docs/guide/*.md` | reference prose linked from skills |
| `skills/<name>/references/*.md` | data read by that skill, **not** skills |
| `skills/<name>/assets/*` | templates a skill copies, **not** skills |
| `skills/<name>/scripts/*` | scripts bundled with a skill; their paths resolve from the plugin root |
| `laya/`, `prwatch/` | Python packages behind `scripts/vistack-decision.py` and `scripts/watch-pr.py` |
| `hooks/hooks.json` | the deck mod; names `hooks/register.tsx`, its hooks module |
| `hooks/register.tsx`, `hooks/lib/`, `hooks/tabs/` | the deck's wiring, pure logic, and tab views; `docs/guide/deck.md` |
| `types/index.d.ts` | the deck's session-state contract, named by `"types"` in `.claude-plugin/plugin.json` |
| `tests/*.test.ts(x)` | the deck's tests, run by `claude plugin test .` |

Codex discovers the same skills and ignores the Claude-only `commands/` and `agents/`.

The deck mod is Claude Code only and must pass `claude plugin validate .`, which enforces:
`$` is passed only to functions declared at the top level of `hooks/register.tsx`, and every
atom is declared in the file that uses it. `$.state` keys name the plugin (`vistack`); a
rename changes them in `hooks/register.tsx` and `types/index.d.ts`.

A skill or agent that fails frontmatter or path rules loads as *nothing*, silently. Two hard
constraints:

- **Claude Code discovers a skill only at `skills/<name>/SKILL.md`.** One level deeper
  yields zero skills, so principles sit at the top level.
- **Every skill and agent `name` must match `^[a-z0-9]+(-[a-z0-9]+)*$`, and the directory or
  filename must match the frontmatter `name`.** `viStack` is prose only; `vistack` is the
  identifier.

## Architecture

1. **Router** (`skills/vistack/SKILL.md`, Step 2) copies one playbook's steps verbatim.
2. **Sticky.** Later turns continue the open playbook until `new task` (router, Step 0).
3. **Coordinator.** `skills/coordinate/SKILL.md` owns dispatch, state, and ledger.
4. **Agents** carry model and effort in frontmatter, never overridden per run; change the
   agent file (router, Agent tree).
5. **Advisor.** Three checkpoints, `skills/advisor/SKILL.md`.
6. **Laya.** Forks that need no thinker, `skills/laya-decision/SKILL.md`.

### Run state (schema-bearing)

- `.claude/state/<slug>.json`, consuming repo: resume point, `skills/coordinate/references/state-file.md`.
- `.claude/state/<slug>.tsv`, consuming repo: ledger, `docs/guide/ledger-format.md`.
- `~/.vistack/review-watch/state.json`: review watch, `skills/review-watch/references/data.md`.

The state file records intent, the ledger records what happened; after a crash they disagree
and `session-pickup` reconciles them.

### Invariants

A change to an invariant is made in its home, then the pointers are checked.

| Invariant | Home |
|---|---|
| Four fences | `skills/autonomy-has-fences/SKILL.md` |
| Stop at merge-ready | router, Merge boundary |
| Advisor checkpoints | `skills/advisor/SKILL.md` |
| Main session runs no owning role's work | `skills/coordinate/SKILL.md`, Dispatch rules |
| 500 changed lines per PR | `skills/one-concern-per-pr/SKILL.md` |
| One worktree per slice; QA lanes own none | `skills/coordinate/SKILL.md`, QA lanes; `skills/slice-plan/SKILL.md` |
| Host state roots, Codex lanes | router, Host adapter |
| Run report, long or unattended runs | router, Final report |
| Repo-agnostic; per-repo inputs: base branch, reviewer team, verification target | this file |
| Reuse `work-ticket`, `create-pr`, `stacking-prs`, `requesting-reviewers`, `address-ai-reviews`, `qa-verification`, `pruning-comments`, `cleanup-worktrees` | this file (the names); router, Reuse existing skills (the rule) |

Naming a principle means naming **the decision it changed**; a bare citation is deleted.

## Versioning

Semver lives in `.claude-plugin/plugin.json`; `.codex-plugin/plugin.json` and
`.grok-plugin/plugin.json` carry the same version:

- **patch** — wording, a clarified step, a fixed link, a better example
- **minor** — a new playbook, principle, or agent
- **major** — a changed state-file or ledger schema, because `session-pickup` reads state
  files written by earlier versions; renaming a column or key breaks every run in flight

**One version bump per PR, in its own commit**, with the changed skills named in the body.

## Paths in content

Paths inside skills, agents, and docs are relative to the plugin root (`skills/…`), because
the plugin installs at a different absolute path on every machine. Runtime commands resolve
from `${CLAUDE_PLUGIN_ROOT}` on Claude Code (router, Host adapter).

Editing a contract: read `docs/guide/writing-contracts.md` first.

## Rules and what enforces them

Each rule here was broken at least twice. `/vistack:correct` (`skills/correct/SKILL.md`) adds
a row per operator correction; a row whose mistake can no longer happen is dropped. An exception goes on the offending line as
`lint-ok: <rule>; <reason>; expires YYYY-MM-DD; approved-by <name>`.

| Rule | Enforced by | Proved against |
|---|---|---|
| Supported Ollama decision models and the tier ladder each have one home | `OLLAMA_MODELS` in `laya/ollama_models.py` and `LADDER` in `laya/engine.py`, read by the CLI and status; `scripts/check-playbooks.mjs` fails a retired tier name and a `decisions-*` description that disagrees with `LADDER` | the 0.21.0 tree: `commands/decisions-off.md:2` listed (Jev, Ollama, Laya) against a six-tier ladder |
| `node --test` takes test files, not a directory | `scripts/verify.sh` is the one command; `scripts/check-playbooks.mjs` fails a directory passed to `node --test` | the directory form recorded in the claude5-tuneup and qa-video ledgers (`skills/html-report/scripts/`) |
| A script path resolves from the plugin root; the working directory stays in the consuming repository | `scripts/check-playbooks.mjs` fails "from the plugin root" without "resolves" | 0.21.0 `skills/routine-healthcheck/SKILL.md:49` and this file's layout table |
| An edit is live only when the installed copy matches this checkout | `scripts/verify.sh` drift step | this change against the installed 0.21.0 copy |
| Routes, playbooks, skill names, and referenced paths agree | `scripts/check-playbooks.mjs` | 15 recorded FAIL lines while adding `html-report` and `qa-video` |
| The main session runs no work an owning role owns: code to the tier owner, QA to a background `qa-verifier` lane | `scripts/check-playbooks.mjs` fails a contract line that hands the main session code or QA work (`mainSessionWork`); the deck flags each main-loop Edit, Write, or NotebookEdit outside `.claude/` and `.codex/` (`codeWrites` in `hooks/lib/org.ts`, shown on the Board tab), flag only and fail-open | the 0.24.0 tree: `skills/advisor/SKILL.md:8`, `agents/advisor.md:9`, `CLAUDE.md:101`, `README.md:624`, `skills/vistack/playbooks/html-report.md:21`, `docs/guide/codex.md:73`; run ledgers `.claude/state/qa-video.tsv:5,8,11` and `.claude/state/cloudflare-clef-tier.tsv:7,8` |
| One version bump per change, in its own commit | nothing for the bump itself: a forgotten bump shows only in git history. `scripts/check-playbooks.mjs` fails when the three manifests or the README version line disagree | a README version line left at 0.22.0 against 0.23.0 manifests |
| A staged file an agent wrote stays at or under 5,000 tokens (bytes / 4) | the `token-guard` pre-commit hook on staged files, installed per consuming repository with `skills/token-guard/scripts/token-guard.mjs install`; reviewers run its `check --files` (`skills/interrogate/references/code-quality-review.md`). Not installed in this checkout, where git is off-limits | `hooks/register.tsx` at 87,610 bytes (21,903 tokens), `tests/pane.test.tsx` at 53,523 bytes, and `hooks/lib/monitors.ts` at 32,299 bytes, each grown past the limit in small edits; `check --files hooks/register.tsx` exits 2 |
