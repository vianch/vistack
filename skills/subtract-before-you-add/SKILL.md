---
name: subtract-before-you-add
description: "Look for the deletion before writing new code — dead code, a duplicate abstraction, a slice that turns out to be unnecessary. Use when starting a slice, planning a decomposition, or reviewing a diff that only grows."
---

# subtract-before-you-add

The first question about a change is what it removes.

## The rule

- Before adding an abstraction, check whether one already exists. Reuse beats a second
  version of the same idea.
- Before porting something, check whether it has callers. Unused code is deleted, not
  migrated.
- Prefer removing the condition to handling it. Prefer removing the special case to
  documenting it.
- A slice whose only content is new lines deserves one more look. Sometimes correct —
  often a rename that could have been a delete.

## What it changes

It changes the slice list. Finding `DetailRow` has zero call sites turns a port into a
deletion and removes a slice from the plan. It changes a diff from "add wrapper, keep old
component, mark deprecated" into "swap call sites, delete old component" — smaller, and it
leaves nothing for the next person to have to decide about.

It changes what `pruning-comments` is for: the comment pass is a subtraction pass, and it
runs on every diff before the PR opens.

## The failure it prevents

Codebase growth with no behaviour to show for it. Two components that do the same thing,
each with call sites, and a third one next quarter because neither was obviously the right
one to use.
