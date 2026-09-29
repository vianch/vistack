# Playbook: design-implementation

**Match when Figma is the source of truth.** Report deviations. Do not invent design values.

## Steps

1. Read the Figma file. Record the file, frame, node ids, breakpoints, and states.
2. Extract variables and component structure from the design, not only from screenshots.
3. Map each design token to a repository token. Record unmapped values as deviations.
4. State the finish predicate for frames, breakpoints, tokens, and interactions.
5. Inventory existing components and compose before adding new ones.
6. Dispatch `planner` for one component or frame per slice, at most 500 changed lines,
   file ownership, dependencies, and the conflict matrix.
7. Run the advisor `plan` checkpoint on the token map, slices, and conflict matrix before
   dispatch (`skills/advisor/SKILL.md`). Apply or rebut each point with evidence.
8. Serialize shared style files. Dispatch one `design-implementer` per isolated worktree.
9. Build only specified states. For an absent state or token, use the nearest existing token
   only as an explicitly named interim deviation.
10. Verify each frame at each breakpoint with a screenshot beside the design reference. A
    nonzero parity diff is a failure until explained.
11. Run lint and tests. Pass the diff through comment cleanup.
12. Open each slice as a draft PR with screenshots and deviations. Attach new screenshots
    directly with `gh --attach`, following [GitHub attachments](../../docs/guide/github-attachments.md),
    then assign reviewers.
13. Run interactive QA on the preview and `health-check` against the references.
14. Run the advisor `done` checkpoint on every frame's parity evidence and the deviation
    list before calling the run merge-ready (`skills/advisor/SKILL.md`). Resolve each gap it
    names or record why it does not apply.
15. Update state, ledger, and session record. Stop at merge-ready and report every deviation.
