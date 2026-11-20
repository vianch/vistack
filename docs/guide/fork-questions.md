# Fork questions

A split fork reaches a decision model as typed questions of three kinds: a choice, a score, or a
yes/no (a noul). `laya/questions.py` builds them, `laya/tests/test_question_rules.py` holds every one to
the rules below, and `docs/guide/decision-engine.md` has the ladder that asks them. Change a
question here first; a rule a question breaks fails the lint with the rule and the fix.

## The rules

| Rule | What it means | Enforced by |
|---|---|---|
| The question ID is never sent | The model sees the instructions, the options, and the state. An option described only by its key, or every option by one template, tells it nothing. | lint `option-meaning` |
| One judgment per question | A question asks one thing. Verification asks one noul per output and one on the brief; file selection asks one score per candidate. | review; `laya/tests/test_loop_uses.py` pins the two fan-outs |
| Situations, not degrees | An option describes a situation that makes it right. No `low`, `more`, `partial`, no bare number, no reference to another option. | lint `option-meaning`, `score-level` |
| A Score level stands alone | Each level reads the same with the others removed, at least three words, lowest first because the engine reads a file's level by its index (`FILE_LEVELS`). | lint `score-level` |
| A high noul means yes, the risk is present | Phrase it "does X hold", never "is it safe" or "is it not": the engine reads 0.6 or more as yes and 0.4 up to 0.6 as cannot tell, and a split fork results. | lint `noul-polarity` |
| An exit on every Choice | One option from `EXIT_OPTIONS` (`none`, `not-a-slice`, `ask`, `unclear`, `no-change`), so an unsure answer has a place to go. At or above the tier's floor the engine records it in `outputs.declined` and keeps the fork split. | lint `exit-option`, and `test_the_exit_set_is_defined_once_and_closed` |
| Backticked state paths | The instructions name the state fields the answer depends on, such as `task.request`, and the state sent carries each one. The engine drops a question that names a field, or an evidence output, the state sent does not carry, and a state over its budget is not sent; the lint checks at 12,000, 6,000, 1,200 and 800 characters. | lint `state-pointer`, `state-absent` |
| Filter evidence in code; do arithmetic, counting, dates, and set checks in code | The model reads text. Code trims an output to its last 60 lines and 2,000 characters, resolves each output to its criterion, counts, compares, ranks, and picks the top file. | review; `laya/tests/test_loop_uses.py` (output trimming, ranking) |
| One call per decision; no question reads another's answer | Every question of a decision goes in one prediction, and code combines the answers. A question that needs a prior answer is two decisions. | review; `laya/tests/test_loop_uses.py` (`test_one_score_per_candidate_in_one_call`) |
| Extraction becomes selection | Offer the caller's candidates and ask the model to pick. Never ask it to write a path or an id. A candidate the caller did not describe, or a tenth, is not asked, and `fallback_reason` starts `not asked:` and says why. A choice outside the options the question offered is no answer. When a tier's budget cannot carry what the questions name, its reason reads `<tier> unavailable or rejected: not asked: ...`. | lint `silent-cut` and the synthetic contexts |

The lint builds every decision type's questions from the labelled scenarios in
`examples/laya/scenarios.jsonl` plus three synthetic contexts (an undescribed tool, an
undescribed file, twelve tools), and fails if a type has no context it can build. Run it with
`python3 -m unittest laya.tests.test_question_rules`. Against the questions as they stood
before the 2026-11-20 run it reported 14 choices without an exit, 4 options described by their
key, and 25 questions naming no state field. A rule with "review" has no lint: a person checks
it when a question changes.

## The coding-loop decisions

Five questions recur in a coding loop. Four map to a decision type or to code; one has no
boundary.

