# Playbook: refactor

**Match when structure must change and observable behavior must not.** A discovered bug or
feature becomes a separate unit.

## Steps

1. State the target structure and the behavior contract that remains unchanged.
2. Run the behavioral baseline and record the command, result, commit, and uncovered paths.
3. Add characterization tests or an equivalence harness for every uncovered touched path.
   Land the pin before moving structure.
4. Inventory all callers, references, exports, tests, and generated files with `file:line`.
5. Name the target data shape. Use a state machine, registry, or typed model only when it
   removes branches or invalid states.
6. Delete dead code and duplicate paths before adding the new structure.
7. Dispatch `planner` for independently verifiable slices, file ownership, and the conflict
   matrix. Migrate callers and remove an obsolete internal API in the same planned wave.
8. Serialize shared files. Dispatch one implementer per isolated worktree. No bundled fixes,
   new behavior, or compatibility shims without a recorded external-compatibility reason.
9. Keep the baseline green after every slice. Run lint, tests, and an equivalence check on
   the matching surface.
10. Open a draft PR per slice, one concern and at most 500 changed lines. Include the baseline
    evidence and reader-load improvement.
11. Run QA spot checks and `health-check` for hidden behavior changes. Update state, ledger,
    and session record.
12. Stop at merge-ready. Report the structure, pin, equivalence proof, and discarded work.
