# Playbook: qa-verification

**Match when a PR needs behavioral evidence from a live environment.** The QA contract in
`skills/qa-verify/SKILL.md` is the source of truth.

## Steps

1. Collect the PR, its own preview or approved QA target, and the repository's credential
   path. Missing or expired credentials are FENCE 4.
2. Read the diff and derive happy-path, edge, and regression scenarios. Every scenario cites
   a diff hunk.
3. Confirm the target is built and points at the PR head before logging in.
4. Access the environment through the project's approved browser or control skill. Never
   paste credentials into commands, URLs, logs, or tracked files.
5. Run every scenario end to end. Capture one screenshot at every assertion point with a
   stable scenario and step name.
6. Record scenario, steps, expected result, actual result, pass or fail, and screenshot path.
7. A pass without a screenshot is a fail. A failed scenario returns to its owning slice with
   the evidence attached.
8. Post the results table and embed approved screenshots through the project skill.
9. Run the adversarial health check after QA. Update state, ledger, and session record.
