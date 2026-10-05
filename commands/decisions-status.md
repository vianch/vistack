---
description: "Show the fork layer (Jev, Ollama): switch, ladder, Ollama model, Jev key, leftovers, and fork tally"
argument-hint: "[--probe] [--config <path>]"
---

# /vistack:decisions-status

Run:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions status $ARGUMENTS
```

Report:

- the `ladder`;
- the `ollama` block: `model`, `url`, `reachable`, `version`, `version_ok`, `installed`,
  `decision_models`, `supported`, `loaded`, `missing`, `min_confidence`, and the `hint`;
- the Jev `enabled`, `key`, and `refused` fields;
- the `obsolete` block (`fields`, `env`), and the top-level `hint` when there is one;
- the `forks` tally.

Never print a key value.

`--probe` makes one single-question call per configured tier. The Jev call is billed, so
pass `--probe` only when the user asks. The Ollama probe runs on the machine and is free.
