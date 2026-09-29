---
name: architect
description: "Design before implementing: ground the change, have independent runners sketch at least two structurally distinct designs (caller usage first, then types, signatures, and a module map), screen them for design red flags, synthesize one, then implement against it and scrap it when it proves wrong. Use when a change crosses function boundaries or moves ownership, or when asked to architect or design something first."
---

# architect

Settle the shape before the code. Sketch types, signatures, and module boundaries with
`not implemented` bodies, compare independent candidates, synthesize one, then fill it in.
When implementation proves the sketch wrong, throw it out and redesign.

Open one task-list entry per phase: ground, sketch, screen, synthesize, agree, implement,
scrap.

## Runners use the current host's model

| Host | Runner | How |
|---|---|---|
| Claude Code | the `design-runner` agent (opus) | dispatch every runner in one message, in parallel |
| Codex | Luna, the model in `~/.codex/config.toml` (`gpt-6-luna`) | one `codex exec --ephemeral -m <model>` process per runner, writing only to its own directory |
| OpenCode | the configured model | one runner at a time in the thread; record `independence: reduced` |

Codex lanes follow the host adapter's lane rule in `skills/vistack/SKILL.md`. Each runner
writes only to `<state-root>/<slug>/design/candidate-<n>/`, which is git-ignored.
A runner that fails is a dropout: continue with the rest and name it in the synthesis.

## Phase A. Ground

Dispatch `analyst` for an impact map of every system the design touches: entry points, call
sites, blast radius, existing patterns, coverage. Naming a file is not grounding. When the
design moves ownership or layering, include the history of the load-bearing lines so the
existing rationale becomes a constraint instead of a guess.

Skip this phase only for greenfield work with nothing around it to integrate.

## Phase B. Sketch

Give every runner `skills/architect/references/runner-prompt.md` filled with the task, the
grounding paths, and its output directory. Each returns a design package shaped by
`skills/architect/references/rationale-template.md`.

Design it twice. Require at least two structurally distinct candidates, even when the first
looks sufficient: whole-shape alternatives, not point fixes inside one shape. This rule is the
architect's own; no principle covers exhausting the design space. Ask for more
when the decision is expensive to reverse. Before dispatch, write the brief's rubric: three
to six gradeable criteria for success.

## Phase C. Screen

Read every candidate end to end. Screen each against
`skills/architect/references/design-red-flags.md` — shallow modules, information leakage,
temporal decomposition, pass-through methods — and revise or reject what fails.

Compare the survivors on interface depth. Prefer the design that hides the most complexity
behind the smallest, simplest public surface. A rich interface that concentrates capability
beats a thin one that scatters it across layers.

In parallel, dispatch one read-only `reviewer` as judge: it scores each candidate against the
rubric, criterion by criterion, and names the base it would pick. It shares the runners'
model family, so its verdict informs the pick; it does not make it.

## Phase D. Synthesize

Pick the base a future maintainer can extend most easily without breaking its invariants.
On a tie, take the cleaner boundary or the smaller API. Then walk each other candidate once
more and graft one or two real improvements, by hand, so the result stays coherent. When the
candidates diverge wildly, the brief was under-specified: return to Phase A.

Fill the rationale's synthesis section: the base and why, each graft and its source, what was
rejected and why, any dropout, and the judge's verdict where it disagreed. Record one ledger
row, `decision: design-synthesized`, with the rationale path as evidence.

## Phase E. Agree

The default is no checkpoint: continue into implementation. Stop for sign-off only when the
user asks — "with checkpoint", "show me before implementing". A pushback on the shape, at a
checkpoint or later, is Phase A evidence: re-ground and re-sketch before writing more code.

The synthesized sketch may land as its own scaffold slice (`foundational-thinking`). For
adversarial pressure before implementing, run `interrogate` on the sketch. A large or
unattended plan still gets the advisor `plan` checkpoint (`skills/advisor/SKILL.md`).

## Phase F. Implement against the sketch

Replace `not implemented` bodies with code and pseudocode with logic. The sketch is the
contract. A deviation is signal: when a function needs a parameter the sketch did not
anticipate, decide whether the sketch was wrong, a requirement was missed, or the
implementation is overreaching, and record which.

## Phase G. Scrap when the shape is wrong

When implementation keeps producing friction the sketch cannot absorb, throw the sketch out.
Do not bolt fixes onto a wrong design (`fix-root-causes`). The signal is a pattern, not one
instance:

- the same workaround in unrelated places;
- several unrelated edge cases that each need a special branch;
- types that only compile with `any`, casts, or optional fields that are always set;
- a lock appearing where the sketch said the state was not shared;
- callers that must know the abstraction's internal rules;
- two or more independent deviations of the same shape.

A few edge cases do not condemn a design; complexity in the data is not complexity in the
design. When you scrap: re-ground over what was built, redesign as if the new constraints had
been known on day one (`foundational-thinking`), make the new sketch smaller than the old one before it grows
(`subtract-before-you-add`), and return to Phase B.

## Outputs

The caller's usage first, with the type sketch derived from it: one file of types and
signatures for a small change, a module map plus type definitions for a larger one. The
rationale ships beside it, including the usage sketch and the synthesis decision.
