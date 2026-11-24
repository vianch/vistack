# Glossary format

A glossary says what the project's words mean, so one concept has one name. It is a glossary
and nothing else: no implementation detail, spec, scratch notes, decisions, or open questions.
A repository's existing glossary keeps its own format; this one fills only what that format
leaves open.

## Structure

```md
# {Context name}

{One or two sentences: what this context is and why it exists.}

## Language

**Order**:
{One or two sentences on what an Order is.}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Be opinionated.** When several words name one concept, pick one and list the rest under
  `_Avoid_`; a glossary that accepts every synonym settles nothing. Pick by evidence: the name
  the domain model uses in its types and schema, and when those disagree, the name used most
  across code and copy.
- **Keep definitions tight.** One or two sentences that say what the term is, not what it
  does.
- **Only this project's terms.** General programming concepts (timeouts, error types, utility
  patterns) stay out even when the code uses them everywhere. Before adding a term, ask
  whether the concept belongs to this domain or to programming in general; only the first
  goes in.
- **Group under subheadings** when natural clusters appear. One cohesive area stays a flat
  list.

## Several contexts

`GLOSSARY-MAP.md` at the root lists each context, where its glossary lives, and how the
contexts relate:

```md
# Glossary map

## Contexts

- [Ordering](./src/ordering/GLOSSARY.md): receives and tracks customer orders
- [Billing](./src/billing/GLOSSARY.md): generates invoices and processes payments
- [Fulfillment](./src/fulfillment/GLOSSARY.md): manages warehouse picking and shipping

## Relationships

- **Ordering -> Fulfillment**: Ordering emits `OrderPlaced`; Fulfillment consumes it to start picking
- **Fulfillment -> Billing**: Fulfillment emits `ShipmentDispatched`; Billing consumes it to issue the invoice
- **Ordering <-> Billing**: shared types for `CustomerId` and `Money`
```

Infer which context a term belongs to and ask when it is unclear. Splitting one glossary into
contexts is the user's decision: with nobody to answer, keep one glossary and list the term that
means two things as an open question.

Adapted from skills/engineering/domain-modeling/GLOSSARY-FORMAT.md in mattpocock/skills (MIT License, Copyright (c) 2026 Matt Pocock).
