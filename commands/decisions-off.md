---
description: "Turn off the fork-layer decision models (Jev, Ollama, Laya) for this consuming project"
argument-hint: "[--config <path>]"
---

# /vistack:decisions-off

Run:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions off $ARGUMENTS
```

Every fork then gets the deterministic viStack policy: sharp forks still run in code and
split forks go to the main session. The models, Jev choice, Ollama model, and other fields
in the switch file are kept for the next `decisions on`.
