---
description: "Disable the default-on local Laya decision refinement for this consuming project"
argument-hint: "[optional config path]"
---

# /vistack:laya-off

Run:

```bash
python3 scripts/vistack-decision.py laya off
```

Use `--config .claude/vistack/laya.json` when the consuming project uses Claude state. This
turns off optional Laya refinement while keeping the deterministic viStack policy active.
