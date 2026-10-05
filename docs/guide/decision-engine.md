# Local decision engine

The local decision engine is an advisory subsystem for viStack. It returns typed
recommendations for orchestration decisions. It does not dispatch agents, create worktrees,
change state, merge pull requests, or replace the deterministic rules in the playbooks.

## Architecture

```text
viStack context
    |
    v
DecisionContext -> deterministic policy --sharp--> typed Decision (fork: sharp) -> runs in code
                         |
                       split
                         v
                  refinement ladder: Jev (opt-in) -> Cloudflare clef-flash (opt-in) -> Ollama clef-flash (local, opt-in)
                         |
                  safety gates --pass--> typed Decision (fork: sharp) -> runs in code
                         |
                       fail -> deterministic fallback (fork: split) -> main session decides
```

The implementation lives in `laya/`. The command-line adapter is
`scripts/vistack-decision.py`. A caller may use the library directly or keep one process
alive with the JSONL server.

The deterministic policy is always evaluated first. When its confidence meets the threshold
(`--min-confidence`, default 0.65) the fork is **sharp**: it runs in code and no model is
asked. Only a **split** fork climbs the refinement ladder, and a tier's answer settles it
only when all of these checks pass:

1. The answer is a valid typed answer for the decision type.
2. The action is in the caller's available action set.
3. Confidence meets the configured threshold.
4. The result does not violate deterministic readiness, dependency, evidence, size,
   irreversibility, or shared-file gates.

Otherwise the next tier is asked, so each tier answers only the forks the tiers before it
left unsettled, whether those were unavailable, unsure, or rejected by a gate. A tier may
carry its own higher threshold; the Ollama model's is 0.85. After the last one the deterministic result is
returned with `fallback_used: true`, a reason, and `fork: split`. When a tier agrees with the
policy's own lean, the decision keeps the policy's rationale and the higher confidence.

Models do not re-read sharp forks because, on the labelled scenarios, every time hosted Jev
overrode a confident deterministic answer the override was wrong (6 of 6), and deterministic
accuracy fell from 100% to 91%. `--consult always` still asks the ladder on sharp forks and
records its answer in `outputs.model_opinion` for evaluation, without applying it.

## Protocol and model references

The integration follows the published interfaces.

