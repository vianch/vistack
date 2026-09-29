---
description: "Turn on the Laya/Jev fork layer for this consuming project"
argument-hint: "[--model <hub-id>] [--jev | --no-jev] [--config <path>]"
---

# /vistack:laya-on

Run, then report the returned `ladder`, `laya_mlx`, `checkpoint_cached`, and `jev` fields:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" laya on $ARGUMENTS
```

The switch is written to the host's state root, `.claude/vistack/laya.json` under Claude
Code. `--model` records the checkpoint, for example `convaiinnovations/laya`. `--jev` opts
this project into hosted TypeSafe Jev, which sends the bounded, redacted decision state to
TypeSafe; without it, `laya on` never adds a cloud tier. If the report shows a model with
`laya_mlx: false`, offer `/vistack:laya-setup` — do not install anything unasked.
