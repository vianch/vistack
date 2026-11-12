# Risk rubric

This file is the one home for ranking fix candidates by risk, meaning how likely a
production incident is and what it would cost. `maintenance` ranks with it, and
`crash-hunt` points here for the same order.

## Score

Score = likelihood x impact, each 1 to 5, so 1 to 25. A candidate also passes the
provability gate, and no exclusion applies to it.

Rank by score, highest first. A tie goes to the smaller blast radius, because a change that
touches fewer callers is easier to prove and to review. A tie that remains is the
coordinator's call, with its reason in the pick's ledger row.

Changed lines are never a score or tie-break input. Their one use is the 500-line exclusion.

### Likelihood

Likelihood is 1 plus one per signal with evidence, at most 5. A recorded failure alone sets
5, because the failure has already happened. A signal without its evidence counts zero.

| Signal | Evidence that counts |
|---|---|
| Reachable from external input (an HTTP handler, queue consumer, webhook, or upload) | the entry point and each hop to the candidate, `file:line` |
| Reachable without authentication | the route or middleware chain with no auth check, `file:line` |
| Hot path | a trace, metric, or log volume, or a call on every request such as middleware, `file:line` |
| Churn or earlier fixes in the same area | the commits `git log -L` lists for those lines, or an earlier fix's SHA |
| A recorded failure | a log line, error report, incident note, or a TODO naming an incident, by URL or `file:line` |
| A guard sibling code has and this code lacks | the sibling's guard and this unguarded line, both `file:line` |

### Impact

Each candidate names one impact class and the harm if it fires. A structural risk takes the
class of the defect it invites, with the `file:line` that shows how.

| Class | Covers |
|---|---|
| Money | payments, refunds, pricing, inventory |
| Auth and permissions | who can read or change what |
| Data integrity | writes outside a transaction, non-idempotent retries |
| Availability | an unbounded query, a missing timeout, pool exhaustion, a crash on malformed input |
| Privacy | PII or secrets in logs |
| Customer-visible errors | an error mapped to 500 instead of the repository's documented error contract |

Impact scores the harm, not the class, so two candidates in one class can differ.
Reversibility comes first, because a deploy ends an outage but does not refund a charge or
recall a leaked record.

| Impact | The harm |
|---|---|
| 5 | Outlives the fix and reaches customers or their data, such as a wrong charge, a corrupted or leaked record, or access a caller should not have. |
| 4 | Outlives the fix but stays internal, or stops a customer path for every user until the fix ships. |
| 3 | Ends with the fix and reaches some customers, such as errors on one path or a wrong error contract. |
| 2 | Ends with the fix and reaches only operators or internal callers. |
| 1 | No class applies. |

## Provability gate

A candidate names the check that would show it fixed. For a behavior change, that is a test
or replayed request that fails on the base branch for the stated reason and passes with the
fix. For a structural change, it is characterization tests that pin the behavior and pass
before and after. With no such check the candidate is excluded, because a fix nobody can
show working is a claim, not a change.

## Exclusions

The list is closed. A candidate that matches one is dropped whatever its score, and nothing
else drops a candidate. The fences are in `skills/autonomy-has-fences/SKILL.md`.

| Exclusion | Why |
|---|---|
| Formatting, lint-only, renames, comment-only | No runtime risk changes. |
| Dead code with no runtime path | Nothing can fail there. |
| Anything needing a product decision | FENCE 2. |
| A dependency major bump, a shared-environment migration, data deletion | FENCE 3. |
| Credentials | FENCE 4. |
| More than 500 changed lines, estimated or measured | A bigger fix is a planned project, not a ranked pick (`skills/one-concern-per-pr/SKILL.md`). |
| A file or topic an open `claude/*` PR already covers | The open PR may fix it, and two branches on one file conflict. |
| The topic of a `claude/*` PR closed without merge in the last 30 days | A reviewer rejected it, so it is not retried. |
| A topic in `<state-root>/maintenance/dropped.jsonl` dated in the last 30 days | An earlier run dropped it over the 500-line ceiling or an unconfirmed proof, so a retry repeats the drop. |
| No provable check | The provability gate. |

## Return shape

The analyst returns up to five rows, ranked, in this shape.

```text
| Rank | Topic | Where | Signals | L | Class and harm | I | Score | Behavior change | Proof | Blast radius | Lines | Tier flags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
```

| Column | Holds |
|---|---|
| Rank | The order under Score. |
| Topic | A kebab-case name of two to four words, used in the branch name. |
| Where | The risky line, `file:line`. |
| Signals | Each likelihood signal with its evidence, separated by `;`. |
| L | Likelihood. |
| Class and harm | The impact class and what happens if it fires. |
| I | Impact. |
| Score | L x I. |
| Behavior change | `yes` for a defect, `no` for a structural risk. |
| Proof | The check, and what it shows on the base branch and after the change. |
| Blast radius | The call sites and consumers the change touches, counted, each `file:line`. |
| Lines | Estimated changed lines, read only against the 500-line exclusion. |
| Tier flags | `changes_data_shape`, `changes_public_contract`, and `crosses_boundary`, each yes or no, as in the analyst's impact map. |

After the table, list each dropped candidate on one line with its topic, its `file:line`,
and the exclusion that dropped it.
