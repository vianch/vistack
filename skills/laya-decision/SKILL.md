---
name: laya-decision
description: "Use the optional local Laya decision engine for typed advisory recommendations while viStack remains authoritative for routing, execution, state, and evidence."
---

# laya-decision

Laya is the fork layer. It takes the choices that need no thinker, so the main session spends
reasoning where it changes the outcome: which playbook, which file goes to which slice, which
file or tool the next step uses, which tier, which model and effort a dispatch runs on,
dispatch or hold, and retry or stop. A sharp fork, a valid action at or above the confidence
threshold that every safety gate accepts, is applied in code without a model turn. A split fork returns to the main session, which decides
and records why. Forks never reach the advisor (`skills/advisor/SKILL.md`). Move a fork from
split to sharp only through the held-out hillclimb in `docs/guide/decision-engine.md`.

Call it only when a choice changes routing, readiness, decomposition, dispatch, runtime
recovery, verification, or rule review. It is not a coding agent, and it never replaces the
router, coordinator, state, ledger, worktrees, evidence gates, or merge boundary. Read
`docs/guide/decision-engine.md` for installation, the JSONL server, and the schema, and
before adding a decision type or changing the adapter.

## Boundaries

The main session makes one call at each boundary below, with its working directory in the
consuming repository:

```
echo '<context>' | python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decision <type> --backend auto
```

Every context carries `"metadata": {"source": "main-session"}` and the keys in the Context
column. `task.request` is the user's original request, never the enhanced text.

| Boundary | Decision type | Context | Existing authority |
|---|---|---|---|
| intake playbook, before grooming | `intake-analysis` | `task.request` | readiness fields and FENCE 2 |
| intake playbook, grooming | `grooming` | `task.request`, `task.acceptance_criteria`, `task.finish_condition`, `task.open_questions` | readiness fields and FENCE 2 |
| router Step 2, before the match | `playbook-selection` | `task.request`; `current_state.phase` on a resumed run | the route table in `skills/vistack/SKILL.md` and the matched playbook |
| after `slice-plan` | `decomposition` | `task.request`, `task.slices` (each with `files` and `depends_on`), `task.estimated_changed_lines` | file ownership, conflict matrix, and the 500-line limit |
| a slice with no planner tier | `tier-selection` | Dispatch rules in `skills/coordinate/SKILL.md` | the planner's tier rule |
| each dispatch | `model-selection` | Dispatch rules in `skills/coordinate/SKILL.md` | the agent file's default model and effort |
| before each `dispatched` ledger row | `dispatch-readiness` | `task.brief`, `task.acceptance_criteria`, `task.verification_command`, `task.writable_files`, `task.dependencies`, `current_state.dependencies_satisfied` | coordinator state, dependencies, and the conflict matrix |
| each monitor pass | `runtime-progress` | `current_state.phase`, `attempts`, `identical_results`, `stalled`, `blockers` | the stall rule, `unblock`, and the fences |
| before merge-ready | `verification` | `task.acceptance_criteria`, one `evidence` entry per artifact (`kind`, `ref`, `criterion`, `status`) | captured artifacts tied to each acceptance criterion |
| after a `correction-recorded` row | `skill-improvement` | `current_state.human_overrides`, `current_state.repeated_pattern` | explicit human review; no automatic skill edits |
| a step inside a slice | `tool-selection`, `file-selection` | `available_actions`, the candidate tools or files, described by `task.tools` or `task.file_summaries` | the slice's writable files and the fences |

`tool-selection` and `file-selection` exit non-zero without `available_actions`, so skip
them when the step has no explicit candidates.

The deck's Types block lists every type above and shows `never asked` for a boundary call the
coordinator skipped, so a missing call is visible (`docs/guide/deck.md`, The Types block).

The answer is advisory and viStack stays authoritative. Each call is appended to the decision
history in the state root (`.claude/vistack/decision-history.jsonl` on Claude Code), which the
deck's Decisions tab reads, so never pass `--no-history`. A call that fails, times out, or is
skipped never blocks the run: the existing authority decides and the run goes on.

## Calling it

`${CLAUDE_PLUGIN_ROOT}` is the plugin root on Claude Code. On Codex, use the installed plugin
path, as the Host adapter in `skills/vistack/SKILL.md` sets out.

The hook is enabled by default. The engine takes the bounded `DecisionContext` on stdin and
returns a typed `Decision`; read its `fork` every time. With no model configured, `auto`
returns the deterministic policy.

The CLI writes each decision, its backend, confidence, and fallback status to the decision
history itself. Name the returned decision id in the run ledger row the decision fed.

Use the long-lived `serve` command for repeated decisions. Use the `override`, `outcome`,
and `feedback` commands to record human corrections and reviewable improvement proposals.

## The ladder

The deterministic policy runs first, and a confident answer is sharp without a model turn.
Only a split answer climbs the ladder:

1. hosted Jev when opted in (`decisions on --jev` or `VISTACK_LAYA_JEV=1`);
2. Cloudflare Workers AI `@cf/cloudflare/clef-flash` when opted in (`decisions on --cloudflare`
   or `VISTACK_LAYA_CLOUDFLARE=1`), with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in
   the environment, held to a 0.85 floor and a daily Neuron cap (default 9,000 of the 10,000
   free; see `docs/guide/decision-engine.md`). At the cap, or when Cloudflare refuses, it
   sends nothing and the fork moves on;
3. local Ollama `clef-flash` when opted in (`decisions on --ollama-model clef-flash` or
   `VISTACK_LAYA_OLLAMA_MODEL`), held to its own 0.85 threshold.

If a tier is unavailable, refused, timed out, malformed, low-confidence, or rejected by a
safety gate or fence, continue to the next one and finally the deterministic result with
`fork: split`. `decisions on` alone does not opt into cloud usage. Ollama runs on the machine
and sends nothing off it; Jev sends the redacted state to TypeSafe and Cloudflare sends it to
Cloudflare. Credentials alone do not opt in.

## Switches

`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions off` disables
refinement for the consuming project, `decisions on` restores it, and `decisions status`
inspects it. `/vistack:decisions-on` asks whether the local Ollama `clef-flash` model runs
after the cloud tiers, and pulls it when the user picks it; `--jev` and `--cloudflare` are
flags, never questions. Use `--disable-laya` for a single request or
`VISTACK_LAYA_ENABLED=0` for the current environment. These controls leave the deterministic
viStack policy active.

## Authority

A recommendation is input to the existing rule, never permission to act. Never use model
output to merge, force-push, deploy, delete data, change secrets, bypass a fence or an
explicit human decision, or invent evidence.
