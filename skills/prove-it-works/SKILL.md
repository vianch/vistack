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

## What it changes

It changes what closes a QA scenario. The `qa-verify` contract requires a screenshot named
`<scenario>-<step>.png` for each assertion point, and a scenario with no screenshot stays
open. It also changes what a report says: `qa-verifier` returns a table with a screenshot
path per row, and a row with an empty path is a fail, not a pass with a missing file.

It changes the reviewer's job too. A PR carrying evidence gets reviewed for design; a PR
carrying assertions gets re-verified by hand.

## The failure it prevents

The most expensive class of agent failure: work that is reported complete, is reviewed on
the strength of that report, merges, and does not work. The build was green the whole time.
