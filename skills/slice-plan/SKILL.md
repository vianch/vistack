---
name: slice-plan
description: "Decompose a ticket into slices of 500 lines or fewer that are each independently mergeable, assign file-level ownership per slice, and produce the conflict matrix that decides what runs in parallel. Use when planning work before dispatch, or when two agents turn out to be touching the same file."
---

# slice-plan

Turn one ticket into slices that can be built, reviewed, and merged separately — and decide
which of them may run at the same time.

Two outputs, both required: **the slice list** and **the conflict matrix**. A dispatch
without a matrix is a dispatch that will corrupt a file.

## Slicing rules

- **≤500 changed lines** each, excluding lockfiles and generated files.
- **Independently mergeable.** Reverting slice 2 must not break slice 3. If it does, they
  are one slice.
- **Independently verifiable.** Each ends in a check that passes without the next slice
  existing (`sequence-work-into-verifiable-units`).
- **One concern each.** The slice boundary is a reason for the change, not a line count.
- **File-level ownership.** Every slice lists the files it will create, modify, and delete.
  A file with no owning slice does not get touched; a file with two owners is a conflict.
- **Delete first.** Check for unused code before planning a port
  (`subtract-before-you-add`).
- **Do not over-slice.** A 40-line change split in two adds two review cycles and proves
  nothing new.

## The usual order

1. Characterization tests for uncovered paths that are about to change.
2. Deletions of anything unused.
3. The new thing, with its tests or stories.
4. Call-site migrations, grouped by directory so groups are disjoint.
5. Removal of the old thing.

Steps 4's groups are where the parallelism actually is: distinct directories, no shared
files, same shape of work.

## The conflict matrix

For every pair of slices, the files they both touch:

| | A primitive | B swap-account | C swap-events | D delete-old |
|---|---|---|---|---|
| **A primitive** | — | `index.ts` | `index.ts` | — |
| **B swap-account** | `index.ts` | — | — | — |
| **C swap-events** | `index.ts` | — | — | `Loader.tsx` |
| **D delete-old** | — | — | `Loader.tsx` | — |

Read it as a schedule:

- **Empty cell → the pair may run concurrently**, each in its own worktree.
- **Non-empty cell → serialize the pair.** The later slice starts from the earlier one's
  branch, after that PR opens. They never run at the same time.

From the matrix above: A runs first. B and C run concurrently once A's PR is open — they
share nothing with each other. D waits for C.

If the matrix comes out dense — most cells populated — the slicing is wrong, not the
schedule. Re-cut along file boundaries instead of feature boundaries and try again.

## Output shape

```
Slice: <name>
  Concern:    <the one reason for this change>
  Files:      + created / ~ modified / - deleted
  Est. lines: <n>
  Check:      <the command or screen that verifies it>
  Depends on: <slices that must open their PR first, or none>
  Agent:      implementer | design-implementer
```

Then the matrix, then the schedule as an ordered list of waves.

## Hand-off

The slice list and matrix go into `.claude/state/<slug>.json` before any worktree is
created. `coordinate` dispatches from them and re-reads the matrix on every wave.
