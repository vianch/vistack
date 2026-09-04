# Playbook: bug-fix

**Match when** wrong behaviour is reported. **A reproduction comes before a fix** — no
exceptions, and a fix without one is not a fix.

## Steps

1. Restate the wrong behaviour and the correct behaviour, as two separate sentences.
2. Reproduce it. Record the exact steps, the environment, and the observed result with an
   artifact — output, screenshot, or a failing test.
3. If it does not reproduce, stop here and report what was tried. Do not fix what you
   cannot see. This is not a fence; it is an answer.
4. Write the failing test that encodes the reproduction, and watch it fail for the right
   reason.
5. Dispatch `analyst` to find the cause: trace from the symptom to the line that produces
   it, with `file:line`.
6. State the cause in one sentence before writing any fix. No sentence, no fix
   (`fix-root-causes`).
7. Check the blast radius: every other caller of the faulty code, and whether each shares
   the defect.
8. Dispatch `implementer` for the fix, in its own worktree. The fix addresses the cause; a
   workaround, if unavoidable, is recorded as a decision in the ledger and named in the PR
   body.
9. Watch the failing test pass, and the rest of the suite stay green. Run lint. Pass the
   diff through `pruning-comments`.
10. `pr-author` opens the draft PR: the reproduction, the cause, the fix, and the regression
    test in the body. Linked to the issue, reviewer team assigned.
11. `qa-verifier` verifies the original reproduction now yields the correct behaviour on the
    preview, with a screenshot at the assertion point (`qa-verify`).
12. `health-check` confirms the regression test would fail without the fix.
13. Update the state file and the `Engineering work — agent sessions` comment. Stop at merge-ready.
