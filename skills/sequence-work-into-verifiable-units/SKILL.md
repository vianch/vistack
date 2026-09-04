---
name: sequence-work-into-verifiable-units
description: "Order work so that each unit ends in something checkable, and size units so they can be verified independently. Use when decomposing a ticket, ordering slices, or deciding whether a step is finishable."
---

# sequence-work-into-verifiable-units

A unit of work ends in a check that passes or fails. If it does not, it is not a unit — it
is a fragment of one.

## The rule

- Every slice ends in a state someone can verify without the next slice existing: tests
  green, a screen rendering, an endpoint answering, a file gone.
- Order slices so verification is possible at each step, not only at the end. A slice that
  can only be checked after three more slices land is mis-sequenced.
- Each slice is independently mergeable. If reverting slice 2 breaks slice 3, they are one
  slice.
- Prefer the boring order: delete first, then add the new thing, then move call sites onto
  it, then remove the old thing.

## What it changes

It changes slice boundaries. "Add the primitive and swap all 14 call sites" is one
unverifiable lump; "add the primitive with stories" then "swap call sites in
`account/`" then "swap call sites in `events/`" is three checkable ones — and the second
and third can run in parallel because they touch disjoint directories.

It also decides what does *not* get sliced. Splitting a 40-line change into two PRs adds
two review cycles and verifies nothing new.

## The failure it prevents

A run that reports 90% complete and cannot demonstrate anything. Every piece is written,
nothing is provable, and the remaining 10% turns out to hold every unresolved question.
