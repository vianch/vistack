# Findings file

The contract between `pr-reviewer`, the main session, and
`skills/review-pr/scripts/post-review.mjs`. Each reviewer returns this shape; the main session
merges, verifies, and writes one file per review at
`<state-root>/reviews/<owner>-<repo>-<n>/<head7>/findings.json`.

```json
{
  "body": "1 to 3 sentences in the voice, no praise padding",
  "comments": [
    {
      "path": "src/orders/refund.ts",
      "line": 42,
      "severity": "bug",
      "evidence": "refund() is called from retry.ts:88 after the lock is released, so two workers can both read balance 100 and both write 0",
      "body": "prob a race here: the lock is released before the write. Let's hold it until save() returns?"
    }
  ]
}
```

| Field | Rule |
|---|---|
| `body` | Required and non-empty: GitHub rejects a COMMENT review without one. With several reviewers, the main session merges their summaries into one. |
| `comments[].path` | Repository-relative, as it appears after `+++ b/` in the saved diff. |
| `comments[].line` | A line number on the new (RIGHT) side of the saved diff: an added or context line. About removed code: anchor on the nearest added or context line of the same hunk. A line outside the diff is still allowed and lands in the review body under "Outside the diff". |
| `comments[].severity` | One of `bug`, `risk`, `nit`, `question`. |
| `comments[].evidence` | The concrete failure path: the input, the caller (`file:line`), the state that breaks. For a `question`, what the reviewer looked for and did not find. Never posted; the script refuses a comment without it. |
| `comments[].body` | The exact text posted, in the voice. A `nit` starts with `nit:`. |

The script refuses a file whose `event` is anything but `COMMENT`, or whose `side` is
anything but `RIGHT`. It ignores `start_line`: multi-line ranges are not supported, so anchor
on the last line of the range.
