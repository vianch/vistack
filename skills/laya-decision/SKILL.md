---
name: laya-decision
description: "Use the optional local Laya decision engine for typed advisory recommendations while viStack remains authoritative for routing, execution, state, and evidence."
---

# laya-decision

The local decision engine is an advisory extension of viStack. Read
`docs/guide/laya-decision-engine.md` before adding a decision type or changing the adapter.

The hook is enabled by default. Use `python3 scripts/vistack-decision.py decision <decision-type>` when a workflow choice
needs structured reasoning. Supply the current task, state, evidence, constraints, history,
and available actions. The returned `Decision` is machine-consumable but never authorizes
execution.

Use `python3 scripts/vistack-decision.py laya off` to disable refinement for the consuming
project, `laya on` to restore it, and `laya status` to inspect it. Use `--disable-laya` for a
single request or `VISTACK_LAYA_ENABLED=0` for the current environment. These controls leave
the deterministic viStack policy active.

The deterministic policy runs first, and a confident answer is sharp without a model turn.
Only a split answer climbs the ladder: hosted Jev when opted in (`laya on --jev` or
`VISTACK_LAYA_JEV=1`), local Laya-MLX, local Kev, and then an explicitly opted-in read-only
host CLI (Claude Haiku or a low-effort Codex model). If a tier is unavailable, refused,
malformed, low-confidence, or incompatible with a fence, continue to the next one and finally
the deterministic result with `fork: split`. The coordinator still validates every route,
state transition, worktree, ledger update, check, and evidence artifact. `laya on` alone
does not opt into cloud usage.

`tool-selection` and `file-selection` take the candidate tools or files in
`available_actions`, described by `task.tools` or `task.file_summaries`. Read `fork` on every
result: apply a sharp one, decide a split one yourself and record why.

Use the long-lived `serve` command for repeated decisions. Use the `override`, `outcome`,
and `feedback` commands to record human corrections and reviewable improvement proposals.
Never use model output to merge, force-push, deploy, delete data, change secrets, or bypass
an explicit human decision.

Laya is the fork layer: it takes the choices that need no thinker, so the main session spends
reasoning where it changes the outcome. A sharp fork — a valid action at or above the
confidence threshold that every safety gate accepts — is applied in code. A split fork
returns to the main session, which decides and records why. Forks never reach the advisor
(`skills/advisor/SKILL.md`). Move a fork from split to sharp only through the held-out
hillclimb in `docs/guide/laya-decision-engine.md`.
