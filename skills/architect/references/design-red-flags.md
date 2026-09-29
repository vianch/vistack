# Design red flags

Screen every candidate before synthesis. A red flag is a reason to revise or reject the
shape, not a note to carry into implementation.

## Shallow module

A large interface hiding little. Judge depth as the capability and policy behind the public
surface relative to the size of that surface. Prefer a small interface backed by substantial
behavior.

A deep module is not a deep call chain. A deep call chain scatters understanding across
layers; a deep module concentrates it behind one interface.

Signs:

- Callers coordinate several methods to finish one operation.
- Public options expose internal stages or implementation choices.
- Learning the interface does not spare the caller from learning the implementation.

## Information leakage

Several modules depend on the same internal decision. A representation, policy, or protocol
detail appears in more than one place, so changing it takes coordinated edits.

Re-exporting transport or wire types is leakage. Parse external data into domain types behind
the interface. Keep storage schemas, framework objects, and protocol details private.

## Temporal decomposition

Modules organized by execution order instead of by the knowledge they own. Separate load,
validate, transform, and save stages often repeat one representation and its invariants at
every boundary.

Group code around what it knows and owns. Methods that run at different times still belong
together when they protect the same decisions.

## Pass-through method

A method that forwards the same arguments to another method of the same shape. It adds a
layer and hides nothing.

Remove it, or move the responsibility to the module that can complete the operation. Keep a
forwarding boundary only when it adds policy, adaptation, or a distinct abstraction.
