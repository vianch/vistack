---
description: "Show the fork layer: switch, ladder, runtime, Jev key, and fork tally"
argument-hint: "[--probe] [--config <path>]"
---

# /vistack:laya-status

Run:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" laya status $ARGUMENTS
```

Report the `ladder`, whether `laya_mlx` imports and the checkpoint is cached, the Jev
`enabled`/`key`/`refused` fields, and the `forks` tally — never a key value. `--probe` makes
one single-question Jev call to prove the key and remaining credits; it is billed, so run it
only when asked.
