"""Find, report, and install the interpreter that runs the optional local Laya model.

A system Python is often externally managed (PEP 668) and cannot take ``pip install
laya-mlx``. ``decisions setup`` builds a dedicated venv under the viStack cache directory, and
every entry script re-executes itself in that venv when the current interpreter lacks the
runtime. The deterministic engine never needs any of this.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time
from typing import Any

from .config import cache_dir
from .mlx_backend import split_model


RUNTIME_PACKAGE = "laya-mlx"
DEFAULT_MODEL = "convaiinnovations/laya"
# laya-mlx is validated on Python 3.12; 3.14 has an MLX wheel but no published validation.
RUNTIME_PYTHON = "3.12"
REEXEC_MARKER = "VISTACK_LAYA_REEXEC"


def default_venv() -> Path:
    return cache_dir() / "laya-venv"


def configured_python() -> str | None:
    explicit = os.environ.get("VISTACK_LAYA_PYTHON", "").strip()
    if explicit:
        return os.path.expanduser(explicit)
    candidate = default_venv() / "bin" / "python"
    return str(candidate) if candidate.exists() else None


def runtime_available() -> bool:
    return importlib.util.find_spec("laya_mlx") is not None


def reexec_with_runtime(argv: list[str]) -> None:
    """Replace this process with the runtime venv when it has laya-mlx and this one does not."""

    if os.environ.get(REEXEC_MARKER) or runtime_available():
        return
    target = configured_python()
    if not target or not os.access(target, os.X_OK):
        return
    # A venv's python is a symlink to its base interpreter, so compare unresolved paths.
    if os.path.abspath(target) == os.path.abspath(sys.executable):
        return
    os.environ[REEXEC_MARKER] = "1"
    os.execv(target, [target, *argv])


def checkpoint_cached(model: str | None) -> bool | None:
    """Whether the weights are on disk already; ``None`` when no model is configured."""

    if not model:
        return None
    local = Path(os.path.expanduser(model))
    if local.exists():
        return (local / "model.safetensors").exists()
    repo, subfolder = split_model(model)
    hub = Path(
        os.environ.get("HF_HUB_CACHE")
        or os.path.join(os.environ.get("HF_HOME") or os.path.expanduser("~/.cache/huggingface"), "hub")
    )
    snapshots = hub / f"models--{repo.replace('/', '--')}" / "snapshots"
    relative = Path(subfolder or "") / "model.safetensors"
    return any((snapshot / relative).exists() for snapshot in snapshots.glob("*")) if snapshots.exists() else False


def setup_commands(venv: Path, model: str, *, uv: str | None) -> list[list[str]]:
    python = str(venv / "bin" / "python")
    repo, subfolder = split_model(model)
    prefetch = f"import laya_mlx; laya_mlx.load({repo!r}, subfolder={subfolder!r})"
    if uv:
        create = [[uv, "venv", "--python", RUNTIME_PYTHON, str(venv)], [uv, "pip", "install", "--python", python, RUNTIME_PACKAGE]]
    else:
        create = [[sys.executable, "-m", "venv", str(venv)], [python, "-m", "pip", "install", RUNTIME_PACKAGE]]
    return [*create, [python, "-c", prefetch]]


def setup(model: str | None = None, *, venv: Path | None = None, dry_run: bool = False) -> dict[str, Any]:
    """Build the runtime venv, install laya-mlx, and download the checkpoint once."""

    if sys.platform != "darwin" or platform.machine() != "arm64":
        return {
            "ok": False,
            "reason": "laya-mlx needs Apple Silicon; use Ollama, a Kev server, or opt into Jev instead",
        }
    target = venv or default_venv()
    chosen = model or DEFAULT_MODEL
    commands = setup_commands(target, chosen, uv=shutil.which("uv"))
    result: dict[str, Any] = {
        "ok": True,
        "venv": str(target),
        "model": chosen,
        "commands": [" ".join(command) for command in commands],
        "export": [f'export VISTACK_LAYA_PYTHON="{target / "bin" / "python"}"', f"export VISTACK_LAYA_MODEL={chosen}"],
    }
    if dry_run:
        return result
    for command in commands:
        # The installer and the download print progress; keep it on stderr so stdout stays JSON.
        completed = subprocess.run(command, stdout=sys.stderr, stderr=sys.stderr, check=False)
        if completed.returncode != 0:
            return {**result, "ok": False, "failed": " ".join(command), "exit_code": completed.returncode}
    return result


def probe_jev() -> dict[str, Any]:
    """One single-question call: proves the key works and the account still has credits."""

    from .mlx_backend import LayaUnavailable
    from .system_one import JevBackend, jev_api_key

    key = jev_api_key()
    if not key:
        return {"ok": False, "reason": "neither TYPESAFE_API_KEY nor TYPESAFE_KEY is set"}
    started = time.perf_counter()
    try:
        JevBackend(api_key=key, timeout_ms=5000).predict(
            {"build": "green"}, {"green": {"type": "noul", "instructions": "Is the build passing?"}}
        )
    except LayaUnavailable as exc:
        return {"ok": False, "reason": str(exc)}
    return {"ok": True, "latency_ms": round((time.perf_counter() - started) * 1000, 1)}


def probe_ollama(model: str, url: str | None = None) -> dict[str, Any]:
    """One single-question decision against the local model; free, and nothing leaves the
    machine. The load runs first and untimed, so the latency is the decision alone."""

    from .mlx_backend import LayaUnavailable
    from .system_one import OllamaBackend

    backend = OllamaBackend(model, url=url)
    try:
        backend.warm()
        started = time.perf_counter()
        backend.predict({"build": "green"}, {"green": {"type": "noul", "instructions": "Is the build passing?"}})
    except LayaUnavailable as exc:
        return {"ok": False, "reason": str(exc)}
    return {"ok": True, "latency_ms": round((time.perf_counter() - started) * 1000, 1)}
