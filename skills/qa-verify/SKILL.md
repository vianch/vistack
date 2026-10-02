---
name: qa-verify
description: "The QA contract: derive scenarios from a PR diff, use its head-matched Vercel preview with Playwright when the PR exposes one, otherwise use the repository's approved live-target control procedure, capture evidence at every assertion point, and post the results with GitHub-attached screenshots. Use when a PR needs behavioral evidence before merge-ready."
---

# qa-verify

A QA pass proves changed behavior on the exact PR head. Prefer the PR's own Vercel preview
and Playwright when the PR exposes a live Vercel URL. If it does not, use the repository's
approved live target and control skill. A green build or a test run alone is not behavioral
evidence.

## Inputs

| Input | Requirement |
|---|---|
| PR | The pull request under review, including its head SHA. |
| Target | The Vercel preview linked to this PR and head SHA, or the repository's approved live target when no Vercel URL is present. |
| Credentials | `_private/knowledge/key-maker.json` |
| Surface | Playwright through the repository's approved browser/control skill for a Vercel preview; otherwise the repository's control skill or project command. |
| PR reporting | The repository's PR skill and [GitHub attachment procedure](../../docs/guide/github-attachments.md). |
| Video | `skills/qa-video/SKILL.md`, with evidence under `<state-root>/qa/<slug>/`. |

If `_private/knowledge/key-maker.json` does not exist or cannot be read, stop before login
and ask the user for the correct path or filename. Do not guess, search unrelated locations,
or continue with an unverified credential source. A missing or expired credential is FENCE 4.

If the file exists but a required access property is absent, unreadable, or expired, stop
before login and ask the user for the approved credential path or property mapping for the
preview bypass, app login, or test event. Ask for paths and property names, never secret
values. This is FENCE 4.

## Resolve the target

1. Resolve the PR head SHA. Inspect the PR body, comments, checks, and deployment metadata
   for a live URL. A `vercel.app` URL or configured Vercel deployment domain is a preview
   candidate; a `vercel.com` dashboard URL is not itself a test target.
2. If the PR has a Vercel candidate, use that branch of the contract. Prove that the
   deployment belongs to the PR head and has finished building before bypassing deployment
   protection or logging in. If the link is stale, points at another SHA, or is still
   building, wait or report the blocked target; do not silently switch environments.
3. If the PR has no Vercel candidate, resolve the repository's own approved live target and
   control skill. If either is missing, the QA gate remains open. Never invent a URL or use
   staging as a substitute.

## Steps

1. Read the PR diff and derive happy-path, edge, and regression scenarios for the touched
   behavior. Every scenario cites the diff hunk that requires it. Split scenarios into
   explicit assertion points; each assertion point gets its own result row and artifact.
2. Resolve the target using the decision above. For a Vercel target, use Playwright through
   the repository's approved control skill. For another approved target, use that target's
   repository control skill. Keep secrets out of commands, URLs, logs, screenshots,
   comments, and tracked files.
3. Access the env with Playwright. For a protected Vercel preview, confirm the build is
   complete, then bypass deployment protection with `portal.vercelPreviewPassword` from the
   credential file. Log in with `portal.email` / `portal.password`. Use
   `portal.stagingTestEventPYOS` as the test event, or `portal.stagingTestEventGA` where
   general admission is required. Apply the repository's equivalent access procedure for
   the fallback target.
4. Run every scenario end to end. Capture one screenshot at the exact moment of every
   assertion point, named `<scenario>-<step>.png`. One screenshot at the end of a scenario
   does not cover earlier assertions. Run each browser scenario through
   `skills/qa-video/SKILL.md`, which records its video and takes those screenshots in the
   same pass. When no video can be made, write `none: <reason>` in its place.
5. Record the scenario, assertion point, steps, expected result, actual result, pass or
   fail, screenshot, video reference, and diff hunk.
6. Record a pass only when the screenshot exists and shows the claimed state. A missing,
   unreadable, stale, or secret-bearing artifact is a fail.
7. Post the results table through the project PR skill. Check `gh --version` and confirm
   `gh pr comment --help` lists `--attach`, following [GitHub attachments](../../docs/guide/github-attachments.md).
   Attach every approved screenshot and scenario video with one `--attach` flag per file
   and reference the same local path in the matching evidence cell so `gh` replaces it with
   a hosted file.
   Keep existing screenshot embeds; use native attachments for new uploads. Ask the user
   for images only when the running interface cannot be reached.
8. Re-read the posted PR comment and verify that it contains one row per assertion point,
   every row has an embedded screenshot and a video reference or its `none` reason, and the
   reported PR head matches the tested head.
9. A failed assertion returns to its owning slice with the evidence attached. Do not fix
   product code from the verifier role. Triage a failing automated check through
   `skills/prove-it-works/SKILL.md` before routing it.

## Results table

| scenario | assertion point | steps | expected | actual | pass/fail | embedded screenshot | video | diff hunk |
|---|---|---|---|---|---|---|---|---|
| `<name>` | `<step>` | `<actions>` | `<predicate>` | `<observation>` | `pass` | `![<step>](<uploaded-image-url>)` | `<scenario>.mp4 @ 00:04-00:09` | `<file:line>` |

The screenshot decides pass or fail. The video shows how the page reached that state, and
its `@ start-end` comes from the scenario's manifest.

## Exit criteria

Every required assertion point has a screenshot captured on the tested PR head, every row
maps to a diff hunk, every screenshot is embedded in the posted PR results table, every
browser scenario cites a video that passed `check` or the reason it has none, and the
comment has been verified after posting. Any failure remains open and blocks merge-ready
status.

## Gotchas

- A preview that is still building serves the deployment-protection wall, which looks
  exactly like a rejected password. Read the build state before suspecting the credential.
  Misread, it opens FENCE 4 for a credential that works, and an unattended run stops for
  nothing.
