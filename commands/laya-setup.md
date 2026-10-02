---
description: "Install a local fork-layer runtime: Laya-MLX (Apple Silicon), or Clef-flash with --clef"
argument-hint: "[--clef] [--model <hub-id>] [--dry-run]"
---

# /vistack:laya-setup

Installs Laya-MLX, or Clef-flash with `--clef`. Ollama models are installed with
`ollama pull`. Show the plan first:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions setup --dry-run $ARGUMENTS
```

Without `--clef`, it creates a Python 3.12 venv in `~/.cache/vistack/laya-venv`, installs
`laya-mlx` there, and downloads the checkpoint (about 850 MB for `convaiinnovations/laya`).

With `--clef`, it creates a Python 3.12 venv in `~/.cache/vistack/clef-venv` and installs
PyTorch 2.11, transformers 5.10.2, and their loaders. It then downloads `Cloudflare/clef-flash`,
about 19 GB, pinned to the reviewed revision. It needs about 20 GB of free memory while the
model runs.

Run the setup without `--dry-run` only after the user agrees. The entry script switches to the
Laya venv on its own. Clef runs as a separate server, started with `decisions clef-start`.
Print the returned `export` lines, so the user can pin them in their shell profile.
