# Playbook: feature

**Match when** new behaviour is wanted behind a specified acceptance criterion.

## Steps

1. Read the ticket's acceptance criteria. Restate each one as a check with a subject and a
   verb. An AC that cannot be restated that way is FENCE 2.
2. State the finish condition and the behaviour that must not change.
3. Dispatch `analyst` for the impact map: where the new behaviour attaches, existing
   patterns to follow, and the coverage of the paths that will change.
4. Dispatch `planner`: slices ≤500 lines, each independently mergeable, file-level ownership
   per slice, plus the conflict matrix (`slice-plan`).
5. Serialize any slices that share a file. Parallelize the rest. Write the plan into
   `.claude/state/<slug>.json`.
6. For each parallel slice, create the worktree at `.claude/worktrees/<slug>` and dispatch
   one `implementer`. One slice, one worktree, one agent.
7. Each `implementer` writes the test first where a test is the check, then the code, then
   runs lint and tests, then passes its diff through
   `pruning-comments`.
8. A slice that finishes raises its PR immediately via `pr-author` — draft, ≤500 lines,
   linked to the issue, reviewer team assigned by
   `requesting-reviewers`. Never batch.
9. Over 500 lines → `stack-split` before the PR opens, not after.
10. `qa-verifier` runs the QA CONTRACT against the PR's preview and posts the results table
    with screenshots (`qa-verify`).
11. `health-check` audits each diff: does it satisfy every acceptance criterion, and is every
    QA scenario traceable to a diff hunk. Defects route back to the owning slice only.
12. `address-ai-reviews` clears bot comments on each PR.
13. Update the state file and the `Engineering work — agent sessions` comment on every transition.
14. Stop at merge-ready. Report the PR set, the evidence, and anything left open. Never
    merge.
