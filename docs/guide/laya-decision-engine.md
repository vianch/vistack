# Local decision engine

The local decision engine is an advisory subsystem for viStack. It returns typed
recommendations for orchestration decisions. It does not dispatch agents, create worktrees,
change state, merge pull requests, or replace the deterministic rules in the playbooks.

## Architecture

```text
viStack context
    |
    v
DecisionContext -> deterministic policy -> refinement ladder -> safety gate -> typed Decision
                         ^                 |       |       |                         |
                         |                 |       |       |                         v
                         |              Laya MLX  Kev  host CLI                 coordinator
                         |                 (local) (local) (opt-in)
                         +------------------- deterministic fallback
```

The implementation lives in `laya/`. The command-line adapter is
`scripts/vistack-decision.py`. A caller may use the library directly or keep one process
alive with the JSONL server.

The deterministic policy is always evaluated first. A configured refinement backend can
refine the recommendation only when all of these checks pass:

1. The answer is a valid typed answer for the decision type.
2. The action is in the caller's available action set.
3. Confidence meets the configured threshold.
4. The result does not violate deterministic readiness, dependency, evidence, or
   shared-file gates.

Otherwise the deterministic result is returned with `fallback_used: true` and a reason.

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

The initial adapter uses the English checkpoint when configured. The model is not trained on
viStack-specific outcomes, so historical overrides and final outcomes are recorded for
evaluation rather than treated as automatic retraining data.

## Requirements and installation

The deterministic engine needs only Python 3.11 or newer and the standard library. It runs
on the same machines that run the plugin and is the default when no model is configured.

For local MLX inference on Apple Silicon, install the runtime in the Python environment that
will run the sidecar:

```bash
python3 -m pip install laya-mlx
export VISTACK_LAYA_MODEL=aac6fef/laya-mlx
```

The first configured MLX request downloads the checkpoint through Hugging Face Hub. Download
the checkpoint before an offline run. Inference after the checkpoint is present is local.
Use a local checkpoint directory instead of the Hub id when network access is not wanted.

The default model is not downloaded implicitly by `--backend auto`; auto mode stays
deterministic unless `VISTACK_LAYA_MODEL` or `--model` is set.

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

With a configured Laya-MLX model, the order is Laya-MLX, Kev, then deterministic policy.
Without Laya-MLX, `--backend auto --kev-url ...` uses Kev directly. If Kev is not running,
the deterministic policy still returns a decision. No local server is contacted unless its
URL is configured.

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
python3 scripts/vistack-decision.py laya off
```

Turn it back on or inspect the effective setting:

```bash
python3 scripts/vistack-decision.py laya on
python3 scripts/vistack-decision.py laya status
```

The default project switch is `.codex/vistack/laya.json`. Use
`--config .claude/vistack/laya.json` for a Claude-hosted run. A one-request emergency
override is `--disable-laya`. The environment variable `VISTACK_LAYA_ENABLED=0` disables
refinement for every invocation in that environment and takes precedence over the file.
These switches select deterministic policy; they do not disable viStack routing, state,
evidence, or safety rules.

The same choices can be committed to a machine-local, ignored config file. The file is
created by `laya on`/`laya off`; the optional backend fields can be added by the project owner:

```json
{
  "schema_version": 1,
  "enabled": true,
  "fallback": "kev",
  "kev_url": "http://127.0.0.1:8009",
  "kev_model": "kev-latest",
  "host": "codex",
  "host_model": "gpt-5.4-mini"
}
```

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

`intake-analysis`, `grooming`, `playbook-selection`, `decomposition`,
`dispatch-readiness`, `runtime-progress`, `verification`, and `skill-improvement`.

For repeated orchestration events, keep the model resident:

```bash
python3 scripts/vistack-decision.py serve --backend auto
```

The server loads configured local models before reading the first request. Model load is
not charged to the per-call timeout, and a failed load is remembered instead of retried on
every request. A backend that fails twice in a row is skipped for 30 seconds, so an outage
costs one connect or inference timeout per window rather than one per decision.

Use `--timeout-ms` to bound an MLX call. The default is 2000 ms; a timeout returns the
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
and fallback metadata. `authority` is always `advisory-only`.

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
| `runtime-progress` | `current_state.attempts`, `identical_results`, `unblock_exhausted`, `next_action`, `credentials_missing`, `credentials_expired`, `contract_ambiguity` | Each fence returns `escalate` with `outputs.fence` set to 1-4. Twenty attempts or three identical results is FENCE 1; an irreversible `next_action` such as a merge is FENCE 3. |
| `verification` | `evidence[].criterion`, `evidence[].status` | `criterion` (1-based index or exact criterion text) covers that criterion only. `status` `fail` or a summary such as `3 tests failed` returns `request-evidence`; `status` `unavailable` returns `block`. Duplicate refs count once. `outputs.uncovered_criteria` lists the gaps. |

Rationales name the matched terms or the missing fields, and `alternatives` names the
runner-up route when one matched.

## Integration points

Use the hook only when a choice affects the workflow path.

| viStack owner | Decision type | Deterministic authority |
|---|---|---|
| router and groomer | intake analysis, grooming | readiness fields and fence rules |
| router | playbook selection | the route table in `skills/vistack/SKILL.md` |
| planner | decomposition | 500-line limit, file ownership, conflict matrix |
| coordinator | dispatch readiness, runtime progress | state transitions, dependencies, monitor and ledger rules |
| QA verifier | verification | captured artifacts tied to acceptance criteria |
| feedback review | skill improvement | explicit human review of historical patterns |

The caller validates the result before acting. A recommendation is not a permission to
dispatch, merge, push, deploy, delete, change secrets, or bypass a fence.

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
threshold, or fail a safety gate. If configured, the fallback order is local Laya-MLX,
local Kev, explicit host CLI, then deterministic policy. The sidecar also converts malformed
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
```

The report includes accuracy, per-type counts, and every mismatch; `--check` exits non-zero
on a mismatch, and the unit suite runs the same check for the deterministic policy. Add a
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

- The MLX runtime is optional and currently targets Apple Silicon/macOS.
- Kev is a separate local service; it is not installed by this plugin and its current Qwen3.5
  server path is slower on Apple Silicon than the older Qwen3 checkpoints.
- Host-LLM fallback is opt-in and can incur cost or transmit redacted decision context to the
  configured provider. It is never selected implicitly by `laya on`.
- The default English checkpoint is not a viStack-fine-tuned model.
- Laya choice quality can degrade with large option sets, so question schemas keep choices
  small and route candidates are prefiltered.
- Confidence is used as a safety threshold, not as proof of correctness.
- The feedback loop proposes changes; it does not train weights or modify workflow files.
