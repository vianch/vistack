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
                  refinement ladder: Jev (opt-in) -> Ollama (local) -> Laya-MLX -> Kev -> host CLI (opt-in)
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

Otherwise the next tier is asked, so Ollama answers any fork the tier before it left
unsettled, whether that tier was unavailable, unsure, or rejected by a gate. After the last one the deterministic result is
returned with `fallback_used: true`, a reason, and `fork: split`. When a tier agrees with the
policy's own lean, the decision keeps the policy's rationale and the higher confidence.

Models do not re-read sharp forks because, on the labelled scenarios, every time hosted Jev
overrode a confident deterministic answer the override was wrong (6 of 6), and deterministic
accuracy fell from 100% to 91%. `--consult always` still asks the ladder on sharp forks and
records its answer in `outputs.model_opinion` for evaluation, without applying it.

## Runtime research

The integration follows the public interfaces rather than assuming that the original and
MLX implementations are interchangeable.

| Reference | Finding used here |
|---|---|
| [laya-mlx README](https://github.com/mizorewww/laya-mlx#readme) | `laya.load(...).predict(state, questions)` accepts text or JSON state and typed `choice`, `score`, and `noul` questions. |
| [laya-mlx agent API](https://raw.githubusercontent.com/mizorewww/laya-mlx/main/laya_mlx/agent.py) | Results contain `answers`, per-answer probabilities and confidence, and zero output tokens. The loaded `Agent` is reusable. |
| [laya-mlx package metadata](https://raw.githubusercontent.com/mizorewww/laya-mlx/main/pyproject.toml) | MLX requires Apple Silicon/macOS and Python 3.11 or newer; NumPy, Hugging Face Hub, and tokenizers are runtime dependencies. |
| [original Laya README](https://github.com/NandhaKishorM/laya#readme) | The original SDK exposes the same typed question primitives and a router, but its checkpoint loading and runtime are separate from MLX. |
| [Laya model card](https://huggingface.co/convaiinnovations/laya) | The model is a bidirectional decision model, not a text generator. Choice options share a context budget and confidence is not a guarantee of correctness. |
| [MLX checkpoint card](https://huggingface.co/aac6fef/laya-mlx) | The published MLX weights preserve the upstream checkpoint format but are an independent port. |
| [TypeSafe API](https://docs.typesafe.ai/api) | Jev serves the same System One protocol at `POST https://api.typesafe.ai/v1/systemone` with a bearer key. Jev 1.13 costs $0.042 per million input tokens; output tokens are free. |
| [Ollama System One API](https://docs.ollama.com/api/systemone) | Ollama serves the same System One protocol at `POST /v1/systemone`, with no key. |
| [Ollama decision capability](https://docs.ollama.com/capabilities/decision) | Decision models answer typed questions instead of generating text; choice questions take 2 to 26 options. |
| [Ollama decision models announcement](https://ollama.com/blog/ollama-now-supports-jev-style-decision-models) | Ollama loads a decision model like any other and keeps it resident for the `keep_alive` window. |
| [`nimble` on Ollama](https://ollama.com/library/nimble) | A 9B decision model from Bespoke Labs, fine-tuned from Qwen3.5-9B, Apache 2.0, 9.5 GB at q8_0, 8,192-token loaded window, text only. |
| [`tev1` on Ollama](https://ollama.com/library/tev1) | `tev1:0.8b` is an experimental decision model from Together AI, fine-tuned from Qwen3.5: 752M parameters, 812 MB, about 2,048-token window, trained on 2 to 24 options. Plain `tev1` is the 4B model. |
| [TypeSafe patterns](https://docs.typesafe.ai/patterns) | Keep deterministic work in code, ask narrow independent questions, and gate actions on confidence per consequence. |

The model is not trained on viStack-specific outcomes, so historical overrides and final
outcomes are recorded for evaluation rather than treated as automatic retraining data.

### Runtime and checkpoint choice

**Runtime: `laya-mlx`, not the upstream `laya` package.** Both load the same Convai
Innovations weights; `laya-mlx` reports 63/63 argmax parity with the upstream model at FP16.
`laya-mlx` needs only MLX, NumPy, `huggingface_hub`, and `tokenizers`, and imports as
`laya_mlx`. The upstream package pulls in PyTorch and Transformers, and it imports as `laya` —
the same name as viStack's own `laya/` package, which shadows it on `sys.path`. Upstream is
therefore reachable only out of process (`laya-serve`, whose `POST /predict` is a different
protocol). Upstream's hooks, schema-driven `decide`, and LangChain components are in-process
Python conveniences; viStack's typed questions, gates, and history already cover what they
would add here. `laya-mlx` is an independent beta port, so pin it in the runtime venv.

**Checkpoint: `convaiinnovations/laya` (English, the repository root).** Measured on this
guide's 67 labelled scenarios on 2026-09-29 (M3-class Mac, FP16, raw answers before gates):

| Checkpoint | Raw accuracy | Correct when confidence ≥ 0.65 | Warm p50 |
|---|---|---|---|
| `convaiinnovations/laya` | 53.7% | 5 of 5 | 54 ms |
| `convaiinnovations/laya/multilingual` | 40.3% | 9 of 13 | 23 ms |
| `convaiinnovations/laya/typed-decisions` | 52.2% | never confident | 56 ms |
| hosted `jev-latest` | 67.2% | 34 of 41 | 342 ms |

The English checkpoint is the only local one whose confident answers were all right. The
multilingual checkpoint overrode correct answers with confidence above 0.9, and the
typed-decisions fine-tune never cleared any threshold. Jev is the strongest reader but is
over-confident: its precision stayed between 83% and 89% at every threshold from 0.65 to
0.95, which is why the gates, not a higher threshold, protect sharp forks. Name a bundled
checkpoint as `owner/repo/subfolder`.

## Requirements and installation

The deterministic engine needs only Python 3.11 or newer and the standard library. It runs
on the same machines that run the plugin and is the default when no model is configured.

For local MLX inference on Apple Silicon, let viStack build a dedicated runtime. A system
Python is often externally managed (PEP 668) and refuses `pip install`:

```bash
python3 scripts/vistack-decision.py decisions setup --dry-run   # show the plan
python3 scripts/vistack-decision.py decisions setup             # venv + laya-mlx + checkpoint
export VISTACK_LAYA_MODEL=convaiinnovations/laya
export VISTACK_LAYA_PYTHON="$HOME/.cache/vistack/laya-venv/bin/python"
```

`setup` creates a Python 3.12 venv in `~/.cache/vistack/laya-venv` (with `uv` when present),
installs `laya-mlx`, and downloads the checkpoint once, about 850 MB. Every entry script —
`vistack-decision.py`, `evaluate-laya.py`, `benchmark-laya.py` — re-executes itself in that
venv when the current interpreter cannot import `laya_mlx`, so hosts keep calling plain
`python3`. `VISTACK_LAYA_PYTHON` pins another interpreter. Inference after the download is
local; use a local checkpoint directory instead of a Hub id when network access is not wanted.

The model is not downloaded implicitly by `--backend auto`; auto mode stays deterministic
unless `VISTACK_LAYA_MODEL`, `--model`, an Ollama model, a Kev URL, or Jev is configured.

## Local model fallback: Kev

[Kev](https://github.com/jaredpalmer/kev) is worth using as a local fallback, not as a
replacement for the primary Laya-MLX path. It speaks the same decision vocabulary — typed
`choice`, `noul`, and `score` answers — and exposes a small localhost HTTP server, so this
plugin can use it without importing PyTorch into the viStack process. Kev currently offers
0.8B, 4B, and 9B checkpoints and supports Apple Silicon. Its published Mac measurements are
about 329 ms for Kev-0.8B, 779 ms for Kev-4B, and about 2 seconds for Kev-9B on the documented
five-question request; the older Qwen3 checkpoints are faster on a Mac today. Those numbers
are Kev's upstream measurements, not a viStack benchmark. See the [Kev model and API
documentation](https://github.com/jaredpalmer/kev#readme).

Run Kev separately, then configure it as the local fallback:

```bash
KEV_DTYPE=bf16 uv run --extra serve python -m kev.serve \
  --run jaredpalmer/kev-0.8b --port 8009

python3 scripts/vistack-decision.py decision grooming \
  --context examples/laya/grooming.json \
  --backend auto --kev-url http://127.0.0.1:8009 --fallback kev \
  --kev-model kev-latest
```

With a configured Laya-MLX model, the order is Laya-MLX, Kev, then deterministic policy,
after Jev and Ollama when they are opted in.
Without Laya-MLX, `--backend auto --kev-url ...` uses Kev directly. If Kev is not running,
the deterministic policy still returns a decision. No local server is contacted unless its
URL is configured, and `--fallback none` keeps the primary tier only.

## Hosted fork tier: Jev

[Jev](https://docs.typesafe.ai/models) is TypeSafe's hosted System One model. It answers the
same typed questions as Laya and Kev. On the labelled scenarios it settled 7 of the 10 split
forks, all correctly, and left the other 3 split for the main session. It is opt-in, because
it sends the bounded, redacted decision state to TypeSafe:

```bash
python3 scripts/vistack-decision.py decisions on --jev   # this project
export VISTACK_LAYA_JEV=1                               # every project in this shell
```

The key is read from `TYPESAFE_API_KEY`, then `TYPESAFE_KEY`, and never written to a file. An
opted-in Jev leads the ladder: it answers a split fork in about 350 ms warm and about 0.5 s
from a cold CLI call, and the local checkpoint then loads only when Jev cannot answer.
Without Jev, the local tiers lead, Ollama first when it is configured. TypeSafe publishes no balance endpoint, so a 401, 402, or
403 is taken to mean the key or credits are gone: Jev is skipped for an hour, recorded in
`~/.cache/vistack/jev-status.json`, and the local tiers answer instead. A 429 or 529 is a
normal transient failure. `decisions status --probe` makes one single-question call to
prove the key and remaining credits. That call is billed.

The TypeSafe agent skill is not installed: both of its install paths clone from a GitHub
organisation outside the allowed origin realm. This adapter follows the published API
documentation instead.

## Local fork tier: Ollama

[Ollama](https://ollama.com) serves decision models through `POST /v1/systemone`, the same
System One protocol Jev speaks. It needs no key, and the decision state never leaves the
machine. Install Ollama, pull a decision model, and opt in:

```bash
ollama pull nimble
python3 scripts/vistack-decision.py decisions on --ollama-model nimble
```

`--ollama-model none` turns the tier off. `decisions on` writes the model to the switch file,
then preloads it and reports `ollama.preloaded`. `/vistack:decisions-on` lists the installed
decision models and asks which one to use.

### Place in the ladder

Ollama sits after Jev and before Laya-MLX. It answers any fork the tier before it left
unsettled: Jev unavailable, unsure, or rejected by a gate. Without Jev, Ollama leads. Sharp
forks never reach it.

### Measurements

Measured on 2026-09-30 on an Apple Silicon Mac with 36 GB, Ollama 0.35.0, warm, on the 80
labelled scenarios in `examples/laya/scenarios.jsonl`. Ten are split forks. Threshold 0.65.

| Ladder | Split forks settled | Wrong sharp forks | Sharp precision | Sharp coverage | Latency per split fork |
|---|---|---|---|---|---|
| deterministic only | 0 of 10 | 0 | 70 of 70 | 87.5% | under 1 ms |
| `tev1:0.8b` alone | 0 of 10 | 0 | 70 of 70 | 87.5% | about 0.2 s |
| `nimble` alone | 8 of 10 | 1 | 77 of 78 | 97.5% | 1.0-1.7 s, median 1.3 s |
| Jev, then `nimble` | 8 of 10 (Jev 7, `nimble` 1) | 0 | 78 of 78 | 97.5% | Jev 0.27-0.56 s; `nimble` only on forks Jev left unsettled |

Raw accuracy before gates was 63.6% for `tev1:0.8b` (77 answered) and 69.2% for `nimble` (78
answered). With the 8000 ms Ollama budget neither model timed out; under the engine's 2000 ms
default `nimble` had timed out 11 times on the three-question intake and grooming schemas. The one wrong `nimble` fork is `file-user-docs`
("Document the new switch for users"). It went to `laya/config.py` at confidence 0.906,
because both local models keyed on "switch" in that file's description. Jev picked the guide
at 0.91. A higher threshold would not have caught it. `tev1:0.8b` never reached 0.65 on any
split fork (highest 0.646), so on these scenarios it adds latency and settles nothing.

### What it costs

- As Jev's fallback, `nimble` adds 1 to 4 s only on the forks Jev did not settle.
- As the lead tier, every split fork pays 1 to 4 s.
- `nimble` holds about 9.5 GB of memory while loaded.

### Load and keep-alive

Every request carries `keep_alive`, default `30m`. Ollama 0.35.0 cancels a model load when
the client disconnects, so a load cannot run in the background and be collected later. The
first decision after the keep-alive window pays the load: about 1.3 s when the weights are in
the OS file cache and about 20 s from disk. `decisions on` preloads the model so the first
real decision is warm. The load runs before the per-call timer starts, so it
is never charged to the Ollama timeout: 8000 ms by default (`--ollama-timeout-ms`). A call
that exceeds the timeout falls to the next tier.

### State cap and overflow retry

The state sent to Ollama is capped at 6000 characters. A loaded model has its own token
window (8,192 for `nimble`, about 2,048 for `tev1:0.8b`). When a prompt exceeds it, Ollama
returns HTTP 400 with `prompt 0 has N tokens; expected 1-M`, and the adapter retries once
with a smaller state. A choice question with fewer than 2 options is dropped, because the API
requires 2 to 26.

### Confidence scale

Ollama returns `confidence = 1 - H(p) / ln N`, the entropy concentration of the answer
distribution. It is not calibrated correctness. For a two-option choice, `nimble` needs
p of about 0.94 to reach 0.65. The scales differ across tiers, so do not retune
`--min-confidence` globally from one tier's numbers.

### Configuration

| Setting | Flag | Environment |
|---|---|---|
| Model tag | `--ollama-model` | `VISTACK_LAYA_OLLAMA_MODEL` |
| Server URL | `--ollama-url` | `VISTACK_LAYA_OLLAMA_URL` |
| Keep-alive | `--ollama-keep-alive` | `VISTACK_LAYA_OLLAMA_KEEP_ALIVE` |
| Timeout (ms) | `--ollama-timeout-ms` | `VISTACK_LAYA_OLLAMA_TIMEOUT_MS` |

`OLLAMA_HOST` is honored when no URL is set, with the scheme optional. `decision`, `serve`,
and `evaluate-laya.py` accept the four flags. `--backend ollama` runs Ollama alone, for
evaluation.

## Cost-aware host fallback

When both local model paths are unavailable, an explicitly configured host fallback can ask
the current CLI for typed answers. This is not enabled by merely turning Laya on, because it
may incur provider usage and moves the bounded, redacted context off the machine. Enable it
only when that trade-off is acceptable:

```bash
# Claude Code: use the current active Haiku model, with low effort.
python3 scripts/vistack-decision.py decision grooming \
  --context examples/laya/grooming.json --backend auto \
  --fallback host-llm --host claude \
  --host-model claude-haiku-4-5-20251001 --effort low

# Codex: use the current cost-efficient mini profile at low reasoning effort.
python3 scripts/vistack-decision.py decision grooming \
  --context examples/laya/grooming.json --backend auto \
  --fallback host-llm --host codex --host-model gpt-5.4-mini --effort low
```

The Claude adapter uses print mode, plan permissions, no session persistence, one turn, and
a small budget cap. The Codex adapter uses an ephemeral, read-only `codex exec` session and
low reasoning effort. Both accept only typed JSON answers, and the same deterministic safety
gates still decide whether an answer can be consumed. Configure the host and model through
`VISTACK_LAYA_HOST`, `VISTACK_LAYA_HOST_MODEL`, and `VISTACK_LAYA_FALLBACK` when using a
long-lived server.

The model identifiers are deliberately configurable. Anthropic publishes its active
Haiku model and deprecation list in its [CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
and [model lifecycle documentation](https://docs.anthropic.com/en/docs/about-claude/model-deprecations).
OpenAI's current model documentation describes `gpt-5.4-mini` as a high-volume, cost-efficient
model with low reasoning effort support; check the [current model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
and set `VISTACK_LAYA_HOST_MODEL` to the cheapest model actually available to the account.
This avoids baking a rapidly changing provider roster into viStack.

## Default-on switch

The integration is enabled by default. That means viStack will ask the decision engine at
the documented decision boundaries when the host contract calls the hook. On a machine
without `laya-mlx` or a configured model, `auto` still returns the deterministic viStack
policy, so enabling the integration does not add a cloud dependency or block a run.

Turn refinement off for the consuming project:

```bash
python3 scripts/vistack-decision.py decisions off
```

Turn it back on or inspect the effective setting:

```bash
python3 scripts/vistack-decision.py decisions on
python3 scripts/vistack-decision.py decisions status
```

The old `laya on|off|status|setup` spelling still works as an alias.

The switch lives in the host's state root: `.claude/vistack/laya.json` under Claude Code
(detected from `CLAUDECODE`) and `.codex/vistack/laya.json` elsewhere. Under Claude Code a
switch written earlier to the Codex root is still read until `decisions on` or `decisions off` writes
the Claude one. `decision`, `serve`, and the history commands use the same root, so a toggle
and the decisions it governs never disagree. A one-request emergency
override is `--disable-laya`. The environment variable `VISTACK_LAYA_ENABLED=0` disables
refinement for every invocation in that environment and takes precedence over the file.
These switches select deterministic policy; they do not disable viStack routing, state,
evidence, or safety rules.

The same choices can be committed to a machine-local, ignored config file. The file is
created by `decisions on`/`decisions off`; `decisions on --model <id> --jev --ollama-model <tag>`
records those fields, and the other backend fields can be added by the project owner:

```json
{
  "schema_version": 1,
  "enabled": true,
  "model": "convaiinnovations/laya",
  "jev": true,
  "ollama_model": "nimble",
  "ollama_url": "http://127.0.0.1:11434",
  "ollama_keep_alive": "30m",
  "fallback": "kev",
  "kev_url": "http://127.0.0.1:8009",
  "kev_model": "kev-latest",
  "host": "codex",
  "host_model": "gpt-5.4-mini"
}
```

`"ollama_model": "none"` turns the Ollama tier off and keeps the other fields. `decisions
status` reports what will actually run: the ladder, the interpreter, whether `laya_mlx`
imports, whether the checkpoint is cached, whether a Jev key is present or was refused, the
`ollama` block (`model`, `url`, `reachable`, `version`, `installed`, `decision_models`,
`loaded`, `missing`) with a `hint`, and the fork tally from the decision history. `--probe`
also sends one question to the Ollama model. That call is local and free, unlike the billed
Jev probe.

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

The server loads configured local models before reading the first request. Model load is
not charged to the per-call timeout, and a failed load is remembered instead of retried on
every request. A backend that fails twice in a row is skipped for 30 seconds, so an outage
costs one connect or inference timeout per window rather than one per decision.

Use `--timeout-ms` to bound an MLX call; the default is 2000 ms. A backend with its own
budget keeps it: Ollama uses `--ollama-timeout-ms` and the host CLI at least 5000 ms. A timeout returns the
deterministic fallback. Set it to `0` only when the caller supplies its own process-level
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
threshold, or fail a safety gate. If configured, the order is opted-in Jev, local Ollama,
Laya-MLX, local Kev, explicit host CLI, then deterministic policy. The sidecar also converts malformed
JSONL requests into an error response and keeps serving subsequent requests.

viStack must continue when the sidecar is unavailable. A coordinator can omit the hook and
follow the existing playbook, state, ledger, and evidence contracts.

## Benchmarking

Run the standard-library benchmark on the current machine:

```bash
python3 scripts/benchmark-laya.py --backend deterministic --runs 25
python3 scripts/benchmark-laya.py --backend mlx --model "$VISTACK_LAYA_MODEL" --runs 25
```

The first command is portable. The second requires Apple Silicon, MLX, and a locally
available checkpoint. The output reports cold-start time, warm p50/p95/mean, process RSS,
and CPU time. MLX GPU utilization is runtime-dependent and is not inferred from CPU time.

The benchmark is deliberately separate from correctness tests. A latency result does not
show that a decision is accurate for viStack. The labelled scenarios in
`examples/laya/scenarios.jsonl` are the correctness check:

```bash
python3 scripts/evaluate-laya.py --check
python3 scripts/evaluate-laya.py --backend mlx --model "$VISTACK_LAYA_MODEL"
python3 scripts/evaluate-laya.py --backend ollama --ollama-model nimble --fallback none --raw
```

The report includes sharp precision, sharp coverage, per-type counts, and every sharp
mismatch; `--check` exits non-zero on one, and the unit suite runs the same check for the
deterministic policy. `--raw` also scores each tier's first answer before any gate.

On 2026-09-29 the 80 labelled scenarios gave: deterministic policy alone, 70 sharp forks, all
right (87.5% coverage); with `convaiinnovations/laya`, unchanged, because it cleared the
threshold on none of the ten split forks; with Jev, 77 sharp, all right (96.25% coverage),
the remaining three split. Before two tool labels were made unambiguous, Jev picked `grep`
for both at 0.99 confidence — the confidence gave no warning. On 2026-09-30, with Ollama 0.35.0, `nimble` alone settled 8 of the 10 split forks with one
wrong sharp fork (`file-user-docs`, confidence 0.906), and Jev then `nimble` settled 8 with none
wrong; the table is in the Ollama section. Add a
scenario for every corrected decision, and compare deterministic policy, model
recommendation, human choice, and final outcome before raising the confidence threshold or
enabling more automatic refinement.

The deterministic benchmark run in this repository on 2026-09-22 used 25 decisions and
reported cold start `0.013 ms`, warm p50 `0.025 ms`, warm p95 `0.054 ms`, warm mean
`0.033 ms`, and maximum process RSS `30688 KB`. This is policy and serialization latency;
it is not an MLX model-load or GPU inference measurement. With history enabled, 3000
decisions took 23.0 s before the history index change and 0.56 s after it; the mean of the
last 100 appends fell from 16.0 ms to 0.20 ms. No MLX checkpoint was installed in
that run, so the MLX benchmark remains a machine-specific follow-up.

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

- The MLX runtime is optional and currently targets Apple Silicon/macOS. A cold CLI call
  that has to load the local checkpoint takes about 0.7 s; keep `serve` running for repeated
  local decisions.
- `nimble` holds about 9.5 GB of memory while loaded, and the first decision after the
  keep-alive window pays a model load of about 1.3 s to 20 s.
- `tev1:0.8b` settled none of the measured split forks at the default threshold, so on these
  scenarios it adds latency and no answers.
- When `nimble` answers alone, a wrong sharp fork is possible: it sent `file-user-docs` to the
  wrong file at confidence 0.906, and a higher threshold would not have caught it. Jev ahead of
  it removed that error on the measured scenarios.
- The 6000-character state cap is sized for prose. Token-dense evidence such as hashes or hex
  dumps reached about 4,400 tokens at 5,300 characters, and `nimble` then took 14.6 s
  uncached, past the 8000 ms budget. That fork falls to the next tier; two in a row pause the
  Ollama tier for 30 seconds in a long-lived server. Summarize such evidence before it
  reaches a decision context.
- Jev is hosted and opt-in; it can incur a small cost and it receives the redacted decision
  state.
- Kev is a separate local service; it is not installed by this plugin and its current Qwen3.5
  server path is slower on Apple Silicon than the older Qwen3 checkpoints.
- Host-LLM fallback is opt-in and can incur cost or transmit redacted decision context to the
  configured provider. It is never selected implicitly by `decisions on`.
- The default English checkpoint is not a viStack-fine-tuned model, and on these scenarios
  it answered no split fork confidently.
- Laya choice quality can degrade with large option sets, so question schemas keep choices
  small and route candidates are prefiltered.
- Confidence is used as a safety threshold, not as proof of correctness.
- The feedback loop proposes changes; it does not train weights or modify workflow files.
