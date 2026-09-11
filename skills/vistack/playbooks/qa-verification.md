# Playbook: qa-verification

**Match when a PR needs behavioral evidence from a live environment.** The QA contract in
`skills/qa-verify/SKILL.md` is the source of truth.

## Steps

1. Collect the PR, its own preview or approved QA target, and the repository's credential
   path. Resolve the PR head SHA and inspect its body, comments, checks, and deployment
   metadata for a live Vercel URL. A `vercel.app` or configured Vercel deployment URL is a
   candidate; a `vercel.com` dashboard URL is not a test target. Use
   `_private/knowledge/key-maker.json` as the credential path. Missing or expired
   credentials are FENCE 4.
2. Read the diff and derive happy-path, edge, and regression scenarios. Split each scenario
   into assertion points, and cite a diff hunk for every assertion point.
3. Confirm the target is built and points at the PR head before logging in. A stale,
   wrong-head, or still-building Vercel link is blocked; do not substitute staging, another
   branch's preview, or an invented URL. A protection wall on a building preview is not a
   credential failure.
4. Access the environment through the project's approved browser or control skill. When the
   PR has a valid Vercel URL, use Playwright: bypass deployment protection with
   `portal.vercelPreviewPassword`, then log in with `portal.email` / `portal.password`. Use
   `portal.stagingTestEventPYOS` as the test event, or `portal.stagingTestEventGA` where a
   scenario needs general admission. When the PR has no Vercel URL, use the repository's own
   approved live target and control skill. Never paste credentials into commands, URLs, logs,
   screenshots, comments, or tracked files.
5. Run every scenario end to end. Capture one screenshot at every assertion point with a
   stable `<scenario>-<step>.png` name. One screenshot at the end of a scenario does not
   cover earlier assertions.
6. Record one results row per assertion point: scenario, assertion point, steps, expected
   result, actual result, pass or fail, screenshot path, and diff hunk.
7. A pass without a matching screenshot is a fail. A failed assertion returns to its owning
   slice with the evidence attached. If `_private/knowledge/key-maker.json` is missing or
   unreadable, or a required property is absent or expired, stop before login and ask the
   user for the correct credential path or property mapping. Ask for paths and property names,
   never secret values. This is FENCE 4.
8. Post the results table through the project PR skill. Check `gh --version` and confirm
   `gh pr comment --help` lists `--attach`; follow [GitHub attachments](../../docs/guide/github-attachments.md).
   Attach each new screenshot with `gh --attach` and reference its local path in the
   matching table row. Keep historical hosted references. Re-read the PR comment and
   verify the tested head SHA, one row per assertion point, and one attached image per row.
9. Run the adversarial health check after QA. Update state, ledger, and session record.
