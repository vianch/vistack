# Playbook: pr-stack

**Match when** a branch is done and the diff needs to become one PR, or a chain of them.

## Steps

1. Measure the diff: `git diff --stat` against the base branch, excluding lockfiles and
   generated files. Record the number.
2. Count the concerns. One reason for the change is one PR, regardless of the line count.
3. ≤500 lines and one concern → one PR. Go to step 6.
4. Over 500 lines, or more than one concern → `stack-split`. Split by concern first, then by
   size; tests and stories separate cleanly from the change they cover.
5. Order the chain parent→child so each link is independently reviewable and each compiles
   on its own. Build it with `stacking-prs`.
6. Pass every diff through `pruning-comments` before opening anything.
7. `pr-author` opens each PR via `create-pr` — draft, authored by the configured project user,
   linked to the issue, base set to the parent for a child link.
8. Assign the reviewer team with `requesting-reviewers`. A PR with no
   reviewer team has no path to merge and is not done.
9. Each PR body carries: the one concern, the verification evidence, and for a stack, its
   position in the chain with links to the parent and children.
10. Check CI on each PR with `the project CI checks`. A red build is a blocker
    for that link — run `blocker` on it.
11. Clear bot comments with `address-ai-reviews`.
12. Record every PR link in the state file and in the `Engineering work — agent sessions` comment.
13. Stop at merge-ready. Leave every PR as a draft. Never merge, and never mark a child
    ready before its parent.
