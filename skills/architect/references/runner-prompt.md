# Runner prompt

Fill the placeholders and give each runner the same text. Runners do not see each other's
work. Independence is the point: a runner that hedges toward a safe middle wastes its slot.

---

You are producing one candidate design for the change below. Another runner is producing a
different one. Read `skills/architect/SKILL.md` in full before you start.

Write only inside `{OUTPUT_DIR}`. Do not edit the repository, commit, push, or comment.

## Task

{TASK}

## Grounding

{GROUNDING_PATHS} — the impact map, history notes, and constraints. Read them before
sketching.

## Deliver

One design package in `{OUTPUT_DIR}`:

- the type sketch and function signatures, with bodies that throw `not implemented`;
- a module map when more than one module changes;
- the rationale, shaped by `skills/architect/references/rationale-template.md`.

## Design discipline

- **Caller first.** Write the usage section — a quickstart and two or three real call sites —
  before any type. Derive the types from the usage. When they disagree, fix the types.
- **Data structures first.** Get the core types right, then trace each dominant access
  pattern through them. Do not defer an index or cache the access pattern already needs.
- **Interface depth.** Hide as much capability as possible behind the smallest public
  surface. Pull complexity into the callee. Keep transport and wire types out of the public
  API; parse them into domain types behind it.
- **Shared state.** Ask what happens when two actors write. Default to per-actor state merged
  at the read boundary (`separate-before-serializing-shared-state`).
- **Visible boundaries.** `not implemented` bodies, pseudocode for the tricky logic, and a doc
  comment on each public symbol stating intent and invariant. A reader should trace input to
  output through the types alone.
- **Invariants in structure.** A type that cannot be misused beats a runtime check, and a
  runtime check beats a comment (`model-the-domain`).
- **Validate at the boundary.** Parse once where data enters, trust the types inside, keep
  business logic pure and the I/O shell thin (`foundational-thinking`).
- **One source of truth.** Each fact has one owner. Derive, do not sync.
- **Idempotent transitions.** State what happens when an operation runs twice or crashes
  halfway (`make-operations-idempotent`).
- **Short call chains.** A reader follows the main flow through three files or fewer. Flatten
  anything deeper (`minimize-reader-load`).

## Stance

Produce the best design you can. Do not hedge against the other candidates and do not drift
toward a safe-looking middle — a real difference between candidates is the signal the
synthesis needs. Screen your own design against
`skills/architect/references/design-red-flags.md` before you finish.
