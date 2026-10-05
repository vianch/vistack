# Playbook: refactor

**Match when structure must change and observable behavior must not.** A discovered bug or
feature becomes a separate unit.

## Steps

1. State the target structure and the behavior contract that remains unchanged.
2. Run the behavioral baseline and record the command, result, commit, and uncovered paths.
3. Dispatch the tier owner (`skills/coordinate/SKILL.md`, Dispatch rules) to add
   characterization tests or an equivalence harness for every uncovered touched path. Land
   the pin before moving structure.
4. Inventory all callers, references, exports, tests, and generated files with `file:line`.
5. Name the target data shape. Use a state machine, registry, or typed model only when it
   removes branches or invalid states. When the new shape moves ownership, run `architect`
   (`skills/architect/SKILL.md`).
6. Dispatch the deletion of dead code and duplicate paths to the tier owner before adding
   the new structure.
7. Dispatch `planner` for independently verifiable slices, file ownership, and the conflict
   matrix. Migrate callers and remove an obsolete internal API in the same planned wave.
8. Run the advisor `plan` checkpoint on the pin, target shape, slices, tiers, and conflict
   matrix before dispatch (`skills/advisor/SKILL.md`). Apply or rebut each point with
   evidence.
9. Serialize shared files. Dispatch one owner per isolated worktree at its planned tier. No
   bundled fixes, new behavior, or compatibility shims without a recorded
   external-compatibility reason.
10. Keep the baseline green after every slice. Run lint, tests, and an equivalence check on
    the matching surface. Run tests in the run order of `skills/prove-it-works/SKILL.md`.
11. Open a draft PR per slice, one concern and at most 500 changed lines. Include the baseline
    evidence and reader-load improvement.
12. Dispatch QA spot checks to a background `qa-verifier` lane, then run `health-check` for
    hidden behavior changes once it completes. Update state, ledger, and session record.
13. When the router's Final report rule applies, render the run report with
    `skills/html-report/SKILL.md` first so the checkpoint reviews it. Run the advisor `done`
    checkpoint on the PR set, pin, and equivalence evidence before calling the run
    merge-ready (`skills/advisor/SKILL.md`). Resolve each gap it names or record why it does
    not apply.
14. Stop at merge-ready. Report the structure, pin, equivalence proof, and discarded work.
    Refresh the run report if one was rendered, and give its path or link.
