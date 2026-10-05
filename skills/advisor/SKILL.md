---
name: advisor
description: "Consult the advisor at the three moments that change a run's outcome — before committing to a large plan, when the same error comes back, and before calling a long task done. Use at those checkpoints only; routine turns stay silent."
---

# advisor

The owning role writes the code; the main session plans, dispatches, and verifies; the
advisor reviews. Opus 5.5 runs the main session. Fable 5.1 reads the whole session and
speaks at three checkpoints only. The advisor never edits a file. The main session acts on
each point, through the owning role when it needs a write, or rebuts it with evidence.

## The three checkpoints

| Checkpoint | Trigger | The question |
|---|---|---|
| `plan` | A plan with more than one slice, a cross-boundary fix, or an unattended run is about to dispatch | Is this the right approach, and what is it blind to? |
| `repeat` | The same error text returns after a change meant to fix it — the second identical result | Am I digging in the wrong place? |
| `done` | A multi-step or unattended run is about to be reported done or merge-ready | What did I miss? |

The `plan` consultation includes a blind-spot pass with three questions: what the plan
relies on but never wrote down (the unknown knowns), what it has not considered (the unknown
unknowns), and which parts are most likely to change. Settle the answers before dispatch,
because a spec change that costs a sentence now costs a re-cut slice later. Put the plan's
detail where change is most likely.

Which file, which tool, which tier, and retry or stop are forks, not checkpoints. Forks go to
the decision layer (`skills/laya-decision/SKILL.md`) and, when split, to the main session.
They never reach the advisor.

## How to consult

Run `skills/prompt-enhancer/SKILL.md` before each consultation. It shapes what you send, not
what the advisor reads: the transcript is never rewritten.

1. **Claude Code with the advisor tool on.** Name the checkpoint and ask its question over
   the enhanced request, with the original beside it. The advisor already reads the full
   transcript, every tool call included. Do not paste it.
2. **Advisor tool off** — `CLAUDE_CODE_DISABLE_ADVISOR_TOOL`, a non-Anthropic provider, a
   rejected pairing, or no Fable access. Dispatch the `advisor` agent with a dossier: the
   checkpoint, the finish predicate, the plan or the error with its attempt log, the diff
   summary, and the evidence paths. A `done` dossier also carries the run report path when
   one exists. Enhance the dossier and keep every evidence path in it. The agent sees only
   the dossier, so a missing part is a blind spot.
3. **Codex.** Mark the checkpoint `step-skipped` with the host reason; the enhancer pass
   before it is skipped in the same row. Adopting the advisor role in the same thread is not
   an independent review.
4. **Neither available.** Record `advisor-unavailable` and continue. A missing advisor is
   never a fence.

## Applying the advice

- Act on each point, or rebut it with evidence: a failing command, a `file:line`, an
  artifact. Advice the evidence contradicts is surfaced, not followed.
- Advice that changes acceptance criteria or a public contract is FENCE 2. Advice to take an
  irreversible action is FENCE 3. The advisor cannot authorize either.
- Consult once per checkpoint occurrence. A second `repeat` on the same error means the loop
  has stopped learning: finish the unblock budget or escalate with the dossier.

## Record

One ledger row per consultation: `decision: advisor-consulted`, `reason` the checkpoint
(`plan`, `repeat`, or `done`), `evidence` a pointer to what was reviewed, and `result: ok`
when the advice was applied or `skipped` when evidence rebutted it. When no advisor ran,
write `decision: advisor-unavailable` with `result: skipped`.

## Setup

Set `"advisorModel": "fable"` in `~/.claude/settings.json`, or run `/advisor fable`. Fable
5.1 as advisor needs Claude Code v2.1.257 or later, the Anthropic API, and a supported main
model; Opus 5.5 accepts Fable or Opus 5 and later. Subagents inherit the advisor and apply the
same pairing check. `DISABLE_TELEMETRY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, and
`DISABLE_ERROR_REPORTING` stop feature-flag fetching and keep the advisor off.
