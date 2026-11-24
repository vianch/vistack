---
name: understanding-with-docs
description: "'build the glossary', 'update the glossary', 'document the vocabulary', 'record an ADR', 'grill me with docs', '/understanding-with-docs'. Learns a repository's domain language and writes it down as a glossary and ADRs: grill interviews the user about a plan and records each term as it settles; glossary builds or refreshes the glossary from the code; adr records one decision the user states. User-invoked; the read-only interview is understanding grill."
disable-model-invocation: true
argument-hint: "grill <plan> | glossary [context] | adr <decision>"
---

# understanding-with-docs

Learns the project's domain language and writes it down, so people and agents call one
concept by one name. It writes glossary and ADR files and nothing else.

## What it writes and where

Run the glossary check first (`skills/understanding-with-docs/references/glossary-check.md`).
A repository that already keeps a glossary or ADRs, under any name, keeps its own files and
format, and no second glossary is created. Otherwise a single context gets one root
GLOSSARY.md and several contexts get a GLOSSARY-MAP.md
(`skills/understanding-with-docs/references/glossary-format.md`); ADRs follow
`skills/understanding-with-docs/references/adr-format.md`. Create a file only when it has
content: the glossary when the first term settles, the ADR directory with the first ADR.
Glossary and ADR files are project text, so the External naming boundary in
`skills/vistack/principles/index.md` applies to every line.

## Modes

Nobody to answer has the meaning in `skills/never-block-on-the-human/SKILL.md`, Nobody to
answer.

| Mode | Does | With nobody to answer |
|---|---|---|
| `grill <plan>` | Interviews the user about the plan following `skills/understanding/references/grill.md`, with the session moves below. | Returns the first round for later and writes nothing (`grill.md`). |
| `glossary [context]` | Runs the check, then builds the glossary when none exists or refreshes the one that does, from the code. `context` limits a `multi` layout to one context. | Writes only the terms the code settles. |
| `adr <decision>` | Writes one ADR for the decision the user states, in the format of `adr-format.md`, in the directory the check found. Stating a decision and asking for its record is the trade-off owner's confirmation; when one of the three tests fails, it says which and writes the ADR anyway, because the user asked. | Writes it: the request is the confirmation. |

## Session moves

In `grill` and `glossary`, unless there is nobody to answer:

- **Challenge against the glossary.** A term used against its definition is called out at
  once: "The glossary defines cancellation as X, but you seem to mean Y. Which is it?"
- **Sharpen fuzzy language.** A vague or overloaded word gets a precise canonical term
  proposed: "By account, do you mean the Customer or the User? Those are different things."
- **Test with concrete scenarios.** Invent edge cases that force a boundary between two
  concepts: what happens to the Invoice when half the Order is cancelled?
- **Cross-reference with code.** When the user states how something works, check the code
  and surface a contradiction with its `file:line`: "The code cancels whole Orders, but you
  said partial cancellation exists. Which is right?"
- **Write each term the moment it settles.** A session that ends early keeps every term
  settled so far; a batch at the end loses them.
- **Offer an ADR sparingly**, only when the three tests in `adr-format.md` all hold.

## The glossary mode

1. Run the check. Layout `none` builds; any other layout refreshes the files it found.
2. Survey candidate terms with `file:line` evidence from domain types and models, schemas and
   tables, routes and events, UI copy and locale files, and issues and the README. On Claude
   Code an `analyst` lane runs the survey and returns the candidates
   (`skills/guard-the-context-window/SKILL.md`); other hosts read narrowly in the thread.
3. Drop general programming concepts (`glossary-format.md`, Rules).
4. One concept with several names: when the meaning is not in doubt, pick one name by the
   evidence order in `glossary-format.md` (Be opinionated), list the other names under
   `_Avoid_`, keep an old name there after a rename, and name each choice in the report so a
   person can flip it. Refresh changes or removes an existing entry only when the code
   contradicts it, because the entry may record a decision or a business term the code does
   not show.
5. A word whose meaning is in doubt, such as one word for two concepts (the two senses of
   cancel) or no definition the code supports, goes to the user through the session moves.
   With nobody to answer, write only the terms the code settles (one concept, a definition
   the code supports, a citation, the name from step 4) and list the rest as open questions
   in the report. Never invent a definition, and never put an open question in the glossary.
6. Report in this shape. Citations live here, not in the glossary, which carries no
   implementation detail.

```
Layout: <single, multi, or none>; files: <found, or none>; ADR directory: <path, or none>
Glossary: <file>, <n> added, <n> changed, <n> removed
Added: <term>: <evidence file:line>
Chose: <canonical name> over <other names>: <evidence file:line>
Changed: <term>: <before> -> <after>: <evidence file:line>
Open: <term>: <reading A> or <reading B>: <evidence file:line>
ADR proposed: <title>, or none
```

## Who writes

- **Standalone**, when the user invoked the skill and no run is open, the session that runs
  the skill edits the glossary and ADR files inline; they are documents, not product code. It
  makes no commit, branch, or post; the user reviews the diff.
- **Inside a run**, the slice that owns the glossary files writes them. A user who invokes the
  skill while a run is open still gets the interview in the thread, and its settled terms and
  any ADR follow `glossary-check.md`, In a run.

## Boundaries

- `understanding` (`skills/understanding/SKILL.md`) answers and interviews read-only; its
  `grill` is this skill's `grill` without the writing.
- The `investigation` playbook (`skills/vistack/playbooks/investigation.md`) is a dispatched
  run that ends in a recommendation; this skill ends in documents.

## Hosts

Claude Code runs `/vistack:understanding-with-docs glossary` or
`/vistack:understanding-with-docs grill <plan>`, Codex `$vistack:understanding-with-docs`, and
Grok Build and OpenCode load the skill folder (`docs/guide/grok-opencode.md`). The model never
starts it on its own: the user invokes it, or router Step 0 runs it by path when the user asks
for it in other words.

Adapted from skills/engineering/grill-with-docs/SKILL.md and skills/engineering/domain-modeling/SKILL.md in mattpocock/skills (MIT License, Copyright (c) 2026 Matt Pocock).
