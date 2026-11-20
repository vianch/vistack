# Writing the docs tier

Docs come last on the ladder because nothing fails when an agent skips them. When a class
ends here, write the text so the next agent takes the same path on the first read. For
contracts in this repo, `docs/guide/writing-contracts.md` also applies.

- **One home per meaning.** Write each rule in one file and point at it from every other
  file in one line. Two copies drift, and the agent follows whichever it read last.
- **Pointers over copies.** Sharpen a pointer's wording before inlining its target. Inline
  what every branch of a task needs; point to what only some branches reach.
- **Trigger word first.** A description opens with the words the operator types, then what
  the skill does, with one trigger per branch.
- **State the wanted behavior.** A negation names the behavior it forbids. Keep
  prohibitions for hard guardrails: the four fences, the merge boundary, the realm rule, and
  credentials.
- **Delete no-ops, judged by running the document.** Run a real past case with the line and
  without it. A line the model follows anyway, or one that changes no decision, goes.
- **A doc that restates the environment is a cache.** Scripts, configuration, and `--help`
  output are the truth; point at them instead of copying flags that change.
- **End every step on a checkable criterion** that covers every case. Split a step only
  across a real context boundary, such as a hand-off or a subagent.
- **Co-locate a concept's definition, rules, and caveats.** Sprawl is a defect even when
  each line is useful.
