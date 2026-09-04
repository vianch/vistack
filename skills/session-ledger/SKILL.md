---
name: session-ledger
description: "Maintain one durable run record with role, slice, model, session id, worktree, branch, PR, phase, monitor, and resume information. Use after dispatch and every phase transition."
---

# session-ledger

One comment on the parent issue, or one host-local equivalent when the host has no issue
surface. It is how a human finds a running agent and resumes a run whose session is gone.

**Upsert, never append.** A second comment splits the truth in two and the older one starts
lying immediately.

## When to write it

- **Immediately after each dispatch** — not at the end of the phase.
- On **every** transition: a PR opening, a QA result, a blocker, a pause, a slice reaching
  merge-ready.
- After `session-pickup` reconciles, with the new session ids.

## The record

Title line, exactly: `Engineering work — agent sessions`

```markdown
## Engineering work — agent sessions

| role | slice | model | session id | worktree | branch | PR | phase |
|---|---|---|---|---|---|---|---|
| coordinator | — | opus | `session_011xyz…` | — | — | — | dispatching |
| implementer | primitive | sonnet | `session_011abc…` | `.claude/worktrees/21510-progressbar-primitive` | `user/issue-progressbar-primitive` | [#21611](…) | qa |
| implementer | swap-account | sonnet | `session_011def…` | `.claude/worktrees/21510-progressbar-swap-account` | `user/issue-progressbar-swap-account` | — | implementing |
| qa-verifier | primitive | sonnet | `session_011ghi…` | — | — | [#21611](…) | qa |
| monitor | — | — | `loop:10m` | — | — | all agent PRs | active |

Resume: `claude attach session_011xyz…`

Ledger: `<state-root>/21510-progressbar.tsv` · State: `<state-root>/21510-progressbar.json`

```

The resume line always carries the coordinator's session id. A user attaching to an
implementer gets one slice. Attaching to the coordinator gets the run. On Codex, use the
host's thread or session resume operation instead of inventing a Claude command.

## Upsert mechanics

```bash
# find it
COMMENT_ID=$(gh issue view "$ISSUE" --json comments \
  --jq '.comments[] | select(.body | startswith("## Engineering work — agent sessions")) | .id' | head -1)

# update in place, or create the first one
if [ -n "$COMMENT_ID" ]; then
  gh api --method PATCH "repos/{owner}/{repo}/issues/comments/$COMMENT_ID" -f body@- < comment.md
else
  gh issue comment "$ISSUE" --body-file comment.md
fi
```

Match on the title line, not on position — other comments arrive between updates.

If the search returns more than one match, an append already happened: keep the newest,
edit the others down to a single line pointing at it, and append a ledger row recording the
duplicate. Do not delete a comment.

## Contents rules

- One row per dispatched agent, including the coordinator. A finished agent keeps its row
  with its final phase — the table is the run's history, not just its present.
- Include one `monitor` row while the coordinator's recurring monitor is active. Update its
  phase to `stopped` when the run pauses, fences, or reaches merge-ready.
- `—` for a column that does not apply to that role. Never blank, never invented.
- Session ids are copied, never reconstructed.
- No credentials, no screenshot contents, no file bodies. Links and paths only.
- External posts use the project's ordinary human voice and contain no automation attribution
  or internal product, invocation, role, skill, model, or host name. This includes the issue
  title, PR title, description, comments, review feedback, and QA results.
- Long runs also include the state path, ledger path, wake mechanism, last progress time, and
  the terminal or held gate. Never describe an active monitor without a live owner.
