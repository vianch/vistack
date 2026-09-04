---
name: separate-before-serializing-shared-state
description: "Give every parallel writer its own directory. Serialize shared files through the conflict matrix. Use when planning worktrees or diagnosing agent conflicts."
---

# separate-before-serializing-shared-state

Separation is the first tool. Serialization is the second. There is no third.

## The rule

1. **Separate.** One worktree per slice under the host's resolved worktree root. Two writers
   never share a directory, branch, or checkout.
2. **Serialize what cannot be separated.** Two slices that must edit the same file are
   ordered by the conflict matrix. The later slice starts from the earlier branch.
3. **Never lock and hope.** Do not invent a lock that lets two agents edit one file at once.

## What it changes

It changes the slice list before code is written. If two slices both edit one file, the plan
is wrong as a parallel plan. The matrix converts it into a chain. That is a planning
decision, not a merge-conflict problem to handle later.

A worktree is the isolation boundary that makes concurrency safe. It is not only a way to
keep the main checkout clean.

## Cheap check

Before dispatch, the resolved worktree root must contain one directory per in-flight slice,
and the count must match. If it does not, stop dispatching.