| Reference | Finding used here |
|---|---|
| [TypeSafe API](https://docs.typesafe.ai/api) | Jev serves the System One protocol at `POST https://api.typesafe.ai/v1/systemone` with a bearer key. Jev 1.13 costs $0.042 per million input tokens; output tokens are free. |
| [Ollama System One API](https://docs.ollama.com/api/systemone) | Ollama serves the same System One protocol at `POST /v1/systemone`, with no key. |
| [Ollama decision capability](https://docs.ollama.com/capabilities/decision) | Decision models answer typed questions instead of generating text; choice questions take 2 to 26 options. |
| [Ollama decision models announcement](https://ollama.com/blog/ollama-now-supports-jev-style-decision-models) | Ollama loads a decision model like any other and keeps it resident for the `keep_alive` window. |
| [`clef-flash` on Ollama](https://ollama.com/library/clef-flash) | Cloudflare's 9B decision model, post-trained from Qwen3.5-9B, Apache-2.0: 10.9 GB at Q8_0, a 16,384-token default window, and the `decision` capability. It needs Ollama 0.35.1 or newer and answers only System One requests. |
| [TypeSafe patterns](https://docs.typesafe.ai/patterns) | Keep deterministic work in code, ask narrow independent questions, and gate actions on confidence per consequence. |

The model is not trained on viStack-specific outcomes, so historical overrides and final
outcomes are recorded for evaluation rather than treated as automatic retraining data.

## Requirements and installation

The deterministic engine needs only Python 3.11 or newer and the standard library. It runs
on the same machines that run the plugin and is the default when no model is configured.

The local tier needs [Ollama](https://ollama.com) 0.35.1 or newer with the `clef-flash`
model, and the hosted tier needs a TypeSafe key. The plugin installs neither, and
`--backend auto` stays deterministic until Jev or an Ollama model is configured:

```bash
ollama pull clef-flash                                              # about 11 GB, once
python3 scripts/vistack-decision.py decisions on --ollama-model clef-flash
```

## Hosted fork tier: Jev

[Jev](https://docs.typesafe.ai/models) is TypeSafe's hosted System One model. It answers the
same typed questions as the Ollama model. On the labelled scenarios it settled 7 of the 10 split
forks, all correctly, and left the other 3 split for the main session. It is opt-in, because
it sends the bounded, redacted decision state to TypeSafe:

```bash
python3 scripts/vistack-decision.py decisions on --jev   # this project
export VISTACK_LAYA_JEV=1                               # every project in this shell
```

The key is read from `TYPESAFE_API_KEY`, then `TYPESAFE_KEY`, and never written to a file. An
opted-in Jev leads the ladder: it answers a split fork in about 350 ms warm and about 0.5 s
from a cold CLI call, and the Ollama model is asked only when Jev cannot answer. Without Jev,
the Ollama model leads. TypeSafe publishes no balance endpoint, so a 401, 402, or 403 is
taken to mean the key or credits are gone: Jev is skipped for an hour, recorded in
`~/.cache/vistack/jev-status.json`, and the Ollama model answers instead. A 429 or 529 is a
normal transient failure. `decisions status --probe` makes one single-question call to
prove the key and remaining credits. That call is billed.

The TypeSafe agent skill is not installed: both of its install paths clone from a GitHub
organisation outside the allowed origin realm. This adapter follows the published API
documentation instead.

## Hosted fork tier: Cloudflare Workers AI

Cloudflare serves the same 9B decision model as `@cf/cloudflare/clef-flash` on Workers AI. It
sits between Jev and Ollama. It is opt-in, because it sends the bounded, redacted decision
state to Cloudflare, as Jev does and Ollama does not:

```bash
python3 scripts/vistack-decision.py decisions on --cloudflare   # this project; --no-cloudflare turns it off
export VISTACK_LAYA_CLOUDFLARE=1                               # every project in this shell
```

`--backend cloudflare` and `--fallback cloudflare` select it on the engine commands, and the
switch file key is `"cloudflare": true`. Credentials alone do not opt in.

**Credentials** come from the environment only and are never written to the switch file:
`CLOUDFLARE_API_TOKEN` (or `CLOUDFLARE_AUTH_TOKEN`) and `CLOUDFLARE_ACCOUNT_ID`. The token needs
`Workers AI · Read` and `Workers AI · Edit` on the account. Create it in the dashboard under
AI -> Workers AI -> Use REST API -> Create a Workers AI API Token, or under My Profile -> API
Tokens with the Workers AI template; Account Resources must include the account. A token with
no account resources still reports "active" at `/user/tokens/verify`, yet `/ai/run` returns 401
code 10000.

**Cost guard.** Workers AI gives 10,000 Neurons a day free, reset at 00:00 UTC
([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)); `clef-flash`
costs 8,182 Neurons per million input tokens. A machine-wide ledger at
`~/.cache/vistack/cloudflare-status.json` reserves an upper-bound estimate before each call and
reconciles to the reported usage after it. The default daily cap is 9,000 Neurons;
`VISTACK_LAYA_CLOUDFLARE_DAILY_NEURONS` may lower it, never above 10,000. The local count sees
only this machine, while the allocation is per account, so Cloudflare's own refusal is
authoritative:

| Response | Meaning | Effect |
|---|---|---|
| 429 code 3036 | "Daily free allocation of 10,000 neurons exceeded" | tier parked until 00:00 UTC |
| 403 code 5035 | the model requires Workers Paid | tier refused for an hour |
| auth failure | token or account wrong | tier refused for an hour |
| 429 code 3040 | capacity | transient; the fork moves on |

When the cap is reached or Cloudflare refuses, the tier sends nothing and split forks go to the
Ollama `clef-flash`.

**Measured 2026-10-05:** one live decision with 217 input tokens took 0.77 s and cost about 1.8
Neurons (output tokens 0), so the 9,000 cap covers several thousand forks a day at the
6,000-character state limit.

**Floor.** The tier keeps an answer only at 0.85 confidence, inherited from the Ollama
`clef-flash` measurements (same weights). It is not yet measured on Workers AI; re-measure with
`python3 scripts/evaluate-laya.py --backend cloudflare --check`.

`decisions status` shows a `cloudflare` block: `enabled`, `token` (bool), `account` (bool),
`model`, `min_confidence`, and `budget` (`day`, `used`, `cap`, `free_allocation`, `remaining`,
`calls`, `resets_at`, `exhausted`, `refused`). A fork answered here shows as
`cloudflare:clef-flash` in status and history. `--probe` makes one tiny Cloudflare call, only
when the tier is opted in.

## Local fork tier: Ollama

[Ollama](https://ollama.com) serves decision models through `POST /v1/systemone`, the same
System One protocol Jev speaks. It needs no key, and the decision state never leaves the
machine. The one supported model is [`clef-flash`](https://ollama.com/library/clef-flash).
`laya/ollama_models.py` holds the supported list and the facts measured for each model.
Install Ollama 0.35.1 or newer, pull the model, and opt in:

```bash
ollama pull clef-flash
python3 scripts/vistack-decision.py decisions on --ollama-model clef-flash
```

`clef-flash:latest` and `clef-flash:9b` name the same model. `--ollama-model` refuses any
other tag and names the fix; `none` turns the tier off. A model named by an older switch file
or shell profile does not stop the engine: the tier is unavailable on every fork, with the
fix as its reason, and `decisions status` names it too. `decisions on` writes the model to
the switch file, then loads it and reports `ollama.preloaded`. `/vistack:decisions-on` asks
whether to use it and pulls it when the user picks it.

### Place in the ladder

Ollama is last. It answers any fork Jev and Cloudflare left unsettled: unavailable, unsure, or
rejected by a gate. Without them, Ollama leads. Sharp forks never reach it.

### Threshold

`clef-flash` keeps an answer only at 0.85 confidence or higher; the other tiers use the
global 0.65. Its raw answers on all 108 scenarios, before any gate:

| Confidence at least | Answers | Wrong |
|---|---|---|
| 0.65 | 46 | 2 |
| 0.75 | 37 | 1 |
| 0.85 | 23 | 0 |

The wrong answer at 0.827 sent `tier-mismatch`, evidenced complex work, to the mechanical
tier. The policy settles that fork itself, so the model is never asked it, and the tier gate
would reject the move if it were. A fork the scenarios do not cover may have neither guard,
which is what the floor is for. It costs one split fork: `file-override-gate`, answered
correctly at 0.79, stays with the main session.
`--ollama-min-confidence` and `VISTACK_LAYA_OLLAMA_MIN_CONFIDENCE` move the floor; the
stricter of it and `--min-confidence` applies. The evidence is 10 split forks, so re-measure
when the scenario set grows.

### Measurements

Measured on 2026-10-05 on an Apple M3 Pro with 36 GB, Ollama 0.35.1, and `clef-flash:latest`
(Q8_0), warm, on the 108 labelled scenarios in `examples/laya/scenarios.jsonl`. Ten of them
are split forks.

| Ladder | Split forks settled | Wrong | Sharp precision | Sharp coverage | Latency per split fork |
|---|---|---|---|---|---|
| deterministic only | 0 of 10 | 0 | 98 of 98 | 90.7% | under 1 ms |
| `clef-flash` at the global 0.65 | 8 of 10 | 0 | 106 of 106 | 98.1% | 0.88-1.28 s, median 0.98 s |
| `clef-flash` at its 0.85 floor | 7 of 10 | 0 | 105 of 105 | 97.2% | 0.88-1.28 s, median 0.98 s |

At the floor, `tier-unclear`, `tool-inspect-file`, and `file-override-gate` stay split. Jev
then `clef-flash` was not measured, because every Jev call is billed; Jev alone settled 7 of
the 10.

### What it costs

- Disk: 10.9 GB.
- Memory: 14.2 GB while loaded, at the model's default 16,384-token window.
- Load: about 7 s cold. `decisions on` and `serve` pay it before the first fork.
- Time: as Jev's fallback, about 1 s only on the forks Jev did not settle. As the lead tier,
  every split fork pays it.

### Load and keep-alive

Every request carries `keep_alive`, default `30m`. Ollama cancels a model load when the
client disconnects, so a load cannot run in the background and be collected later. A decision
model refuses `POST /api/generate` with HTTP 400 ("does not support generate"), so the load
is one single-question System One call, made only when `/api/ps` shows the model is not
resident. The first decision after the keep-alive window pays the load. It runs before the
per-call timer starts, so it is never charged to the Ollama timeout: 8000 ms by default
(`--ollama-timeout-ms`). A call that exceeds the timeout falls to the next tier.

### State cap and overflow retry

The state sent to Ollama is capped at 6000 characters. The loaded model has its own token
window, 16,384 for `clef-flash` by default. When a prompt exceeds it, Ollama returns HTTP 400
with `prompt 0 has N tokens; expected 1-M`, and the adapter retries once with a smaller
state. A choice question with fewer than 2 options is dropped, because the API requires 2 to
26.

### Confidence scale

Ollama returns `confidence = 1 - H(p) / ln N`, the entropy concentration of the answer
distribution. It is not calibrated correctness. For a two-option choice, p must be about
0.93 to reach 0.65 and about 0.98 to reach 0.85. The scales differ across tiers, so do not
retune `--min-confidence` globally from one tier's numbers.

### Configuration

| Setting | Flag | Environment |
|---|---|---|
| Model tag | `--ollama-model` | `VISTACK_LAYA_OLLAMA_MODEL` |
| Server URL | `--ollama-url` | `VISTACK_LAYA_OLLAMA_URL` |
| Keep-alive | `--ollama-keep-alive` | `VISTACK_LAYA_OLLAMA_KEEP_ALIVE` |
| Timeout (ms) | `--ollama-timeout-ms` | `VISTACK_LAYA_OLLAMA_TIMEOUT_MS` |
| Threshold | `--ollama-min-confidence` | `VISTACK_LAYA_OLLAMA_MIN_CONFIDENCE` |

`OLLAMA_HOST` is honored when no URL is set, with the scheme optional. `decision`, `serve`,
and `evaluate-laya.py` accept the five flags. `--backend ollama` runs Ollama alone, for
evaluation.

## Default-on switch

The integration is enabled by default. That means viStack will ask the decision engine at
the documented decision boundaries when the host contract calls the hook. On a machine
with no configured model, `auto` still returns the deterministic viStack policy, so enabling
the integration does not add a cloud dependency or block a run.

Turn refinement off for the consuming project:

```bash
python3 scripts/vistack-decision.py decisions off
```

Turn it back on or inspect the effective setting:

```bash
python3 scripts/vistack-decision.py decisions on
python3 scripts/vistack-decision.py decisions status
```

The older `laya on|off|status` spelling still works as an alias.

The switch lives in the host's state root: `.claude/vistack/decisions.json` under Claude Code
(detected from `CLAUDECODE`) and `.codex/vistack/decisions.json` elsewhere. Under Claude Code a
switch written earlier to the Codex root is still read until `decisions on` or `decisions off` writes
the Claude one. Before 0.23.0 the file was named `laya.json`; it is still read while no
`decisions.json` sits beside it, and the next `decisions on` or `decisions off` writes
`decisions.json` and removes it. `decision`, `serve`, and the history commands use the same root, so a toggle
and the decisions it governs never disagree. A one-request emergency
override is `--disable-laya`. The environment variable `VISTACK_LAYA_ENABLED=0` disables
refinement for every invocation in that environment and takes precedence over the file.
These switches select deterministic policy; they do not disable viStack routing, state,
evidence, or safety rules.

The same choices can be committed to a machine-local, ignored config file. The file is
created by `decisions on`/`decisions off`; `decisions on --jev --cloudflare --ollama-model clef-flash`
records those fields, and the other fields can be added by the project owner:

```json
{
  "schema_version": 1,
  "enabled": true,
  "jev": true,
  "jev_model": "jev-latest",
  "cloudflare": true,
  "ollama_model": "clef-flash",
  "ollama_url": "http://127.0.0.1:11434",
  "ollama_keep_alive": "30m",
  "fallback": "jev",
  "consult": "split"
}
```

Those are all the keys the file takes. `fallback` is `none`, `jev`, or `cloudflare`, and `consult` is
`split` or `always`. Any other key is left over from a removed tier: it is ignored, and
`decisions on` or `decisions off` drops it when it rewrites the file. `"ollama_model":
"none"` turns the tier off and keeps the other fields. `decisions status` reports what will
actually run: the ladder, the interpreter, whether a Jev key is present or was refused, the
`cloudflare` block, the `ollama` block (`model`, `url`, `reachable`, `version`, `version_ok`, `installed`,
`decision_models`, `supported`, `loaded`, `missing`, `min_confidence`) with a `hint`, the
`obsolete` block (`fields`, `env`) with a top-level `hint`, and the fork tally from the
decision history. `--probe` also sends one question to the Ollama model. That call is local
and free, unlike the billed Jev probe and the Cloudflare probe, which spends Neurons.

Keep this file and `.codex/vistack/decision-history.jsonl` out of version control. An ignored
file is also the safest place for a developer-specific host model choice.

## Command API

Evaluate one decision from a JSON file or stdin:

```bash
python3 scripts/vistack-decision.py decision grooming \
  --context examples/laya/grooming.json \
  --backend auto
```

The supported decision types are:

`intake-analysis`, `grooming`, `playbook-selection`, `decomposition`, `tier-selection`,
`dispatch-readiness`, `runtime-progress`, `verification`, `skill-improvement`,
`tool-selection`, and `file-selection`. The last two choose among options the caller lists
in `available_actions`, described by `task.tools` or `task.file_summaries`.

Tally the forks recorded in the history — per type, how many ran in code and who answered:

```bash
python3 scripts/vistack-decision.py forks
```

For repeated orchestration events, keep the model resident:

```bash
python3 scripts/vistack-decision.py serve --backend auto
```

The server loads the configured Ollama model before reading the first request, and the load
is not charged to the per-call timeout. A backend that fails twice in a row is skipped for 30
seconds, so an outage costs one connect or inference timeout per window rather than one per
decision.

Use `--timeout-ms` to bound a Jev call; the default is 2000 ms. The Ollama tier keeps its
own budget, `--ollama-timeout-ms`. A timeout returns the deterministic fallback. Set it to `0` only when the caller supplies its own process-level
timeout.

The server reads one JSON request per line and writes one response per line. A request may
include an `id`; reusing that id makes history recording idempotent across retries.

```json
{"id":"req-42","decision_type":"runtime-progress","context":{"task":{"request":"Finish the slice"},"current_state":{"phase":"implementing"}}}
```

## Schema

`DecisionContext` has these fields:

```json
{
  "schema_version": "1",
  "decision_type": "grooming",
  "task": {
    "request": "Add the adapter",
    "acceptance_criteria": ["returns typed JSON"],
    "finish_condition": "unit tests pass"
  },
  "playbook": null,
  "current_state": {"phase": "planned"},
  "evidence": [{"kind": "test", "ref": "tests/laya.txt", "summary": "12 tests pass"}],
  "constraints": {"parallelizable": false},
  "history": [],
  "available_actions": []
}
```

Every response is a `Decision` with `decision_id`, `decision_type`, `action`, bounded
`confidence`, concise `rationale`, `evidence_considered`, `risks`, `required_evidence`,
`alternatives`, `change_conditions`, machine-readable `outputs`, probability data, backend,
and fallback metadata, and `fork`: `sharp` runs in code, `split` goes to the main session.
`authority` is always `advisory-only`.

### Inputs the deterministic policy reads

Routing scores word-boundary signals for each task class. The request, title, description,
and summary carry full weight; acceptance criteria, briefs, and other task values carry about
a third, so a criterion such as "no failures in the console" cannot reroute a feature. The
playbook-selection decision reports `outputs.route_source`: `state` (blocked, paused, or at
QA), `handoff` (an explicit overnight or autopilot request), `signals`, or `default`. A model
may not change a `state` or `handoff` route or invent an unattended one.

| Decision type | Optional fields | Effect |
|---|---|---|
| `grooming` | `task.open_questions`, `task.estimated_changed_lines` | Open questions return `needs-decision`; an estimate above 500 returns `split`. |
| `decomposition` | `task.slices[].files`, `task.slices[].depends_on`, `task.dependencies` | Overlapping slice files or a dependency return `sequence`; `outputs.shared_files` names the overlap. Textual estimates such as `"about 300"` are parsed. |
| `tier-selection` | `task.pattern`, `task.changes_data_shape`, `task.changes_public_contract`, `task.crosses_boundary`, `current_state.tier_mismatch` | A reported mismatch, a flag, or complex-work terms in the request return `complex` with `outputs.role` `senior-implementer`. Mechanical terms or a named pattern return `mechanical` with `implementer`. Neither returns `complex` below the refinement threshold, a split fork a model may settle either way; a model never lowers evidenced complex work. |
| `tool-selection`, `file-selection` | `available_actions` (required), `task.tools` or `task.file_summaries`, `current_state.failed_tools` or `failed_files` | One option, or a request that names exactly one option (a file by path or basename), is sharp. Anything else is split with the first unfailed option as a placeholder. An option whose name or description is irreversible (merge, production deploy, data deletion) is never chosen in code or by a model. Choices are capped at 10 options. |
| `runtime-progress` | `current_state.attempts`, `identical_results`, `unblock_exhausted`, `next_action`, `credentials_missing`, `credentials_expired`, `contract_ambiguity` | Each fence returns `escalate` with `outputs.fence` set to 1-4. Twenty attempts or three identical results is FENCE 1; an irreversible `next_action` such as a merge is FENCE 3. |
| `verification` | `evidence[].criterion`, `evidence[].status` | `criterion` (1-based index or exact criterion text) covers that criterion only. `status` `fail` or a summary such as `3 tests failed` returns `request-evidence`; `status` `unavailable` returns `block`. Duplicate refs count once. `outputs.uncovered_criteria` lists the gaps. |

Rationales name the matched terms or the missing fields, and `alternatives` names the
runner-up route when one matched.

Version 0.14.0 added the `html-report` route and 28 playbook-selection scenarios (8 page
requests, 20 guards), 108 in total. Deterministic sharp precision stayed 1.0 and sharp
coverage moved from 0.875 to 0.907. Only a request for a page routes there: building a chart
or board inside the product stays on its own route. "The overnight run" after of, about, or
from is a reference to a run, not an overnight handoff.

## Integration points

Use the hook only when a choice affects the workflow path.

| viStack owner | Decision type | Deterministic authority |
|---|---|---|
| router and groomer | intake analysis, grooming | readiness fields and fence rules |
| router | playbook selection | the route table in `skills/vistack/SKILL.md` |
| planner | decomposition | 500-line limit, file ownership, conflict matrix |
| planner | tier selection | the tier rule in `agents/planner.md` |
| coordinator | dispatch readiness, runtime progress | state transitions, dependencies, monitor and ledger rules |
| QA verifier | verification | captured artifacts tied to acceptance criteria |
| implementer, unblocker | tool selection, file selection | the slice's writable files and the fence rules |
| feedback review | skill improvement | explicit human review of historical patterns |

The caller validates the result before acting. A recommendation is not a permission to
dispatch, merge, push, deploy, delete, change secrets, or bypass a fence.

## Fork layer

Laya takes the forks that need no thinker, so the main session spends its reasoning where it
changes the outcome.

| Fork | Decision type |
|---|---|
| which playbook | `playbook-selection` |
| which file goes to which slice; serialize or parallelize | `decomposition` |
| which tier: mechanical or complex | `tier-selection` |
| dispatch or hold | `dispatch-readiness` |
| retry, rescope, or stop | `runtime-progress` |
| accept or ask for more evidence | `verification` |
| which tool the next step uses | `tool-selection` |
| which file the next step opens or changes | `file-selection` |

Every `Decision` carries `fork`. It is **sharp** when the returned action is valid, its
confidence meets the configured threshold, and every safety gate accepts it, whether the
deterministic policy or a ladder tier produced it. A sharp fork is applied in code and its
decision id is recorded. Any other fork is **split**: the main session decides it and records
why. Judge a decision type sharp from held-out scenario precision and coverage, not from
confidence alone: `evaluate-laya.py` counts a wrong sharp fork as an error and a split fork
as a deferral.

Laya never calls the advisor. The advisor's three checkpoints — before a plan, on a
repeating error, before done — are not forks (`skills/advisor/SKILL.md`).

## History and human overrides

The CLI records JSONL history at `.codex/vistack/decision-history.jsonl` by default. Pass a
different `--history` path for Claude state or a project-specific location. Add that path to
the consuming repository's ignore rules. Sensitive-looking fields are redacted before they
are written.

Record feedback without editing the skill:

```bash
python3 scripts/vistack-decision.py override dec_123 pause \
  --recommended-action continue \
  --reason "The lane reached a safe stop before the next irreversible step."
python3 scripts/vistack-decision.py outcome dec_123 completed --evidence test-output.txt
python3 scripts/vistack-decision.py feedback --history .codex/vistack/decision-history.jsonl
```

The feedback command reports repeated overrides and proposes a review. It never edits a
skill or playbook. A proposal must cite decision IDs and be applied as an explicit,
reviewable workflow change.

## Fallback and failure behavior

The engine returns the deterministic policy result when the configured refinement backends
are missing, cannot load, time out, return malformed output, fall below the confidence
threshold, or fail a safety gate. If configured, the order is opted-in Jev, opted-in Cloudflare, the local Ollama
model, then deterministic policy. The sidecar also converts malformed JSONL requests into an
error response and keeps serving subsequent requests.

viStack must continue when the sidecar is unavailable. A coordinator can omit the hook and
follow the existing playbook, state, ledger, and evidence contracts.

## Measuring

Latency and correctness come from one run over the labelled scenarios in
`examples/laya/scenarios.jsonl`:

```bash
python3 scripts/evaluate-laya.py --check
python3 scripts/evaluate-laya.py --backend ollama --ollama-model clef-flash --fallback none --raw
```

The report includes sharp precision, sharp coverage, per-type counts, every sharp mismatch,
and `assisted_ms` for each scenario. `--check` exits non-zero on a mismatch, and the unit
suite runs the same check for the deterministic policy. `--raw` also scores each tier's
first answer before any gate. The first split fork a cold model answers includes the load,
about 7 s for `clef-flash`, so read warm latency from the others.

On 2026-09-29 the 80 labelled scenarios gave: deterministic policy alone, 70 sharp forks,
all right (87.5% coverage); with Jev, 77 sharp, all right (96.25% coverage), the remaining
three split. Before two tool labels were made unambiguous, Jev picked `grep` for both at 0.99
confidence — the confidence gave no warning. On 2026-10-05, on 108 scenarios, `clef-flash`
alone settled 7 of the 10 split forks at its floor, none wrong; the table is in the Ollama
section. Add a scenario for every corrected decision, and compare deterministic policy, model
recommendation, human choice, and final outcome before raising the confidence threshold or
enabling more automatic refinement.

A deterministic decision is policy and serialization only. On 2026-09-22, 25 decisions took
a warm p50 of 0.025 ms and a p95 of 0.054 ms, with a peak process RSS of 30,688 KB. With
history enabled, 3000 decisions took 23.0 s before the history index change and 0.56 s after
it; the mean of the last 100 appends fell from 16.0 ms to 0.20 ms.
`laya/tests/test_performance.py` holds the append cost flat.

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

## Adding a decision type

1. Add the stable name and legal actions to `laya/schema.py`.
2. Add a deterministic policy branch in `laya/policy.py` with evidence and safety conditions.
3. Add a bounded typed question schema in `laya/questions.py`.
4. Map the typed result and add a safety gate in `laya/engine.py`.
5. Add unit tests for valid, malformed, unavailable-runtime, low-confidence, and fence cases.
6. Add the integration owner and fallback rule to this document and the relevant role contract.

Keep execution in viStack. A new decision type is complete only when its deterministic
fallback and evidence predicate are independently testable.

## Known limitations

- `clef-flash` holds 14.2 GB of memory while loaded, and the first decision after the
  keep-alive window pays a load of about 7 s.
- The 0.85 floor rests on 10 split forks and 46 raw answers. A wrong answer above it is
  possible on forks the scenarios do not cover; the safety gates still apply.
- The 6000-character state cap is sized for prose. Token-dense evidence such as hashes or hex
  dumps reached about 4,400 tokens at 5,300 characters, and an earlier 9B decision model took
  14.6 s on it uncached, past the 8000 ms budget; `clef-flash` was not measured on such
  input. A fork that times out falls to the next tier; two in a row pause the Ollama tier for
  30 seconds in a long-lived server. Summarize such evidence before it reaches a decision
  context.
- Jev is hosted and opt-in; it can incur a small cost and it receives the redacted decision
  state.
- Cloudflare is hosted and opt-in; it receives the redacted decision state and spends free
  daily Neurons, capped at 9,000 by default.
- `clef-flash` is not fine-tuned on viStack outcomes; its answers are held to the safety
  gates and its own floor.
- Choice quality can degrade with large option sets, so question schemas keep choices small
  and route candidates are prefiltered.
- Confidence is used as a safety threshold, not as proof of correctness.
- The feedback loop proposes changes; it does not train weights or modify workflow files.

## Removed in 0.22.0

Version 0.22.0 kept two refinement tiers: hosted Jev and the local Ollama `clef-flash`; 0.23.0 adds
opt-in Cloudflare Workers AI `@cf/cloudflare/clef-flash` between them. Version 0.22.0
removed the Clef server that ran the Hugging Face weights in its own environment, the
in-process Laya checkpoint runtime and its setup command, the separately run local decision
server tier, the host CLI tier, and the earlier Ollama decision models.

A switch file or shell profile that still carries their settings keeps working: the settings
are ignored. `decisions status` lists the leftover switch-file keys under `obsolete.fields`
and the leftover `VISTACK_LAYA_` variables under `obsolete.env`, with a top-level `hint` that
says how to clear them. `decisions on` or `decisions off` rewrites the file without them. A
switch file that names an earlier Ollama model leaves the tier in the ladder as unavailable,
and `ollama.hint` names `decisions on --ollama-model clef-flash`.

Their downloads are not removed for you. Delete them by hand when you no longer need them:
`~/.cache/vistack/clef-venv`, `~/.cache/vistack/laya-venv`, and the Clef and Laya model
folders in the Hugging Face cache (`~/.cache/huggingface/hub` unless `HF_HOME` or
`HF_HUB_CACHE` moves it). `ollama rm <tag>` removes a pulled Ollama model.
