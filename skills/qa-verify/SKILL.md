---
name: qa-verify
description: "The QA contract — derive scenarios from the PR diff, drive them on the PR's own Vercel preview with Playwright, capture a screenshot at every assertion point, and post the results table with the screenshots embedded on the PR. Use when a PR needs behavioural evidence before it can be called merge-ready."
---

# qa-verify

The QA CONTRACT. Exact shape, per PR, non-negotiable. A pass exists only where a screenshot
exists.

## Inputs

| Input | Value |
|---|---|
| **PR** | the pull request link |
| **Env** | the Vercel preview generated **for that PR** — not staging, not another branch's preview |
| **Credentials** | `_private/knowledge/key-maker.json` |

If the credentials file does not exist or cannot be read at that path, stop before login and
ask the user for the correct path or filename. Do not guess, search unrelated locations, or
continue with an unverified credential source. A missing or expired credential is **FENCE 4**.
Do not proceed on a stale one.

## Steps

1. **Read the PR diff and derive the scenarios it requires** — happy path, edge cases, and
   regressions in the touched areas. **Every scenario cites the diff hunk it exists for.** A
   generic smoke pass does not satisfy this step, and a scenario that cites no hunk is a
   scenario about something this PR did not change.

2. **Access the env with Playwright.** It is a Vercel preview, so it takes two gates in
   order:
   - bypass the deployment protection with `portal.vercelPreviewPassword`
   - then log in to the app with `portal.email` / `portal.password`

   Confirm the preview has **finished building** first. A bypass against a still-building
   preview lands on the protection wall and reads exactly like a bad password.

3. **Use `portal.stagingTestEventPYOS` as the test event**, or `portal.stagingTestEventGA`
   where a scenario needs general admission.

4. **Run every scenario end to end.** Capture a screenshot at each assertion point, named
   `<scenario>-<step>.png`. Not one screenshot at the end — one per assertion.

5. **Report a table:**

   | scenario | steps | expected | actual | pass/fail | screenshot |
   |---|---|---|---|---|---|
   | `progressbar-renders` | open story, set 50% | bar half filled, `aria-valuenow=50` | as expected | pass | `progressbar-renders-02.png` |

6. **Post the table on the PR and embed the screenshots** with
   `embed-screenshots`.

## Rules that decide the outcome

- **A pass is recorded only against a captured screenshot, never against inference.** No
  screenshot, no pass — the row is a fail with the file missing, and that is the honest
  result (`prove-it-works`).
- **Any fail blocks the PR** and returns that slice to implementation, with the failing
  scenario and its screenshot attached. Not a note in the body; a return to the owner.
- **Never commit credentials.** Never commit or embed a screenshot showing a password field
  with content, a token in a URL, or a session cookie.
- Screenshots live outside tracked paths until `embed-screenshots` places them.

## Credential key reference

The contract's keys resolve inside `_private/knowledge/key-maker.json` as:
`portal.vercelPreviewPassword` (the deployment-protection bypass), `portal.email` and
`portal.password` (the application login), `portal.stagingTestEventPYOS` and
`portal.stagingTestEventGA` (test events). `_private/**` is git-ignored in this repo; in
another repo, confirm the equivalent path is ignored before writing anything to it.
