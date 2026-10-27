# why: dig up the reasoning

The question is about intent, so the answer is a trail of records, from the line to the
person or document that decided. When the trail ends without a reason, that is the answer.

## Method

1. **Fix the lines.** The exact `file:line` range the question is about, at HEAD.
2. **Find the commit that introduced the behavior, not the last one to touch it.**
   `git log -L <start>,<end>:<file>` shows every change to the range. `git blame -w -C -C -M
   -L <start>,<end> <file>` skips whitespace and moves; add `--ignore-revs-file
   .git-blame-ignore-revs` when the file exists. Step past formatting, rename, and merge
   commits to the one that changed meaning.
3. **When did a value or behavior appear or vanish?** The pickaxe: `git log -S '<literal>'`,
   or `git log -G '<regex>'` for a pattern.
4. **Read the commit.** `git show <sha>`: the message, the files changed with it, and any
   issue or PR number.
5. **Read the PR and its review.** The review thread often holds the reason the commit
   message lacks. `gh pr list --state all --search <sha>`, or
   `gh api repos/<owner>/<repo>/commits/<sha>/pulls`. Origins inside the realm only
   (`skills/keep-origins-in-realm/SKILL.md`); outside it, stay with local git history.
6. **Follow the links out.** The ticket the PR names, through `gh issue view` or a connected
   tracker. Then the docs: ADRs (`docs/adr/`, `docs/decisions/`), design docs, `CHANGELOG`,
   and the repository's `CLAUDE.md` or `AGENTS.md`.
7. **Chat only when connected and allowed.** A Slack or similar thread linked from the PR or
   ticket, through its connector, cited by link.

## Sources

| Source | Proves | Limit |
|---|---|---|
| `git log -L`, `git blame` | who changed the lines, when, in which commit | not why; moves and reformatting hide the origin |
| `git log -S` / `-G` | when a literal or pattern appeared or vanished | needs a distinctive string |
| commit message | the author's stated reason | often "fix" or empty |
| PR body and review threads | the reasoning, alternatives, reviewer objections | squash merges keep only the PR link |
| ticket | the product or bug context that started it | may predate the final design |
| ADR, design doc, CHANGELOG | a decision recorded on purpose | may be stale against the code |
| chat thread | informal reasoning | only when connected and linked from a record |

## Answer shape

```
<the reason, one paragraph>

Confidence: documented | inferred from evidence | unknown
Trail: <sha> (<date>, <author>) → PR #<n> → <ticket> → <doc>
Quote: "<the line in a record that states the reason>"
What would change this: <a record not found, or a person to ask>
```

"Documented" needs a record that states the reason. "Inferred" names the evidence it rests
on. "Unknown" is a complete answer when the record is silent: "the commit says only 'fix
flaky test'; the PR has no description."
