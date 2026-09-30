---
description: "Show the fork layer: switch, ladder, Ollama, runtime, Jev key, and fork tally"
argument-hint: "[--probe] [--config <path>]"
---

# /vistack:decisions-status

Run:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions status $ARGUMENTS
```

Report the `ladder`, the `ollama` block (`model`, `url`, `reachable`, `installed`,
`decision_models`, `loaded`, `missing`) with the `hint`, whether `laya_mlx` imports and the
checkpoint is cached, the Jev `enabled`/`key`/`refused` fields, and the `forks` tally. Never
print a key value.

`--probe` makes one single-question call per configured remote or local tier. The Jev call
is billed, so pass `--probe` only when the user asks. The Ollama probe runs on the machine
and is free.
