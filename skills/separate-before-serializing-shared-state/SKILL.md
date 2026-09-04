---
name: separate-before-serializing-shared-state
description: "Give every parallel writer its own directory; where writers must touch the same file, run them in sequence rather than concurrently. Use when planning parallel work, allocating worktrees, or diagnosing a conflict between two agents."
---

# separate-before-serializing-shared-state

Separation is the first tool. Serialization is the second. There is no third.

## The rule

1. **Separate.** One worktree per slice, at `.claude/worktrees/<slug>`. Two writers never
   share a directory, a branch, or a checkout — not "usually", not "if they are careful".
2. **Serialize what cannot be separated.** Two slices that must edit the same file are
   ordered by the conflict matrix and run one after the other. The second starts from the
   first's branch.
3. **Never lock and hope.** There is no mechanism here for two agents to coordinate edits
   to one file while both are running. Do not invent one.

## What it changes

It changes the slice list, before any code is written. If `slice-plan` produces two slices
that both edit `theme.scss`, the plan is wrong as a *parallel* plan — the matrix converts
it into a chain. That is a planning decision, not a merge-conflict problem to be handled
later.

It also changes what a worktree is for. A worktree is not a convenience for keeping your
main checkout clean. It is the isolation boundary that makes concurrency safe at all.

## The failure it prevents

Two agents, one checkout. Agent A writes a file, agent B's editor writes the version it
read before A's write, and A's change is gone with no conflict marker, no failed test, and
no line in any diff to point at. Nothing detects it. The run finishes green and ships less
than it claims to.

## Cheap check

Before dispatch, `.claude/worktrees/` must contain one directory per in-flight slice, and
the count of in-flight slices must equal the number of distinct directories. If it does
not, stop dispatching.
