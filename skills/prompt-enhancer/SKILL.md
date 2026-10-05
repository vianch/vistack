---
name: prompt-enhancer
description: "Internal pass called by path from the viStack router before analysis, by coordinate when it writes a brief's slice fields, and by advisor before a checkpoint. Rewrites one request, brief, or dossier so it is accurate and readable, keeps the original verbatim, and lists what is missing. Never changes scope or invents a finish condition."
---

# prompt-enhancer

A request read by a subagent or the advisor has no context but its words. This pass makes
those words accurate and easy to read before anyone acts on them. It changes wording and
structure only, never what is asked.

## Where it runs

| Caller | Input | The enhanced text goes to |
|---|---|---|
| Router, Step 1, on the match path only (the first request, or after `new task`) | the user's request | the analysis brief's slice fields and the advisor |
| `skills/coordinate/SKILL.md`, writing a brief | the brief's slice fields | the same slice fields |
| `skills/advisor/SKILL.md`, before a checkpoint | the checkpoint question, or the fallback dossier | the consultation |
| `skills/review-pr/SKILL.md` | the operator's review request | its own brief |

Step 2 matching and every Laya fork (`playbook-selection`, `tier-selection`) read the
**original** request. Laya's deterministic policy matches request wording, and its labelled
scenarios are raw requests, so reworded text would flip forks that were measured on the
original. A brief's static role header is never rewritten: it is the cached prefix
(`skills/guard-the-context-window/SKILL.md`). Mid-run inputs that Step 0 handles, monitor
wakes, and corrections skip the pass.

## The pass

1. Split the input into the parts of the request shape in `commands/vistack.md`: what was
   observed, what is wanted, `Done means`, `Keep`, scope (files, surfaces, repositories),
   permissions, and references (links, tickets, files, error text).
2. Rewrite each part for a reader with no context. One claim per sentence, exact names and
   paths, error text quoted character for character. Apply `skills/unslop/SKILL.md`.
3. Mark every part the input does not state as `missing: <part>`. Mark anything derived
   rather than stated as `inferred: <text> (from <source>)`.
4. Return the original verbatim, the enhanced text, and the missing and inferred lists:

```text
Original: <the input, verbatim>
Want: <...>            Observed: <... | missing>
Done means: <... | missing>
Keep: <... | missing>
Scope: <...>           Permissions: <... | missing>
References: <...>
Missing: <parts>       Inferred: <text (from source)>
```

## Never

- **Fill a missing `Done means`.** Router Step 3 owns it: no derivable predicate is FENCE 2.
  A filled-in predicate would start an unattended run on criteria nobody stated.
- **Widen or narrow scope, add a requirement, or invent an acceptance criterion.** Intake
  preserves the user's scope and finish language, and so does this pass.
- **Drop a detail.** Every evidence path, error string, URL, number, and name in a brief or
  dossier survives the rewrite; a dropped one is a blind spot for the reader.
- **Resolve an ambiguity.** An inferred part that changes acceptance criteria or a public
  contract is FENCE 2 with both readings, not an inference.
- **Publish it.** The enhanced text is internal; external text follows the External naming
  boundary in `skills/vistack/principles/index.md`.

## Record

Keep the original beside the enhanced text everywhere the enhanced text goes. A run with a
state file records both at Setup (`skills/coordinate/SKILL.md`), and its ledger gets one
`prompt-enhanced` row per pass, with `evidence` naming where both are kept
(`docs/guide/ledger-format.md`). On Codex the advisor checkpoint is skipped, and the pass
before it is skipped with it in the same `step-skipped` row.
