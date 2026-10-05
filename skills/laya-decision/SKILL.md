---
name: laya-decision
description: "Use the optional local Laya decision engine for typed advisory recommendations while viStack remains authoritative for routing, execution, state, and evidence."
---

# laya-decision

Laya is the fork layer. It takes the choices that need no thinker, so the main session spends
reasoning where it changes the outcome: which playbook, which file goes to which slice, which
file or tool the next step uses, which tier, dispatch or hold, and retry or stop. A sharp
fork, a valid action at or above the confidence threshold that every safety gate accepts, is
applied in code without a model turn. A split fork returns to the main session, which decides
and records why. Forks never reach the advisor (`skills/advisor/SKILL.md`). Move a fork from
split to sharp only through the held-out hillclimb in `docs/guide/decision-engine.md`.

Call it only when a choice changes routing, readiness, decomposition, dispatch, runtime
recovery, verification, or rule review. It is not a coding agent, and it never replaces the
router, coordinator, state, ledger, worktrees, evidence gates, or merge boundary. Read
`docs/guide/decision-engine.md` for installation, the JSONL server, and the schema, and
before adding a decision type or changing the adapter.

## Boundaries

Call the hook at these boundaries.

| Boundary | Decision type | Existing authority |
|---|---|---|
| intake and grooming | `intake-analysis`, `grooming` | readiness fields and FENCE 2 |
| route match | `playbook-selection` | the route table in `skills/vistack/SKILL.md` and the matched playbook |
| slice planning | `decomposition`, `tier-selection` | file ownership, conflict matrix, the 500-line limit, and the planner's tier rule |
| pre-dispatch and monitoring | `dispatch-readiness`, `runtime-progress` | coordinator state, dependencies, monitor, and ledger |
| QA | `verification` | captured artifacts tied to each acceptance criterion |
| a step inside a slice | `tool-selection`, `file-selection` | the slice's writable files and the fences |
| retrospective review | `skill-improvement` | explicit human review; no automatic skill edits |

## Calling it

`${CLAUDE_PLUGIN_ROOT}` is the plugin root on Claude Code. On Codex, use the installed plugin
path, as the Host adapter in `skills/vistack/SKILL.md` sets out.

The hook is enabled by default. Run
`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decision <decision-type>` with the
current task, state, evidence, constraints, history, and available actions. The engine takes
that bounded `DecisionContext` and returns a typed `Decision`; read its `fork` every time.
With no model configured, `auto` returns the deterministic policy.

`tool-selection` and `file-selection` take the candidate tools or files in
`available_actions`, described by `task.tools` or `task.file_summaries`.

Record the returned decision id, backend, confidence, fallback status, and evidence pointer
in the decision history or run ledger when the consuming project has enabled it.

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
