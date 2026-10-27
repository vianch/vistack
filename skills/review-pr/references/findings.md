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
    },
    {
      "path": "src/orders/refund.ts",
      "start_line": 57,
      "line": 58,
      "severity": "nit",
      "evidence": "the literal 30 is the refund window in days, also hard-coded at policy.ts:12",
      "body": "nit: let's name this so it can't drift from policy.ts",
      "suggestion": "const refundWindowDays = REFUND_WINDOW_DAYS;\nconst cutoff = addDays(order.paidAt, refundWindowDays);"
    }
  ]
}
```

| Field | Rule |
|---|---|
| `body` | Required and non-empty: GitHub rejects a COMMENT review without one. With several reviewers, the main session merges their summaries into one. |
| `comments[].path` | Repository-relative, as it appears after `+++ b/` in the saved diff. |
| `comments[].line` | A line number on the new (RIGHT) side of the saved diff: an added or context line. About removed code: anchor on the nearest added or context line of the same hunk. A line outside the diff is still allowed and lands in the review body under "Outside the diff". |
| `comments[].start_line` | Optional. An integer of at least 1 and below `line`, for a comment on a range. It posts inline only when every line from `start_line` to `line` is on the new side of the saved diff; otherwise it lands in the review body. |
| `comments[].start_side` | Optional; `RIGHT` when present. |
| `comments[].suggestion` | Optional. The exact text that replaces the anchored lines (`start_line` to `line`, or `line` alone); `""` deletes them. Inline, it posts as a GitHub suggestion the author applies in one click. In the review body it becomes a plain code block, because GitHub cannot apply it there. |
| `comments[].severity` | One of `bug`, `risk`, `nit`, `question`. |
| `comments[].evidence` | The concrete failure path: the input, the caller (`file:line`), the state that breaks. For a `question`, what the reviewer looked for and did not find. Never posted; the script refuses a comment without it. |
| `comments[].body` | The exact text posted, in the voice. A `nit` starts with `nit:`. |

The script refuses a file whose `event` is anything but `COMMENT`, or whose `side` or
`start_side` is anything but `RIGHT`. With `--pending` it drops the event, and GitHub keeps
the review unsubmitted for the operator.
