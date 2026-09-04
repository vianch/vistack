---
name: qa-verify
description: "Derive behavioral scenarios from a PR diff, run them against that PR's own live target, capture evidence at each assertion point, and report the results. Use when a PR needs QA evidence before merge-ready."
---

# qa-verify

A QA pass proves the changed behavior on the real surface. The project repository supplies
the browser, CLI, mobile, or service procedure and the PR-specific target.

## Inputs

| Input | Requirement |
|---|---|
| PR | The pull request under review. |
| Target | The preview or claimable QA environment generated for that PR and head SHA. |
| Access | The repository's approved credential path or login procedure. |
| Surface | The control skill or project command that drives the behavior. |

If access is missing or expired, stop before login at FENCE 4. Do not guess another path or
substitute staging, another branch, or a shared preview.

## Steps

1. Read the PR diff and derive happy-path, edge, and regression scenarios for the touched
   behavior. Every scenario cites the diff hunk that requires it.
2. Confirm the target finished building and points at the PR head. A protection wall on a
   building preview is not a credential failure.
3. Use the project's approved control procedure. Keep secrets out of commands, URLs, logs,
   screenshots, comments, and tracked files.
4. Run every scenario end to end. Capture one screenshot or equivalent response artifact at
   every assertion point. Name each artifact `<scenario>-<step>`.
5. Record the scenario, steps, expected result, actual result, pass or fail, evidence path,
   and diff hunk.
6. Record a pass only when the assertion artifact exists and shows the claimed state. A
   missing artifact is a fail.
7. Post the results table through the project PR skill and embed approved screenshots when
   the forge supports attachments.
8. A failed scenario returns to its owning slice with the evidence attached. Do not fix
   product code from the verifier role.

## Results table

| scenario | steps | expected | actual | pass/fail | evidence | diff hunk |
|---|---|---|---|---|---|---|
| `<name>` | `<actions>` | `<predicate>` | `<observation>` | `pass` | `<artifact>` | `<file:line>` |

## Exit criteria

Every required scenario has an evidence artifact, every row maps to a diff hunk, and the
results table is posted. Any failure remains open and blocks merge-ready status.
