# Playbook: qa-verification

**Match when** a PR exists and needs behavioural evidence against a live environment. The
QA CONTRACT in `qa-verify` is the exact shape and is non-negotiable.

## Steps

1. Collect the inputs: the PR link, the Vercel preview generated **for that PR**, and the
   credentials at `_private/knowledge/key-maker.json`. If that file does not exist or cannot
   be read, stop and ask for the correct path or filename before login. A missing or expired
   credential is FENCE 4.
2. Read the PR diff and derive the scenarios it requires: happy path, edge cases, and
   regressions in the touched areas. Every scenario cites the diff hunk it exists for. A
   generic smoke pass does not satisfy this step.
3. Confirm the preview finished building before touching it. A bypass against a building
   preview lands on the login wall and looks like a credential failure.
4. Access the env with Playwright: bypass with `portal.vercelPreviewPassword`, then log in
   with `portal.email` / `portal.password`.
5. Use `portal.stagingTestEventPYOS` as the test event, or `portal.stagingTestEventGA` where
   a scenario needs general admission.
6. Run every scenario end to end. Capture a screenshot at each assertion point, named
   `<scenario>-<step>.png`.
7. Record a pass only against a captured screenshot. Never against inference
   (`prove-it-works`).
8. Build the results table: scenario | steps | expected | actual | pass/fail | screenshot
   path.
9. Post the table on the PR and embed the screenshots with
   `embed-screenshots`.
10. Any fail blocks the PR and returns that slice to implementation with the failing
    scenario and its screenshot attached.
11. Never commit credentials, and never commit or embed a screenshot that exposes them.
12. Update the state file and the `Engineering work — agent sessions` comment with the QA result per
    slice.
