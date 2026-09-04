# Playbook: design-implementation

**Match when** the source of truth is a Figma file rather than prose. Deviations are
**reported, never invented** — a missing token is a question for the designer, not a
guessed hex value.

## Steps

1. Read the Figma source. Record the file, the frame, and the node ids being implemented.
2. Extract the variable definitions and the component structure from the design, not from a
   screenshot of it.
3. Map every design token to an existing token in the repo's design system. List the ones
   with no mapping — those are the deviations.
4. State the finish condition: which frames, at which breakpoints, matching which tokens.
5. Do not invent a value. A spacing, colour, radius, or type value absent from both the
   design system and the design is reported as a deviation and the nearest existing token is
   used in the interim, named in the PR body.
6. Dispatch `analyst` for the components that already exist: what can be composed rather
   than built (`subtract-before-you-add`).
7. Dispatch `planner`: one slice per component or frame, ≤500 lines, file-level ownership,
   conflict matrix (`slice-plan`). Shared style files serialize.
8. Dispatch `design-implementer` per slice, one worktree each. Repo conventions are
   non-negotiable: no `src/`, SASS for styles, strict TS, `type` over `interface`,
   alphabetized props, one component per file, early-return guards, no `let` in components.
9. Build the states the design specifies — default, hover, focus, active, disabled, loading,
   error, empty — and the breakpoints it specifies. A state with no design is a deviation.
10. Verify visual parity at each specified breakpoint with a screenshot per frame, side by
    side with the design reference.
11. Run lint and tests. Pass the diff through `pruning-comments`.
12. Raise each PR as its slice finishes — draft, screenshots embedded via
    `embed-screenshots`, deviations listed as a section in the body.
13. `qa-verifier` runs the interactive states on the preview, not just the static render
    (`qa-verify`).
14. `health-check` compares each frame's screenshot against the design reference and lists
    what differs.
15. Update the state file and the `Engineering work — agent sessions` comment. Stop at merge-ready.
