---
description: "Turn off the Laya/Jev fork layer for this consuming project"
argument-hint: "[--config <path>]"
---

# /vistack:laya-off

Run:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" laya off $ARGUMENTS
```

Every fork then gets the deterministic viStack policy: sharp forks still run in code and
split forks go to the main session. The model, Jev choice, and other fields in the switch
file are kept for the next `laya on`.
