---
description: "Show the fork layer (Jev, Cloudflare, Ollama): switch, ladder, Ollama model, Jev key, Cloudflare budget, leftovers, and fork tally"
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
- the `cloudflare` block: `enabled`, `token`, `account`, `model`, `min_confidence`, and `budget`
  (`day`, `used`, `cap`, `free_allocation`, `remaining`, `calls`, `resets_at`, `exhausted`,
  `refused`);
- the `obsolete` block (`fields`, `env`), and the top-level `hint` when there is one;
- the `forks` tally.

Never print a key, token, or account id value.

`--probe` makes one single-question call per configured tier. The Jev call is billed and the
Cloudflare call spends Neurons, and `--probe` calls Cloudflare only when the tier is opted in, so
pass `--probe` only when the user asks. The Ollama probe runs on the machine and is free.
