---
name: understanding
description: "'how does X work', 'why is X like this', 'teach me X', 'what did we decide about', '/how', '/why', '/teach', '/recall'. Answers in the thread from evidence: how traces the code, why digs up the history, teach builds understanding step by step, recall searches past sessions. Read-only; a question needing a run and a recommendation is the investigation playbook."
argument-hint: "how|why|teach|recall <question>"
---

# understanding

Four ways to understand a codebase, one contract. Each answers in the thread, from evidence,
and changes nothing.

| Mode | Answers | Method |
|---|---|---|
| `how` | How does this work? What happens when…? | `skills/understanding/references/how.md` |
| `why` | Why is it like this? Who decided, and what for? | `skills/understanding/references/why.md` |
| `teach` | Help me learn this so I can explain or change it myself. | `skills/understanding/references/teach.md` |
| `recall` | What did we decide, try, or do about this before? | `skills/understanding/references/recall.md` |

## Choose the mode

Use the first word when it names a mode. Otherwise infer it: a mechanism question is `how`, a
rationale or history question is `why`, a request to learn or be quizzed is `teach`, and a
question about past sessions ("last time", "did we", "what did we decide") is `recall`. A
question that spans two runs both in order, such as `how` then `why`. Read only the reference
for the mode you run.

## Rules for every mode

- **Answer first.** One paragraph that answers the question, then the evidence. Size the
  answer to the question and offer depth instead of dumping it.
- **Evidence or "unknown".** Every claim cites a `file:line`, a commit, a PR, a doc path, or a
  dated session. When the record is silent, say so and name the check that would settle it.
  A guess about intent written as fact is the failure this skill exists to prevent.
- **Read narrowly.** Search first (`rg`, `git grep`, LSP), then read only the ranges that
  matter. On Claude Code, hand a trace across many files to an `analyst` agent and library
  documentation to a `researcher` agent, and keep their conclusions, not their reads
  (`skills/guard-the-context-window/SKILL.md`). Other hosts read in the thread, narrowly.
- **Read-only.** No edits, commits, branches, or posts. When the answer turns into a change,
  say what the change would be and stop.
- **Code beats docs.** When a doc, comment, or past session disagrees with the code at HEAD,
  the code is what runs; report the disagreement.
- **A page only when it helps.** Render a diagram or explainer through
  `skills/html-report/SKILL.md` when the user asks, or the answer passes that skill's page
  test.

## Boundaries

- The `investigation` playbook (`skills/vistack/playbooks/investigation.md`) is a dispatched
  run with state, several angles, and a recommendation. When a question grows into that,
  say so and suggest `/vistack:vistack` with the question.
- Inside an open viStack run, answer, then return to the open playbook (router, Step 0).
- Text that leaves the thread follows the External naming boundary in
  `skills/vistack/principles/index.md`.

## Hosts

The skill is the same on Claude Code (`/vistack:understanding how …`), Codex
(`$vistack:understanding how …`), Grok Build, and OpenCode (`docs/guide/grok-opencode.md`).
`recall` runs `scripts/recall.mjs` from this skill's folder, on Claude Code
`${CLAUDE_PLUGIN_ROOT}/skills/understanding/scripts/recall.mjs`, with the project as the
working directory. Its host support is in `skills/understanding/references/recall.md`.
