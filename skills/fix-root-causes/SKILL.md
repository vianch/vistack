---
name: fix-root-causes
description: "Treat the cause rather than the symptom, and record a workaround as an explicit decision when one is unavoidable. Use when a fix suppresses an error, widens a type, retries, or special-cases an input."
---

# fix-root-causes

Find why it happens. Then fix that.

## The rule

- State the cause before writing the fix. One sentence, with `file:line`. If you cannot
  write that sentence, you do not have the cause yet.
- These are symptom treatments, and each needs a stated reason to exist: a `try`/`catch`
  that swallows, a widened or `any` type, a retry around a deterministic failure, a
  special case for the input that reproduced the bug, a `?.` added to stop a crash.
- A workaround is sometimes correct — under a deadline, behind an upstream bug, ahead of a
  migration. When it is, it is a **decision**: it goes in the ledger with its reason and it
  goes in the PR body.
- Never loosen a type, skip a test, or force-push to get past a failure. See `unblock`.

## What it changes

It changes the diff. A crash on `user.profile.name` is not fixed by `user.profile?.name`;
that hides which of the two callers passes a profile-less user. The fix is in the caller,
and the type stops lying.

It also changes what the blocker loop counts as progress. An attempt that makes the error
message go away without explaining it is not an attempt — it is a new, quieter bug.

## The failure it prevents

A bug that reappears in a different shape three sprints later, with the original evidence
gone and a defensive `?.` in the way of finding it again.
