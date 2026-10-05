# Playbook: bug-fix

**Match when wrong behavior is reported.** A reproduction comes before a fix. A fix without
runtime or test evidence is not complete.

## Steps

1. State the wrong behavior and the correct behavior in separate sentences.
2. Reproduce it on the matching surface. Record the exact steps, environment, observed
   result, and artifact. On a browser surface, dispatch a background `qa-verifier` lane
   (`skills/coordinate/SKILL.md`, QA lanes) to record the reproduction as a scenario with
   `skills/qa-video/SKILL.md`, so the same module replays on the PR head. Do not hand the
   reproduction to the user.
3. If it does not reproduce, tighten the trigger, or dispatch instrumentation of the
   surface to the tier owner. If it still does not reproduce, report what was tried and stop
   this playbook without changing code.
4. Dispatch the failing test to the slice owner at its tier, or the failing runtime
   artifact to a `qa-verifier` lane (`skills/coordinate/SKILL.md`, Dispatch rules). Watch it
   fail for the expected reason.
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
10. The slice owner runs the regression test, the suite in the run order of
    `skills/prove-it-works/SKILL.md`, and lint, and passes the diff through comment cleanup.
    The original reproduction reruns in a `qa-verifier` lane.
11. Open the draft PR with failing-then-passing evidence, root cause, fix, and regression
    test. Assign the configured reviewers.
12. Dispatch a background `qa-verifier` lane on the PR preview to capture the original
    behavior at the assertion point and replay the reproduction scenario on the PR head.
    Cite both videos.
13. Run `health-check` to confirm the test fails when the fix is absent. Route defects back
    to the owning slice.
14. When the router's Final report rule applies, render the run report with
    `skills/html-report/SKILL.md` first so the checkpoint reviews it. Run the advisor `done`
    checkpoint on the fix, regression test, and QA evidence before calling the run
    merge-ready (`skills/advisor/SKILL.md`). Resolve each gap it names or record why it does
    not apply.
15. Update state, ledger, and session record. Stop at merge-ready. Refresh the run report if
    one was rendered, and give its path or link.
