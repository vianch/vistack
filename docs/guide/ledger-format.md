# Ledger format

Two files per run, both under `.claude/state/`, both git-ignored. The state file is *where
the run is*. The ledger is *how it got there*.

A decision without a ledger row did not happen.

## `.claude/state/<slug>.tsv` — the decision ledger

Tab-separated, append-only, seven columns, no header row.

```
ts	phase	slice	decision	reason	evidence	result
```

| Column | Contents | Rules |
|---|---|---|
| `ts` | ISO-8601 UTC | `2026-09-02T14:31:07Z`. Sortable, unambiguous. |
| `phase` | the phase the decision was made in | `planned` `dispatched` `implementing` `pr-open` `qa` `audit` `merge-ready` `blocked` `paused` |
| `slice` | slice name, or `—` for a run-level decision | matches the key in the state file exactly |
| `decision` | what was decided, in a verb phrase | lowercase, kebab, from the vocabulary below |
| `reason` | why | one clause. Not a restatement of the decision. |
| `evidence` | what makes it checkable | `file:line`, a command, a PR link, a screenshot path, an exit code |
| `result` | what happened | `ok` `failed` `skipped` `blocked` `void` `reconciled` |

Tabs separate columns, so **no literal tab inside a field**. A newline inside a field is
escaped `\n`. A field with no applicable value is `—`, never blank.

### The `decision` vocabulary

Free text is allowed, but these carry meaning elsewhere in the plugin:

| `decision` | Written by | Means |
|---|---|---|
| `playbook-matched` | router | which playbook owns the run |
| `step-skipped` | any | a playbook step stayed in the list and was not run — `reason` is required |
| `sliced` | `planner` | the slice list exists |
| `matrix-built` | `planner` | the conflict matrix exists; dispatch may begin |
| `dispatched` | `coordinator` | an agent is running on a slice |
| `serialized` | `coordinator` | a slice waited on another because they share a file |
| `pr-opened` | `pr-author` | draft PR exists, linked, reviewers assigned |
| `monitor-pass` | `babysit` | recurring pass inspected every agent PR and run invariant |
| `monitor-started` | `coordinator` | exactly one review monitor was started and verified for the current coordinator session |
| `stack-split` | `stack-split` | a diff became a chain |
| `qa-scenario` | `qa-verifier` | one scenario ran; `result` is its pass/fail |
| `attempt` | `unblocker` | one blocker attempt; `reason` is the hypothesis |
| `root-cause-fixed` | `unblocker` | the cause was found and fixed |
| `escalated` | any | a fence was hit; `reason` names which of the four |
| `defect-routed` | `health-check` | a defect went back to its owning slice |
| `workaround` | `implementer` | a symptom treatment was accepted as a decision |
| `reconciled` | `session-pickup` | the state file diverged from reality and was corrected |
| `paused` | `pause-safely` | the slice was parked at a safe point |

### Worked rows

```
2026-09-02T14:22:01Z	planned	—	playbook-matched	groomed ticket, unattended run requested	https://github.com/ORG/REPO/issues/123	ok
2026-09-02T14:24:16Z	planned	—	sliced	4 ACs group into 3 concerns; DetailRow has 0 call sites so the port became a delete	analyst impact map, components/DetailRow.tsx:1	ok
2026-09-02T14:24:40Z	planned	—	matrix-built	primitive and both swaps share components/index.ts	slice-plan matrix	ok
2026-09-02T14:25:02Z	dispatched	primitive	dispatched	wave 1, no shared files	.claude/worktrees/21510-progressbar-primitive	ok
2026-09-02T14:25:03Z	planned	swap-account	serialized	shares components/index.ts with primitive; starts from its branch	slice-plan matrix cell A×B	ok
2026-09-02T14:51:18Z	implementing	primitive	step-skipped	no Figma source for this slice, so step 4 of design-implementation does not apply	playbook step retained in task list	skipped
2026-09-02T15:03:44Z	implementing	primitive	attempt	hypothesis: aria-valuenow is unset because the value prop is not forwarded	bun test ProgressBar -> 1 failed, same assertion	failed
2026-09-02T15:07:12Z	implementing	primitive	root-cause-fixed	value was destructured but never applied to the element	ProgressBar.tsx:34, bun test -> 12 passed	ok
2026-09-02T15:19:55Z	pr-open	primitive	pr-opened	118 lines, one concern, reviewers assigned	https://github.com/ORG/REPO/pull/456	ok
2026-09-02T15:41:09Z	qa	primitive	qa-scenario	progressbar-renders at 0/50/100 on the PR preview	progressbar-renders-02.png	ok
2026-09-02T15:58:31Z	audit	swap-events	defect-routed	AC 3 has no hunk: the events call site still imports Loader	health-check criteria table, events/List.tsx:12	failed
2026-09-02T16:04:02Z	blocked	swap-events	escalated	FENCE 1 — 3 consecutive attempts, identical evidence	unblock dossier in ledger rows 14-16	blocked
```

### Reading it

- The **last row per slice** is that slice's real phase. The state file records intent; the
  ledger records what happened, and after a crash they disagree.
- A `void` result means an attempt broke a rule — skipped a test, loosened a type — and was
  reverted. It does not count against the blocker budget.
- `step-skipped` with an empty `reason` is a malformed row. The whole point of the row is
  the reason.

### Appending

```bash
LEDGER=".claude/state/${SLUG}.tsv"
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PHASE" "$SLICE" \
  "$DECISION" "$REASON" "$EVIDENCE" "$RESULT" >> "$LEDGER"
```

`printf` with explicit `\t`, never `echo` with typed tabs — a typed tab is an autocomplete
away from being spaces, and a ledger with spaces where tabs should be parses as one column.

## `.claude/state/<slug>.json` — the state file

Where the run is now. Full schema and an example: `skills/coordinate/SKILL.md`.

Written on **every** transition, in this order: state file → ledger row → session comment.
Any other order loses the run if the session dies between two of them.

Keyed by slice. Per slice: `agent` · `model` · `session_id` · `worktree` · `branch` · `pr` ·
`phase` · `blockers[]` · `retries`. Run-level: `slug` · `issue` · `playbook` ·
`finish_condition` · `unchanged` · `base_branch` · `coordinator_session_id`.

## Schema changes

A change to either shape is a **major** version bump in `.claude-plugin/plugin.json`, because
`session-pickup` reads state files written by earlier versions. See the README's updating
section.

## Never in either file

Credentials, tokens, session cookies, or the contents of `_private/`. Both files are
git-ignored, and neither is a reason to relax that.
