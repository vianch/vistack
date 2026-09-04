---
name: one-concern-per-pr
description: "One PR answers one question a reviewer can hold in their head, at 500 changed lines or fewer. Use when opening a PR, sizing a slice, or deciding whether to stack."
---

# one-concern-per-pr

A PR is a question put to a reviewer. One question per PR.

## The rule

- **One concern.** Not one file, not one commit — one reason for the change. "Add the
  primitive" and "swap the call sites" are two concerns even when they are 40 lines
  together and the same person writes both.
- **≤500 changed lines**, excluding lockfiles and generated files. Over that, `stack-split`
  turns it into a parent→child chain via `stacking-prs`.
- **Draft on open**, always. Ready-for-review is a separate, evidenced decision.
- A drive-by fix noticed while implementing goes in its own slice, or in the ticket. Not in
  this diff.

## What it changes

It changes when a PR opens: the moment a slice is done, not when the batch is done. A
finished slice waiting for its siblings is a slice whose review has not started and whose
conflicts are growing.

It changes the size question from a style preference into a routing decision — over 500
lines, control passes to `stack-split` rather than to a judgement call about whether this
particular diff is "actually fine".

## The failure it prevents

The 1,900-line two-concern PR that passes every automated check, sits for four days, gets
approved on the strength of the description, and hides a behaviour change in the middle of
a rename.
