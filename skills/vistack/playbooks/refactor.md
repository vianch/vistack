# Playbook: refactor

**Match when** structure must change and behaviour must not. The finish condition is always
partly negative: nothing observable changed.

## Steps

1. State what changes structurally, and state explicitly that behaviour does not.
2. Establish the behavioural baseline before touching anything: run the suite, record the
   result, and note which of the touched paths are uncovered.
3. Where a touched path is uncovered, add the characterization test **first**, against
   current behaviour, and land it in its own slice. It is the only thing that will catch a
   regression.
4. Dispatch `analyst` for the full call-site inventory of everything being moved, renamed,
   or deleted, with `file:line`. An incomplete inventory makes the rest of the run unsafe.
5. Look for the deletion first: unused code is removed, not migrated
   (`subtract-before-you-add`).
6. Dispatch `planner`: slices ≤500 lines, mechanical and non-mechanical separated, file-level
   ownership per slice, conflict matrix (`slice-plan`). A rename that touches 40 files is its
   own slice and shares files with nothing else.
7. Serialize slices sharing a file. Parallelize the rest, one worktree each.
8. Each `implementer` keeps behaviour identical: no bundled fixes, no bundled improvements,
   no signature changes that were not in the plan. Anything noticed goes in the ticket.
9. Verify per slice: the suite gives the same result as the step-2 baseline, and lint is
   green. Pass each diff through `pruning-comments`.
10. Raise each PR as it finishes — draft, one concern, ≤500 lines, "no behaviour change"
    stated in the body with the baseline evidence.
11. `qa-verifier` spot-checks the user-visible surfaces the refactor passed through, with
    screenshots showing them unchanged.
12. `health-check` reads each diff for a behaviour change that slipped in — a changed
    default, a dropped branch, an altered order.
13. Update the state file and the `Engineering work — agent sessions` comment. Stop at merge-ready.
