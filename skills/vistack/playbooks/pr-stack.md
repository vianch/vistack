# Playbook: pr-stack

**Match when a finished branch needs one PR or a parent-to-child chain.** This playbook stops
at draft PRs.

## Steps

1. Measure the diff against the base branch. Exclude lockfiles and generated files. Record
   the changed-line count.
2. Count concerns. One reason for the change is one PR.
3. If the diff is at most 500 lines and has one concern, keep one PR. Otherwise run
   `stack-split` and split by concern before size.
4. Order the chain so every link compiles, passes its checks, and is independently reviewable.
5. Pass every diff through comment cleanup before opening it.
6. Open each PR through the project PR skill as a draft, with the correct base and issue link.
7. Assign reviewers on every link. A PR without a reviewer path is incomplete.
8. Put the concern, acceptance checks, evidence, and chain position in each body.
9. Run the project CI checks. A red result returns to the owning slice or `blocker`.
10. Clear review automation comments through the project skill.
11. Record each PR, head SHA, and phase in the state file, ledger, and session record.
12. Stop at merge-ready. Never merge or mark a child ready before its parent.
