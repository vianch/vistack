---
description: "Enable the default-on local Laya decision refinement for this consuming project"
argument-hint: "[optional config path]"
---

# /vistack:laya-on

Run:

```bash
python3 scripts/vistack-decision.py laya on
```

This restores optional local refinement. It does not install the MLX runtime or download a
model; configure `VISTACK_LAYA_MODEL` separately.
