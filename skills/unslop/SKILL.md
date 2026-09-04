---
name: unslop
description: "Remove generic AI phrasing from agent-facing and project-facing writing. Use before finalizing skills, playbooks, docs, tickets, PR text, comments, or reports."
---

# unslop

Make the writing concrete, direct, and specific to the project.

## Process

1. Scan for generic claims, vague attribution, filler, excessive hedging, decorative
   structure, and language that could fit any project.
2. Rewrite without changing the decision, requirement, or evidence.
3. Replace feelings with mechanisms, numbers, file paths, commands, or observable results.
4. Read the result as a new maintainer. Remove any sentence that does not tell them what to
   know or do.

## Rules

- Prefer short declarative sentences and active voice.
- Use sentence-case headings.
- Avoid em dashes, en dashes used as punctuation, curly quotes, decorative emojis, and
  mid-sentence colons.
- Do not use puffery, promotional language, vague attributions, or generic conclusions.
- Remove filler such as "in order to", "it is important to note", and "I hope this helps".
- Do not cycle synonyms for variety. Repeat the precise term.
- Do not force a rule of three or a false range.
- Replace "should work" with a check or label it as a hypothesis with the check that would
  settle it.
- Keep bold text for real labels. Do not turn every noun into emphasis.
- Use the project's actual names. A sentence that could appear unchanged in another project
  is probably too vague.

## Exit criteria

The text states concrete instructions, facts, decisions, and evidence in plain language.
Every remaining qualifier names what is unknown and how it can be checked.
