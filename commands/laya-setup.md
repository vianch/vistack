---
description: "Install the local Laya-MLX runtime and checkpoint for the fork layer (Apple Silicon)"
argument-hint: "[--model <hub-id>] [--dry-run]"
---

# /vistack:laya-setup

Show the plan first:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" laya setup --dry-run $ARGUMENTS
```

It creates a Python 3.12 venv in `~/.cache/vistack/laya-venv`, installs `laya-mlx` there,
and downloads the checkpoint (about 850 MB for `convaiinnovations/laya`). Run it without
`--dry-run` only after the user agrees. The entry script then switches to that venv on its
own; print the returned `export` lines so the user can pin `VISTACK_LAYA_PYTHON` and
`VISTACK_LAYA_MODEL` in their shell profile.
