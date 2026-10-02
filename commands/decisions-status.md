---
description: "Show the fork layer: switch, ladder, Clef, Ollama, runtime, Jev key, and fork tally"
argument-hint: "[--probe] [--config <path>]"
---

# /vistack:decisions-status

Run:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions status $ARGUMENTS
```

Report:

- the `ladder`;
- the `clef` block: `model`, `revision`, `venv_exists`, `cached`, and from `server`, the
  `running`, `pid`, `health.status`, and `health.memory_gb` fields, plus the `hint`;
- the `ollama` block: `model`, `url`, `reachable`, `installed`, `decision_models`, `loaded`,
  `missing`, and the `hint`;
- whether `laya_mlx` imports and whether its checkpoint is cached;
- the Jev `enabled`, `key`, and `refused` fields;
- the `forks` tally.

Never print a key value. On Apple Silicon, Clef's memory sits in the GPU driver, so the
process RSS understates it. Report `memory_gb` instead.

`--probe` makes one single-question call per configured remote or local tier. The Jev call
is billed, so pass `--probe` only when the user asks. The Clef and Ollama probes run on the
machine and are free.
