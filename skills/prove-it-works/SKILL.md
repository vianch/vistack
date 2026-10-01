---
name: prove-it-works
description: "Behaviour is proved by running it against a captured artifact — a screenshot, a response body, a test output. Use when claiming something works, closing a QA step, or accepting a green build as evidence."
---

# prove-it-works

A claim about behaviour is backed by an artifact or it is not made.

## The rule

- A pass is recorded against a **captured artifact**: a screenshot at the assertion point,
  the response body, the test runner's output. Never against inference.
- A green build proves the code compiles and the tests that exist pass. It does not prove
  the behaviour the ticket asked for. Those are different claims.
- "I would expect this to work" is a hypothesis. Run it.
- If the artifact cannot be captured, the step is not complete — say that instead of
  softening the claim.

## Run order and failure triage

Run the tests that cover the changed files first, through the repository's own test selector
when it has one. They are the fastest signal on the diff. Run the full suite once before
merge-ready, or let CI run it.

Classify each failure before acting on it. An agent that cannot tell which failures belong
to its diff either rewrites code it does not own or stalls on a red it did not cause.

| Class | Evidence |
|---|---|
| caused-by-diff | Fails on the head, passes on the base. |
| pre-existing | Fails on the base too. |
| flaky | Passes on a rerun of the same SHA. |

Only a caused-by-diff failure blocks the slice. A pre-existing or flaky failure gets a
`failure-triaged` row, with the class as the reason and the base run or rerun as the
evidence, and is routed outside the slice. A failure with no classifying evidence counts as
caused-by-diff.

## What it changes

It changes what closes a QA scenario. The `qa-verify` contract requires a screenshot named
`<scenario>-<step>.png` for each assertion point, and a scenario with no screenshot stays
open. It also changes what a report says: `qa-verifier` returns a table with a screenshot
path per row, and a row with an empty path is a fail, not a pass with a missing file.

For new PR evidence, attach local screenshots with `gh --attach` and embed the hosted
references in the matching rows. Follow [GitHub attachments](../../docs/guide/github-attachments.md)
for the CLI version check and upload procedure; preserve existing hosted references.

It changes the reviewer's job too. A PR carrying evidence gets reviewed for design; a PR
carrying assertions gets re-verified by hand.

## The failure it prevents

The most expensive class of agent failure: work that is reported complete, is reviewed on
the strength of that report, merges, and does not work. The build was green the whole time.
