---
name: interrogate
description: "Adversarial multi-reviewer pass on a diff: independent reviewers on the current host's model get the same intent, rubric, and code-quality lens, and the lead returns one verdict sorted into Act on, Consider, Noted, and Dismissed. Use before calling a risky change done, or when asked to interrogate, stress-test, or skeptically review a branch. Never applies changes."
---

# interrogate

Independent reviewers try to break the change. The lead turns their findings into one
verdict. The deliverable is the verdict; nothing is applied automatically.

## Reviewers run on the current host's model

| Host | Reviewer | How |
|---|---|---|
| Claude Code | the `reviewer` agent (opus) | dispatch all reviewers in one message, in parallel |
| Codex | Luna, the model in `~/.codex/config.toml` (`gpt-6-luna`) | one `codex exec --ephemeral --sandbox read-only -m <model>` process per reviewer, in parallel |
| OpenCode | the configured model | one reviewer at a time in the thread; record `independence: reduced` |

Codex lanes follow the host adapter's lane rule in `skills/vistack/SKILL.md`. There is no
per-reviewer model list. Use three reviewers unless the change is trivial (two) or the user
asks for more. Every reviewer is read-only. If a reviewer cannot start, run the
rest and name the dropout; never block the verdict on it.

## Step 1. Scope

Take what the user points at: files, a diff, or a PR. On a branch with no pointer, review the
full changeset against the base branch recorded in the run state, or the repository default.
Package the diff with the context files a reviewer needs to understand it — callers, types,
and tests the change depends on.

## Step 2. State the intent

Write one paragraph from the user's request, the ticket, the PR description, the commits, and
the code. If the intent is unclear in a way that changes what "correct" means, that is FENCE
2: state the two readings. Otherwise proceed.

## Step 3. Dispatch

Fill `skills/interrogate/references/reviewer-prompt.md` with the intent, the diff, the
rubric from `skills/interrogate/references/rubric.md`, and the lens from
`skills/interrogate/references/code-quality-review.md`. Every reviewer gets the identical
text. No personas, no split lenses, no hints about the other reviewers.

## Step 4. Synthesize

1. Parse every finding.
2. Merge duplicates that describe one issue in different words; keep the count of reviewers
   that raised it.
3. Mark consensus: a finding raised independently by two or more reviewers.
4. Keep lone findings; weigh them, do not drop them.
5. Note disagreements, where one reviewer flags what another explicitly clears.

## Step 5. Lead judgment

Read `skills/interrogate/references/lead-judgment.md`. The lead is a pragmatic senior
engineer, not an aggregator. Trace every correctness claim to a call site before accepting
it (`evidence-over-inference`). Sort each finding into one bucket:

- **Act on** — a real correctness, security, or maintainability problem given the goal. It
  would block a real PR. Five items at most.
- **Consider** — legitimate, but the cost of fixing it now is open. The user decides.
- **Noted** — valid and not actionable now.
- **Dismissed** — wrong, a preference, or missing context. One line of why.

## Output

```
### Intent
> <the paragraph from step 2>

### Reviewers
- Reviewer A: <host model>, <n> findings
- Reviewer B: <host model>, <n> findings

### Act on
<finding — raised by — why it matters — the file:line>

### Consider
<finding — raised by — the tradeoff>

### Noted
<brief list>

### Dismissed
<finding — why>

### Agreement map
<where reviewers agreed, where they split, and what that says>
```

Record one ledger row, `decision: interrogated`, with the verdict path as evidence. An
`Act on` item goes back to the owning slice with its evidence. The verdict never edits code,
opens a PR, or posts a review; those stay with the owning role.
