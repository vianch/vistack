# Playbook: bug-fix

**Match when wrong behavior is reported.** A reproduction comes before a fix. A fix without
runtime or test evidence is not complete.

## Steps

1. State the wrong behavior and the correct behavior in separate sentences.
2. Reproduce it on the matching surface. Record the exact steps, environment, observed
   result, and artifact. Do not hand the reproduction to the user.
3. If it does not reproduce, tighten the trigger or instrument the surface. If it still does
   not reproduce, report what was tried and stop this playbook without changing code.
4. Write the failing test or capture the failing runtime artifact. Watch it fail for the
   expected reason.
5. Form distinct hypotheses and narrow them with runtime evidence. Trace the surviving
   mechanism to `file:line` before planning the fix.
6. State the root cause in one sentence. A workaround is a ledger decision with a reason.
7. Check every other caller of the faulty code and record the blast radius.
8. When the fix touches more than one caller or crosses a boundary, run the advisor `plan`
   checkpoint on the root cause, blast radius, and fix scope before dispatch
   (`skills/advisor/SKILL.md`). Otherwise skip it with that reason.
9. Dispatch the slice owner at its tier in its own worktree: `implementer`, or
   `senior-implementer` when the fix crosses a boundary or changes a contract. The scope
   names the cause, files, test, and unchanged behavior. No bundled cleanup.
10. Run the original reproduction, the regression test, the suite, and lint. Pass the diff
    through comment cleanup.
11. Open the draft PR with failing-then-passing evidence, root cause, fix, and regression
    test. Assign the configured reviewers.
12. Run QA on the PR preview and capture the original behavior at the assertion point.
13. Run `health-check` to confirm the test fails when the fix is absent. Route defects back
    to the owning slice.
14. Run the advisor `done` checkpoint on the fix, regression test, and QA evidence before
    calling the run merge-ready (`skills/advisor/SKILL.md`). Resolve each gap it names or
    record why it does not apply.
15. Update state, ledger, and session record. Stop at merge-ready.