| Question | Where it lives |
|---|---|
| Which files to read or change | `file-selection`: one score per candidate, code ranks and acts on the top, a tie (top scores within 0.05, or another candidate at or above the top's level) stays split whatever the input order, all-lowest declines like `none` |
| Which model runs this | `model-selection`: the model names a situation (`pattern-copy`, `routine`, `judgment`, `ask`), code maps it to a move within the role's band |
| Is it safe to run | Not a model decision today. `irreversible()` in `laya/policy.py` matches merges, force-pushes, production deploys, and data deletion, and a gate keeps such an option or route with the main session. A model-asked `run-safety` type is a proposal, not built. |
| Is it done | `verification` on fresh output, below; an unjudgeable brief ends in a person |
| Keep or drop context | No viStack boundary calls it, so no decision type exists |

### Done

An `evidence` entry carries `kind`, `ref`, `criterion`, and either `status` or `output`, the
command's output captured after the slice's last change. Code keeps the last 60 lines and
2,000 characters and scrubs secret-shaped text before any model sees it: the value after a
sensitive key is blanked, on the same line or alone on the next, quoted or escaped. A test
count, or after a colon a plain lowercase phrase, stays, so a lowercase multi-word passphrase
is not blanked. Output showing the command never reached its target (connection refused,
ECONNREFUSED, ETIMEDOUT, could not connect, a webServer startup timeout) with no passed/failed
count or assertion error is unavailable evidence: `block`, sharp, in code. An entry with
`output` and no `status` makes the deterministic result `request-evidence` at 0.60, a split
fork, once every criterion is covered and nothing failed. The ladder then asks one noul per
such entry (does its output show its criterion holds?) and one on the brief (does a criterion
describe how something feels or seems to a person?), and code decides:

| Reading | Action |
|---|---|
| the brief, 0.6 or more | `escalate`: a criterion cannot be judged from output, so a person decides |
| the brief from 0.4 up to 0.6 | stays split |
| any entry below 0.4 | `request-evidence`, as a failed `status` does; `block` stays for unavailable evidence |
| any entry from 0.4 up to 0.6 | stays split |
| every entry at 0.6 or more, each output sent whole | `accept`, behind the deterministic evidence gate |
| an output cut to its tail (`...[earlier output trimmed]`) or left out of the state sent | stays split; a failing read still requests evidence |

`outputs.output_reads` and `outputs.unjudgeable` carry the readings. An entry whose output
covers no criterion is not asked, and nothing accepts it. One command run for two criteria
needs two entries with two `ref` values, since duplicate refs count once.

## Measuring a change

A change to a question is a change to what a model answers, so it is measured and kept or
reverted, never kept because it reads better. Replay labelled cases through the
live tier, score each tier's first answer before any gate with
`python3 scripts/evaluate-laya.py --backend ollama --ollama-model clef-flash --fallback none --raw`
(Jev: `--backend jev`), run the same frozen labels before and after, and keep the change only
when held-out accuracy holds or improves.

On 2026-11-20 the baseline was 155 `tier-selection` rows from real history with blind labels
(58 complex, 44 mechanical, 53 not a slice): hosted Jev answered 81 of the 102 real slices
right (0.794) and had no way to say a request was not a slice. Trimming the state sent to each
question's named fields was measured and reverted, so `state_for` in
`laya/questions.py` sends the whole bounded state.

### Hillclimbing the fork layer

Move a fork from split to sharp with a measured loop, not by editing rules until today's
failures pass.

1. Build scenarios from real runs first: ledger rows, `override` records, and corrected
   decisions. Hand-written cases come second. A case enters only when a person can say which
   action is right.
2. Split the scenarios into train and held-out sets before the first change. Keep the split
   fixed.
3. Check headroom and noise. A decision type above 95% held-out accuracy has no room to
   climb; aim at latency or cost instead. Repeat a model-backed run to measure variance.
4. Change one surface per round: one policy rule, one question schema, or one threshold.
   Read train failures only, and fix the cause, not the case.
5. Run both sets. Keep the change only when held-out accuracy improves or holds while train
   improves. Revert a change that lifts train and leaves held-out flat.
6. Never copy scenario text or its expected action into a policy rule. Keywords lifted from
   a failing case are leakage.
7. After two or three flat rounds, stop and sort the remaining failures by cause: ambiguous
   case, wrong label, missing input field, or a fork that belongs to the main session.
8. Report held-out accuracy against the baseline, and flag any gain inside the noise margin.

`scripts/evaluate-laya.py --split train` and `--split held-out` score the two sets. The split
comes from a stable hash of each scenario id, 30% held out by default
(`--held-out-percent`), so adding a scenario never moves an existing one. A scenario pins
itself with `"split": "train"` or `"split": "held-out"`. Each decision type reports its
accuracy and mean confidence.
