# Playbook: design-implementation

**Match when Figma is the source of truth.** Report deviations. Do not invent design values.

## Steps

1. Resolve every Figma source through `skills/figma-sync/SKILL.md`: the file key, a node id
   per frame, breakpoints, states, and the design-system library. Ask once, in one message,
   for anything missing. Never guess a node id. Missing Figma authentication is FENCE 4.
2. Pull structure, design context, variables, and Code Connect mappings from Figma for every
   frame in scope. Screenshots are references, not sources.
3. Map each Figma variable to a repository token and each component to its Code Connect
   mapping or an existing primitive. Record unmapped values and components as deviations.
4. State the finish predicate for frames, breakpoints, tokens, and interactions.
5. Inventory existing components and compose before adding new ones.
6. Dispatch `planner` for one component or frame per slice, at most 500 changed lines,
   file ownership, dependencies, and the conflict matrix.
7. Run the advisor `plan` checkpoint on the token map, slices, and conflict matrix before
   dispatch (`skills/advisor/SKILL.md`). Apply or rebut each point with evidence.
8. Serialize shared style files. Dispatch one `design-implementer` per isolated worktree.
9. Before each frame, re-query its node in Figma and build from the live design. Build only
   specified states. For an absent state or token, use the nearest existing token only as an
   explicitly named interim deviation. Record each interim deviation as a `deviation` ledger
   row.
10. Verify each frame at each breakpoint with a screenshot beside a fresh Figma screenshot of
    the same node. A nonzero parity diff is a failure until explained.
11. Run lint and tests. Pass the diff through comment cleanup.
12. Open each slice as a draft PR with screenshots and deviations. Attach new screenshots
    directly with `gh --attach`, following [GitHub attachments](../../docs/guide/github-attachments.md),
    then assign reviewers.
13. Re-check the Figma nodes for changes since implementation, then run interactive QA on
    the preview and `health-check` against the references.
14. When the router's Final report rule applies, render the run report with
    `skills/html-report/SKILL.md` first so the checkpoint reviews it. Run the advisor `done`
    checkpoint on every frame's parity evidence and the deviation list before calling the
    run merge-ready (`skills/advisor/SKILL.md`). Resolve each gap it names or record why it
    does not apply.
15. Update state, ledger, and session record. Stop at merge-ready and report every
    deviation. Refresh the run report if one was rendered, and give its path or link.
