"""Install, start, stop, and report the resident Clef server.

Clef-flash is 19 GB of BF16 weights and needs torch, so it can neither load per CLI call nor
live in the plugin's interpreter. ``decisions setup --clef`` builds a dedicated venv and
prefetches the pinned snapshot, ``decisions clef-start`` runs ``laya.clef_server`` in that venv,
detached and machine-wide under the viStack cache, and the engine reaches it over loopback
HTTP. Nothing here imports torch, and ``status`` never raises.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
from typing import Any
from urllib.parse import urlsplit

from .config import cache_dir
from .mlx_backend import LayaUnavailable
from .schema import utc_now
from .system_one import CLEF_MODEL, CLEF_PORT, CLEF_REPO, CLEF_REVISION, CLEF_START_HINT, CLEF_URL, ClefBackend, clef_health


CLEF_PYTHON = "3.12"
CLEF_PACKAGES = ("torch==2.11.*", "torchvision==0.26.*", "transformers==5.10.2", "huggingface_hub", "safetensors", "accelerate", "pillow")
# The MPS driver holds about 20 GB once the model is loaded.
MIN_MEMORY_GB = 32.0
SERVER_MODULE = "laya.clef_server"
PLUGIN_ROOT = Path(__file__).resolve().parent.parent
LOOPBACK_HOSTS = {"127.0.0.1", "localhost"}
RELEASE_FILES = ("joint_schema_model.py", "joint_head.safetensors", "joint_head_config.json")
STOP_WAIT_S = 10.0
POLL_S = 0.25
COMMAND = "vistack-decision.py decisions"
SETUP_HINT = f"install it with `{COMMAND} setup --clef`, then start it with `{COMMAND} clef-start`"
STOP_COMMAND = f"{COMMAND} clef-stop"


def default_clef_venv() -> Path:
    return cache_dir() / "clef-venv"


def clef_python() -> str | None:
    explicit = os.environ.get("VISTACK_LAYA_CLEF_PYTHON", "").strip()
    if explicit:
        return os.path.expanduser(explicit)
    candidate = default_clef_venv() / "bin" / "python"
    return str(candidate) if candidate.exists() else None


def pid_path() -> Path:
    return cache_dir() / "clef-server.json"


def log_path() -> Path:
    return cache_dir() / "clef-server.log"


def _chosen(model: str | None) -> str | None:
    value = (model or "").strip()
    return None if value.lower() in {"", "none"} else value


def _local(model: str) -> Path | None:
    path = Path(model).expanduser()
    return path if path.is_dir() else None


def _hub_cache() -> Path:
    """Must agree with ``runtime.checkpoint_cached``."""

    return Path(
        os.environ.get("HF_HUB_CACHE")
        or os.path.join(os.environ.get("HF_HOME") or os.path.expanduser("~/.cache/huggingface"), "hub")
    )


def _complete(snapshot: Path) -> bool:
    """A blob still downloading has no snapshot link yet, so it reads as absent."""

    try:
        index = json.loads((snapshot / "model.safetensors.index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    weight_map = index.get("weight_map") if isinstance(index, dict) else None
    if not isinstance(weight_map, dict) or not weight_map:
        return False
    return all((snapshot / name).exists() for name in {*map(str, weight_map.values()), *RELEASE_FILES})


def cached(model: str | None, revision: str | None = None) -> bool | None:
    """Whether the pinned snapshot is complete on disk; ``None`` when no model is configured."""

    chosen = _chosen(model)
    if chosen is None:
        return None
    local = _local(chosen)
    if local is not None:
        return _complete(local)
    return _complete(_hub_cache() / f"models--{chosen.replace('/', '--')}" / "snapshots" / (revision or CLEF_REVISION))


def memory_gb() -> float | None:
    try:
        return round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1e9, 1)
    except (AttributeError, OSError, ValueError):
        return None


def setup_commands(venv: Path, model: str, revision: str, *, uv: str | None) -> list[list[str]]:
    """An existing venv is kept, so a rerun only checks the pins and the snapshot."""

    python = str(venv / "bin" / "python")
    commands: list[list[str]] = []
    if not (venv / "bin" / "python").exists():
        commands.append([uv, "venv", "--python", CLEF_PYTHON, str(venv)] if uv else [sys.executable, "-m", "venv", str(venv)])
    commands.append([uv, "pip", "install", "--python", python, *CLEF_PACKAGES] if uv else [python, "-m", "pip", "install", *CLEF_PACKAGES])
    if _local(model) is None:
        prefetch = f"from huggingface_hub import snapshot_download; print(snapshot_download({model!r}, revision={revision!r}))"
        commands.append([python, "-c", prefetch])
    return commands


def setup(model: str | None = None, revision: str | None = None, *, venv: Path | None = None, dry_run: bool = False) -> dict[str, Any]:
    chosen = _chosen(model) or CLEF_REPO
    pinned = revision or CLEF_REVISION
    target = venv or default_clef_venv()
    commands = setup_commands(target, chosen, pinned, uv=shutil.which("uv"))
    memory = memory_gb()
    result: dict[str, Any] = {
        "ok": True,
        "venv": str(target),
        "model": chosen,
        "revision": pinned,
        "commands": [" ".join(command) for command in commands],
        "memory_gb": memory,
    }
    if memory is not None and memory < MIN_MEMORY_GB:
        result["warning"] = f"this machine has {memory:.1f} GB of RAM; Clef holds about 20 GB once loaded and wants {MIN_MEMORY_GB:.0f} GB or more"
    if dry_run:
        return result
    for command in commands:
        # The installer and the download print progress; keep it on stderr so stdout stays JSON.
        completed = subprocess.run(command, stdout=sys.stderr, stderr=sys.stderr, check=False)
        if completed.returncode != 0:
            return {**result, "ok": False, "failed": " ".join(command), "exit_code": completed.returncode}
    return result


def _read_record() -> dict[str, Any]:
    try:
        value = json.loads(pid_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _pid(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _ps(pid: int, field: str) -> str | None:
    try:
        completed = subprocess.run(["ps", "-ww", "-o", f"{field}=", "-p", str(pid)], capture_output=True, text=True, timeout=5, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    text = completed.stdout.strip()
    return text if completed.returncode == 0 and text else None


def _is_server(pid: int) -> bool:
    """A pid file can outlive its process and the pid be reused, so the command line decides."""

    command = _ps(pid, "command")
    return command is not None and SERVER_MODULE in command


def _rss_mb(pid: int) -> float | None:
    value = _ps(pid, "rss")
    try:
        return round(int(value or "") * 1024 / 1e6, 1)
    except ValueError:
        return None


def _exited(pid: int) -> bool:
    try:
        reaped, _ = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except PermissionError:
            return False
        return False
    return reaped == pid


def _tail(path: Path, lines: int = 10) -> list[str]:
    try:
        return path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]
    except OSError:
        return []


def _spawn(python: str, model: str, revision: str, url: str, port: int, device: str, dtype: str) -> int:
    local = _local(model)
    target = os.path.abspath(local) if local is not None else model
    command = [python, "-m", SERVER_MODULE, "--model", target, "--revision", revision, "--port", str(port), "--device", device, "--dtype", dtype]
    log = log_path()
    log.parent.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, "PYTHONPATH": str(PLUGIN_ROOT)}
    with log.open("ab") as handle:
        process = subprocess.Popen(
            command, stdin=subprocess.DEVNULL, stdout=handle, stderr=subprocess.STDOUT, env=environment, cwd=str(log.parent), start_new_session=True
        )
    record = {"pid": process.pid, "url": url, "model": target, "revision": revision, "log": str(log), "started_at": utc_now()}
    pid_path().write_text(json.dumps(record, sort_keys=True) + "\n", encoding="utf-8")
    return process.pid


def _await(url: str, pid: int, wait_s: float) -> tuple[dict[str, Any], bool]:
    deadline = time.monotonic() + max(wait_s, 0.0)
    while True:
        health = clef_health(url)
        if health.get("status") in {"ready", "failed"}:
            return health, False
        if _exited(pid):
            return health, True
        if time.monotonic() >= deadline:
            return health, False
        time.sleep(POLL_S)


def start(
    model: str | None = None,
    revision: str | None = None,
    url: str | None = None,
    *,
    device: str = "auto",
    dtype: str = "bfloat16",
    wait_s: float = 0.0,
) -> dict[str, Any]:
    """Start the server unless one already answers or is starting. Safe to repeat."""

    chosen = _chosen(model) or CLEF_REPO
    pinned = revision or CLEF_REVISION
    base = (url or CLEF_URL).rstrip("/")
    report: dict[str, Any] = {
        "ok": False,
        "started": False,
        "pid": None,
        "url": base,
        "log": str(log_path()),
        "status": None,
        "stop_command": STOP_COMMAND,
    }
    parts = urlsplit(base)
    if parts.hostname not in LOOPBACK_HOSTS:
        return {**report, "reason": f"clef-start runs the server on this machine's loopback; {base} is not a loopback URL"}
    health = clef_health(base)
    if health["reachable"]:
        status = health.get("status")
        return {**report, "ok": status != "failed", "pid": _pid(health.get("pid")), "status": status, "health": health}
    recorded = _pid(_read_record().get("pid"))
    if recorded is not None and _is_server(recorded):
        pid, started = recorded, False
    else:
        python = clef_python()
        if not python or not Path(python).exists():
            return {**report, "reason": "the Clef runtime venv is missing", "hint": f"run `{COMMAND} setup --clef`"}
        pid, started = _spawn(python, chosen, pinned, base, parts.port or CLEF_PORT, device, dtype), True
    health, exited = _await(base, pid, wait_s)
    status = "exited" if exited else health.get("status") or "starting"
    result = {**report, "ok": status not in {"failed", "exited"}, "started": started, "pid": pid, "status": status, "health": health}
    if exited:
        pid_path().unlink(missing_ok=True)
        result["log_tail"] = _tail(log_path())
    return result


def stop() -> dict[str, Any]:
    """SIGTERM the recorded server, but only when its command line is still the Clef server."""

    path = pid_path()
    record = _read_record()
    if not record:
        return {"ok": True, "stopped": False, "pid": None, "reason": f"no Clef server is recorded at {path}"}
    pid = _pid(record.get("pid"))
    if pid is None:
        path.unlink(missing_ok=True)
        return {"ok": True, "stopped": False, "pid": None, "reason": "the record held no pid; removed it"}
    command = _ps(pid, "command")
    if command is None:
        path.unlink(missing_ok=True)
        return {"ok": True, "stopped": False, "pid": pid, "reason": "the recorded server is not running; removed its stale record"}
    if SERVER_MODULE not in command:
        path.unlink(missing_ok=True)
        return {"ok": True, "stopped": False, "pid": pid, "reason": f"pid {pid} is not a Clef server now; left it alone and removed the stale record"}
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    started = time.monotonic()
    while not _exited(pid):
        if time.monotonic() - started >= STOP_WAIT_S:
            return {"ok": False, "stopped": False, "pid": pid, "reason": f"still running {STOP_WAIT_S:.0f}s after SIGTERM; its record is kept", "hint": f"kill -9 {pid}"}
        time.sleep(0.1)
    path.unlink(missing_ok=True)
    return {"ok": True, "stopped": True, "pid": pid, "url": record.get("url"), "waited_s": round(time.monotonic() - started, 1)}


def _hint(report: dict[str, Any]) -> str | None:
    server = report["server"]
    health = server["health"]
    status = health.get("status")
    if server["running"]:
        if status == "ready":
            return None if report["model"] else f"Clef is running; add it to this project with `{COMMAND} on --clef-model {CLEF_REPO}`"
        if status == "loading":
            return f"Clef is loading ({health.get('load_seconds')}s so far); `{COMMAND} clef-start --wait 120` waits for it"
        if status == "failed":
            return f"Clef failed to load: {health.get('error')}; see {server['log']}, then run `{COMMAND} clef-stop` and `{COMMAND} clef-start`"
        return f"{report['url']} answers, but not as a Clef server"
    if not report["model"]:
        return None
    if server["pid"]:
        return f"Clef pid {server['pid']} is starting and not answering yet; see {server['log']}"
    if not report["venv_exists"] or report["cached"] is False:
        return SETUP_HINT
    return CLEF_START_HINT


def status(model: str | None = None, revision: str | None = None, url: str | None = None) -> dict[str, Any]:
    """Local checks only: a 1 s health call and ``ps``. ``memory_gb`` is the model's footprint as
    the server measures it; ``rss_mb`` misses what the MPS or CUDA driver holds."""

    chosen = _chosen(model)
    pinned = revision or CLEF_REVISION
    base = (url or CLEF_URL).rstrip("/")
    python = clef_python()
    health = clef_health(base)
    pid = _pid(health.get("pid")) if health["reachable"] else _pid(_read_record().get("pid"))
    if pid is not None and not health["reachable"] and not _is_server(pid):
        pid = None
    report: dict[str, Any] = {
        "model": chosen,
        "revision": pinned,
        "url": base,
        "venv": str(default_clef_venv()),
        "python": python,
        "venv_exists": bool(python) and Path(python or "").exists(),
        "cached": cached(chosen, pinned),
        "server": {
            "running": health["reachable"],
            "pid": pid,
            "memory_gb": health.get("memory_gb"),
            "rss_mb": _rss_mb(pid) if pid is not None else None,
            "log": str(log_path()),
            "health": health,
        },
    }
    report["hint"] = _hint(report)
    return report


def probe(url: str | None = None, model: str = CLEF_MODEL) -> dict[str, Any]:
    """One single-question decision against the loaded model, timed after the readiness check."""

    backend = ClefBackend(url, model=model)
    try:
        backend.warm()
        started = time.perf_counter()
        backend.predict({"build": "green"}, {"green": {"type": "noul", "instructions": "Is the build passing?"}})
    except LayaUnavailable as exc:
        return {"ok": False, "reason": str(exc)}
    return {"ok": True, "latency_ms": round((time.perf_counter() - started) * 1000, 1)}
