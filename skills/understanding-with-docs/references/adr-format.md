# ADR format

An ADR records that a decision was made and why, so the next engineer does not undo something
deliberate. A repository's existing ADRs keep their own directory and template; this format
fills only what they leave open.

## Where and how numbered

ADRs live in the directory the detection order in
`skills/understanding-with-docs/references/glossary-check.md` finds, numbered in sequence:
scan it for the highest number and add one.

```
docs/adr/0001-event-sourced-orders.md
docs/adr/0002-postgres-for-write-model.md
```

## Template

```md
# {Short title of the decision}

{One to three sentences: the context, what was decided, and why.}
```

That is the whole template. An ADR can be one paragraph; its value is the record that a
decision was made and why, not filled-in sections.

## Optional sections

Add one only when it says something the paragraph cannot:

- **Status** frontmatter, one of `proposed`, `accepted`, `deprecated`, or
  `superseded by ADR-NNNN`, when the decision is likely to be revisited.
- **Considered options**, when the rejected alternatives are worth remembering.
- **Consequences**, when a downstream effect is not obvious.

## When to offer one

All three must hold:

1. **Hard to reverse.** Undoing it later takes a data migration, a rewrite across modules,
   or a change other teams must make.
2. **Surprising without context.** A future reader of the code will wonder why it was done
   this way.
3. **The result of a real trade-off.** At least two workable options existed, and one was
   picked for a reason someone can state.

### What qualifies

- **Architectural shape.** "We use a monorepo." "The write model is event-sourced; the read
  model is projected into Postgres."
- **Integration patterns between contexts.** "Ordering and Billing talk through domain
  events, not synchronous HTTP."
- **Technology choices that carry lock-in.** The database, message bus, auth provider, or
  deployment target; a library only when swapping it would take a quarter.
- **Boundary and scope decisions.** "The Customer context owns customer data; other contexts
  reference it by ID." An explicit no is worth as much as a yes.
- **Deliberate deviations from the obvious path.** "Manual SQL instead of an ORM, because X."
  These stop the next engineer from fixing something that was deliberate.
- **Constraints the code does not show.** "No AWS, for compliance." "Responses under 200 ms,
  because of the partner API contract."
- **Rejected alternatives whose rejection is not obvious.** GraphQL considered and REST picked
  for a subtle reason gets recorded, or someone proposes GraphQL again in six months.

Adapted from skills/engineering/domain-modeling/ADR-FORMAT.md in mattpocock/skills (MIT License, Copyright (c) 2026 Matt Pocock).
