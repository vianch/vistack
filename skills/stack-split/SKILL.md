---
name: stack-split
description: "Split a diff over 500 changed lines into a parent-to-child chain of PRs, each one concern and independently reviewable, built with stacking-prs. Use when a branch's diff exceeds 500 lines or carries more than one concern."
---

# stack-split

Over 500 lines, or more than one concern, a branch becomes a chain. This skill owns the
split; `stacking-prs` owns the `gh stack` mechanics.

## When it triggers

- The diff against the base branch exceeds **500 changed lines**, excluding lockfiles and
  generated files, or
- the diff carries more than one concern, at any size.

Measure it, do not estimate it:

```bash
git diff --stat "$BASE_BRANCH"...HEAD -- . \
  ':(exclude)*lock*' ':(exclude)*.lock' ':(exclude)**/generated/**'
```

## How to cut

**Split by concern first, size second.** A 900-line diff that is one concern still splits —
but along a seam a reviewer would recognize, not at line 450.

Seams that cut cleanly, in preference order:

1. **Tests and stories** away from the change they cover. The test layer reviews on its own
   and lands first.
2. **Mechanical from meaningful.** A 40-file rename reviews in a minute; the 60-line
   behaviour change next to it needs an hour. Together they get the rename's attention.
3. **New thing** from **call-site migration** from **removal of the old thing**. Three PRs,
   each with a clear question.
4. **By directory**, where call sites cluster and the clusters are disjoint.

Seams that do not work: cutting mid-feature so no link compiles, and cutting by commit
because the commits happen to be there.

## Chain rules

- **Parent→child.** Each link's base is its parent's branch, and each link **compiles and
  passes tests on its own**. A link that only builds once its child lands is mis-cut.
- Each link is **≤500 lines** and **one concern**.
- Every link opens as a **draft**, linked to the issue.
- Each body states its position in the chain, with links to parent and children.
- Reviewer team on every link (`requesting-reviewers`) — a child with no
  reviewer has no path to merge.
- **Never mark a child ready before its parent**, and never merge any of it. Merging is
  FENCE 3.

## Steps

1. Measure the diff, excluding lockfiles and generated files. Record the number.
2. Count the concerns and name each one.
3. Choose the seams and lay out the chain, parent first.
4. Verify each link independently: it compiles, lint passes, tests pass.
5. Build the chain with `stacking-prs`.
6. Open each link with `create-pr` — draft, correct base, issue linked.
7. Assign reviewers on every link.
8. Record every PR link in the state file and the `Engineering work — agent sessions` comment.
