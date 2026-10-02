"""The resident Clef server: one process holds Cloudflare clef-flash in memory and answers
``POST /v1/systemone`` on loopback.

The model is 19 GB of BF16 weights, so it cannot load per CLI call, and it needs torch, which
the plugin's interpreter must never import. ``decisions clef-start`` runs this module inside
the Clef venv; the engine reaches it over HTTP like Kev and Ollama. On an M3 Pro (MPS) the load
takes about 28 s and the first ``systemone`` call another 16-26 s while kernels compile, so the
server binds before it loads, ``/health`` answers throughout, and a warm-up call runs before
it reports ready. Warm calls take about 1 s at 255 tokens and 3.8 s at 1,000.

Torch, the Hub client, and the snapshot's ``joint_schema_model`` are imported only inside the
default ``Loader`` functions, so tests drive the handler with fakes on any Python.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib
import json
import os
from pathlib import Path
import signal
import sys
import threading
import time
from typing import Any, Callable, Mapping

from .schema import utc_now
from .system_one import CLEF_MODEL, CLEF_PORT, CLEF_REPO, CLEF_REVISION


LOOPBACK = "127.0.0.1"
MAX_BODY_BYTES = 2 * 1024 * 1024
DEVICES = ("auto", "cuda", "mps", "cpu")
DTYPES = ("bfloat16", "float16", "float32")
WARMUP_REQUEST = {
    "model": CLEF_MODEL,
    "state": "warm-up",
    "questions": {"ready": {"type": "noul", "instructions": "Is the server ready?"}},
}


class RevisionMismatch(RuntimeError):
    """The Hub cache resolved the pin to a different commit, so it holds different code."""


def pick_device(requested: str, *, cuda: bool, mps: bool) -> str:
    if requested != "auto":
        return requested
    return "cuda" if cuda else "mps" if mps else "cpu"


def hub_download(repo: str, revision: str) -> str:
    from huggingface_hub import snapshot_download

    return snapshot_download(repo, revision=revision)


def import_release(path: Path) -> Any:
    sys.path.insert(0, str(path))
    return importlib.import_module("joint_schema_model")


def torch_backend(device: str, dtype: str) -> tuple[str, Any]:
    import torch

    chosen = pick_device(device, cuda=torch.cuda.is_available(), mps=torch.backends.mps.is_available())
    return chosen, getattr(torch, dtype)


def torch_memory_gb(device: str) -> float:
    """On MPS and CUDA the weights sit in the driver's allocation, which the process RSS misses:
    on an M3 Pro the RSS is about 1.2 GB while the MPS driver holds about 20 GB. On CPU this is
    the peak RSS."""

    import torch

    if device == "mps":
        used = torch.mps.driver_allocated_memory()
    elif device.startswith("cuda"):
        used = torch.cuda.memory_allocated()
    else:
        import resource

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        used = peak if sys.platform == "darwin" else peak * 1024
    return used / 1e9


@dataclass(frozen=True)
class Loader:
    """The steps that need the Clef venv, injectable so tests run without torch."""

    download: Callable[[str, str], str] = hub_download
    import_code: Callable[[Path], Any] = import_release
    backend: Callable[[str, str], tuple[str, Any]] = torch_backend
    memory: Callable[[str], float] = torch_memory_gb


class ServerState:
    """Everything ``/health`` reports. Health reads it without the lock, so a long inference
    never stalls a status check."""

    def __init__(self, model: str, revision: str | None, *, device: str, dtype: str) -> None:
        self.model = model
        self.revision = revision
        self.device = device
        self.dtype = dtype
        self.status = "loading"
        self.error: str | None = None
        self.warning: str | None = None
        self.load_started_at = utc_now()
        self.load_seconds: float | None = None
        self.runner: Callable[[dict[str, Any]], dict[str, Any]] | None = None
        self.memory: Callable[[], float] | None = None
        self.lock = threading.Lock()
        self._started = time.monotonic()

    def _memory_gb(self) -> float | None:
        if self.memory is None:
            return None
        try:
            return round(float(self.memory()), 2)
        except Exception:  # A failed allocator query must not take /health down with it.
            return None

    def health(self) -> dict[str, Any]:
        seconds = self.load_seconds if self.load_seconds is not None else time.monotonic() - self._started
        return {
            "status": self.status,
            "model": self.model,
            "revision": self.revision,
            "device": self.device,
            "dtype": self.dtype,
            "pid": os.getpid(),
            "load_started_at": self.load_started_at,
            "load_seconds": round(seconds, 1),
            "memory_gb": self._memory_gb(),
            "error": self.error,
            "warning": self.warning,
        }

    def finish(self, runner: Callable[[dict[str, Any]], dict[str, Any]] | None, error: str | None) -> None:
        self.load_seconds = time.monotonic() - self._started
        self.runner, self.error = runner, error
        self.status = "ready" if runner is not None else "failed"


def _log(message: str) -> None:
    print(f"{utc_now()} clef: {message}", file=sys.stderr, flush=True)


def _snapshot(state: ServerState, download: Callable[[str, str], str]) -> Path:
    local = Path(state.model).expanduser()
    if local.is_dir():
        state.revision = None
        state.warning = f"loaded the local directory {local} as given; the revision pin does not apply"
        return local
    revision = state.revision or CLEF_REVISION
    path = Path(download(state.model, revision))
    if path.name != revision:
        raise RevisionMismatch(
            f"the Hub cache resolved {state.model} to snapshot {path.name}, not the pinned revision {revision}; "
            "pin a full 40-character commit sha"
        )
    return path


def load(state: ServerState, loader: Loader) -> None:
    """Runs in a background thread; every failure lands in health instead of killing the server."""

    try:
        path = _snapshot(state, loader.download)
        state.device, dtype = loader.backend(state.device, state.dtype)
        device = state.device
        state.memory = lambda: loader.memory(device)
        _log(f"loading {state.model} from {path} on {state.device} as {state.dtype}")
        release = loader.import_code(path)
        model, processor = release.load_release_model(str(path), device=state.device, dtype=dtype)

        def runner(request: dict[str, Any]) -> dict[str, Any]:
            return release.systemone(model, processor, request)

        runner(dict(WARMUP_REQUEST))
    except Exception as exc:
        state.finish(None, f"{type(exc).__name__}: {exc}")
        _log(f"load failed: {state.error}")
        return
    state.finish(runner, None)
    _log(f"ready in {state.load_seconds:.1f}s")


class ClefHandler(BaseHTTPRequestHandler):
    server: "ClefServer"
    server_version = "clef-server"

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        """Health polls would flood the log; errors still go through ``log_error``."""

    def _reply(self, code: int, payload: Mapping[str, Any], *, close: bool = False) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        if close:
            self.send_header("connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path != "/health":
            self._reply(404, {"error": "not found"})
            return
        self._reply(200, self.server.state.health())

    def do_POST(self) -> None:
        if self.path != "/v1/systemone":
            self._reply(404, {"error": "not found"})
            return
        declared = self.headers.get("content-length")
        if declared is None:
            self._reply(411, {"error": "Content-Length is required"})
            return
        try:
            length = int(declared)
        except ValueError:
            length = -1
        if length < 0:
            self._reply(400, {"error": "Content-Length must be a non-negative integer"})
            return
        if length > MAX_BODY_BYTES:
            self._reply(413, {"error": f"the body is over {MAX_BODY_BYTES} bytes"}, close=True)
            return
        raw = self.rfile.read(length)
        state = self.server.state
        runner = state.runner
        if state.status != "ready" or runner is None:
            reason = f"Clef failed to load: {state.error}" if state.status == "failed" else "Clef is loading"
            self._reply(503, {"error": reason})
            return
        try:
            request = json.loads(raw)
        except ValueError:
            self._reply(400, {"error": "the body is not JSON"})
            return
        if not isinstance(request, dict):
            self._reply(400, {"error": "the body must be a JSON object"})
            return
        try:
            with state.lock:
                response = runner(request)
        except ValueError as exc:
            self._reply(400, {"error": str(exc)})
            return
        except Exception as exc:
            # The message can quote the request, so only the type is logged.
            _log(f"inference failed: {type(exc).__name__}")
            self._reply(500, {"error": f"{type(exc).__name__}: {exc}"})
            return
        self._reply(200, response)


class ClefServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, state: ServerState, port: int) -> None:
        self.state = state
        super().__init__((LOOPBACK, port), ClefHandler)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m laya.clef_server", description="Serve Clef System One answers on loopback.")
    parser.add_argument("--model", default=CLEF_REPO, help="Hugging Face id, or a local snapshot directory loaded as given")
    parser.add_argument("--revision", default=CLEF_REVISION, help="the full commit sha a Hub id must resolve to")
    parser.add_argument("--port", type=int, default=CLEF_PORT)
    parser.add_argument("--device", choices=DEVICES, default="auto", help="auto tries cuda, then mps, then cpu")
    parser.add_argument("--dtype", choices=DTYPES, default="bfloat16")
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    state = ServerState(args.model, args.revision, device=args.device, dtype=args.dtype)
    server = ClefServer(state, args.port)
    # serve_forever runs on this thread, so shutdown() must come from another one.
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    _log(f"listening on http://{LOOPBACK}:{server.server_address[1]} as pid {os.getpid()}")
    threading.Thread(target=load, args=(state, Loader()), name="clef-load", daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        _log("stopped")


if __name__ == "__main__":
    main()
