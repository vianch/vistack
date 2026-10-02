"""HTTP adapters for the System One protocol: a local Kev server, a local Ollama server, a
resident Clef server, and hosted TypeSafe Jev.

All four speak ``POST /v1/systemone`` with ``{state, model, questions}`` and return typed
``answers``. Keeping the adapters HTTP-only means the viStack plugin installs neither Kev,
Ollama, PyTorch, nor the TypeSafe SDK into a consuming repository.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import time
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

from .config import cache_dir
from .mlx_backend import ContextOverflow, LayaUnavailable


JEV_URL = "https://api.typesafe.ai"
JEV_MODEL = "jev-latest"
# TypeSafe documents no balance endpoint, so an auth or funds refusal is the only signal that
# credits ran out. It does not fix itself within a request, so Jev is skipped for this long.
JEV_REFUSAL_COOLDOWN_S = 3600.0
REFUSAL_STATUSES = {401, 402, 403}
OLLAMA_URL = "http://127.0.0.1:11434"
OLLAMA_PORT = 11434
OLLAMA_KEEP_ALIVE = "30m"
# /api/ps is cheap but not free; a long-lived ``serve`` re-checks residency at most this often.
OLLAMA_LOADED_TTL_S = 60.0
# The reviewed snapshot: the server imports code shipped in it, so the commit is pinned.
CLEF_REPO = "Cloudflare/clef-flash"
CLEF_REVISION = "17f0b0ad64efb65d273590632833508766b2aae6"
CLEF_MODEL = "clef-flash"
CLEF_PORT = 8011
CLEF_URL = f"http://127.0.0.1:{CLEF_PORT}"
# Measured on the 108 labelled scenarios: at 0.65 Clef settled 9 of 10 split forks with one
# wrong at 0.79, every right split-fork answer scored 0.93 or higher, and raw wrong answers fell
# from 13 of 68 at 0.65 to 2 of 47 at 0.85.
CLEF_MIN_CONFIDENCE = 0.85
CLEF_READY_TTL_S = 60.0
CLEF_START_HINT = "start it with `vistack-decision.py decisions clef-start`"
# Ollama never truncates input: "prompt 0 has 2510 tokens; expected 1–2050 (...)".
OVERFLOW_PATTERN = re.compile(r"has (\d+) tokens; expected \d+\s*[–—-]\s*(\d+)")
MAX_ERROR_CHARS = 200


def jev_api_key() -> str | None:
    """The SDK's variable first, then the shorter name some shells export."""

    for name in ("TYPESAFE_API_KEY", "TYPESAFE_KEY"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def default_status_path() -> Path:
    return cache_dir() / "jev-status.json"


def read_status(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def default_ollama_url() -> str:
    """``OLLAMA_HOST`` read the way the Ollama CLI reads it: a bare ``host[:port]`` is HTTP on
    port 11434, and the bind-all address ``0.0.0.0`` is dialled as loopback."""

    value = os.environ.get("OLLAMA_HOST", "").strip()
    if not value:
        return OLLAMA_URL
    bare = "://" not in value
    if bare:
        value = f"http://{value}"
    parts = urlsplit(value)
    try:
        port = parts.port
    except ValueError:
        # A malformed port is left for the request to reject, with the URL in its message.
        return value.rstrip("/")
    if bare and port is None:
        value = f"{value.rstrip('/')}:{OLLAMA_PORT}"
        parts = urlsplit(value)
    if parts.hostname == "0.0.0.0":
        parts = parts._replace(netloc="127.0.0.1" + (f":{parts.port}" if parts.port else ""))
    return urlunsplit(parts).rstrip("/")


def same_model(configured: str, listed: Any) -> bool:
    """``nimble`` and ``nimble:latest`` name the same Ollama model."""

    def tagged(name: str) -> str:
        return name if ":" in name.rsplit("/", 1)[-1] else f"{name}:latest"

    return isinstance(listed, str) and tagged(configured) == tagged(listed)


def _answerable(questions: Mapping[str, Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    """A choice with fewer than two options fails the whole request with HTTP 400."""

    return {
        name: question
        for name, question in questions.items()
        if question.get("type") != "choice" or len(question.get("criteria") or ()) >= 2
    }


def _error_text(exc: HTTPError) -> str:
    try:
        raw = exc.read().decode("utf-8", "replace") if exc.fp is not None else ""
    except OSError:
        raw = ""
    finally:
        exc.close()
    try:
        value = json.loads(raw)
    except ValueError:
        value = None
    text = value["error"] if isinstance(value, dict) and isinstance(value.get("error"), str) else raw
    return " ".join(text.split())[:MAX_ERROR_CHARS]


def _fetch_json(url: str, payload: Mapping[str, Any] | None = None, *, timeout_s: float, headers: Mapping[str, str] | None = None) -> Any:
    data = json.dumps(dict(payload), ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = Request(url, data=data, headers={"content-type": "application/json", **(headers or {})}, method="POST" if data else "GET")
    with urlopen(request, timeout=timeout_s) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


class SystemOneBackend:
    name = "system-one"

    def __init__(
        self,
        url: str,
        *,
        model: str,
        timeout_ms: int = 2000,
        api_key: str | None = None,
        status_path: Path | None = None,
    ) -> None:
        self.url = url.rstrip("/")
        self.model = model
        self.timeout_ms = timeout_ms
        self.api_key = api_key
        self.status_path = status_path

    def _refused_until(self) -> float:
        if self.status_path is None:
            return 0.0
        until = read_status(self.status_path).get("refused_until", 0.0)
        return float(until) if isinstance(until, (int, float)) else 0.0

    def _record_refusal(self, status: int) -> None:
        if self.status_path is None:
            return
        record = {"refused_until": time.time() + JEV_REFUSAL_COOLDOWN_S, "status": status, "at": time.time()}
        try:
            self.status_path.parent.mkdir(parents=True, exist_ok=True)
            self.status_path.write_text(json.dumps(record) + "\n", encoding="utf-8")
        except OSError:
            pass

    def _body(self, state: Mapping[str, Any], questions: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
        return {"state": dict(state), "model": self.model, "questions": dict(questions)}

    def _http_error(self, code: int, detail: str) -> str:
        return f"{self.name} returned HTTP {code}" + (f": {detail}" if detail else "")

    def _unreachable(self, exc: Exception) -> str:
        return f"{self.name} is unavailable: {exc}"

    def _send(self, path: str, payload: Mapping[str, Any] | None, *, timeout_s: float) -> Any:
        headers = {"authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        try:
            return _fetch_json(f"{self.url}{path}", payload, timeout_s=timeout_s, headers=headers)
        except HTTPError as exc:
            detail = _error_text(exc)
            if exc.code in REFUSAL_STATUSES:
                self._record_refusal(exc.code)
            overflow = OVERFLOW_PATTERN.search(detail) if exc.code == 400 else None
            if overflow:
                raise ContextOverflow(
                    self._http_error(exc.code, detail), prompt_tokens=int(overflow.group(1)), limit_tokens=int(overflow.group(2))
                ) from exc
            raise LayaUnavailable(self._http_error(exc.code, detail)) from exc
        except (OSError, URLError, TimeoutError, ValueError) as exc:
            raise LayaUnavailable(self._unreachable(exc)) from exc

    def predict(self, state: Mapping[str, Any], questions: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
        remaining = self._refused_until() - time.time()
        if remaining > 0:
            raise LayaUnavailable(f"{self.name} refused recently (auth or credits); retry in {remaining / 60:.0f} min")
        answerable = _answerable(questions)
        if not answerable:
            raise LayaUnavailable("no question has two or more options")
        result = self._send("/v1/systemone", self._body(state, answerable), timeout_s=max(self.timeout_ms, 1) / 1000.0)
        if not isinstance(result, dict) or not isinstance(result.get("answers"), dict):
            raise LayaUnavailable(f"{self.name} returned a result without an answers object")
        return result


class KevBackend(SystemOneBackend):
    """A local Kev server; no key, no cooldown file."""

    name = "kev"

    def __init__(self, url: str = "http://127.0.0.1:8009", *, model: str = "kev-latest", timeout_ms: int = 2000) -> None:
        super().__init__(url, model=model, timeout_ms=timeout_ms)


class OllamaBackend(SystemOneBackend):
    """A local Ollama (0.35.0+) serving a System One model such as ``nimble``. No key, no
    cooldown file, and the state never leaves the machine."""

    name = "ollama"
    # A latency cap, not the window: nimble's prefill grows with the state, about 1 s for one
    # question and 2.2-3.3 s for three questions at 4k characters, 4 s at 6k.
    max_state_chars = 6000

    def __init__(
        self,
        model: str,
        *,
        url: str | None = None,
        keep_alive: str | None = None,
        timeout_ms: int = 8000,
        load_timeout_ms: int = 60000,
    ) -> None:
        super().__init__(url or default_ollama_url(), model=model, timeout_ms=timeout_ms)
        self.keep_alive = keep_alive or OLLAMA_KEEP_ALIVE
        self.load_timeout_ms = load_timeout_ms
        self._loaded_at: float | None = None

    def _keep_alive(self) -> str | int:
        # Ollama reads a JSON number as seconds and rejects a unitless string such as "-1".
        text = self.keep_alive.strip()
        return int(text) if re.fullmatch(r"-?\d+", text) else text

    def _body(self, state: Mapping[str, Any], questions: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
        return {**super()._body(state, questions), "keep_alive": self._keep_alive()}

    def _http_error(self, code: int, detail: str) -> str:
        if code == 404:
            return f"Ollama model {self.model} is not pulled ({detail or 'not found'}); run `ollama pull {self.model}`"
        return super()._http_error(code, detail)

    def _unreachable(self, exc: Exception) -> str:
        if isinstance(exc, URLError):
            return f"Ollama is not reachable at {self.url} ({exc.reason}); start it with `ollama serve`"
        return super()._unreachable(exc)

    def warm(self) -> None:
        """Block until the model is resident. A client disconnect cancels an Ollama load, so
        the load cannot be fire-and-forget; the engine runs this outside the per-call timer."""

        if self._loaded_at is not None and time.monotonic() - self._loaded_at < OLLAMA_LOADED_TTL_S:
            return
        running = self._send("/api/ps", None, timeout_s=1.0)
        models = running.get("models") if isinstance(running, dict) else None
        resident = any(
            same_model(self.model, item.get("name")) or same_model(self.model, item.get("model"))
            for item in models or []
            if isinstance(item, dict)
        )
        if not resident:
            # A generate request without a prompt loads the model and answers once it is loaded.
            self._send("/api/generate", {"model": self.model, "keep_alive": self._keep_alive()}, timeout_s=self.load_timeout_ms / 1000.0)
        self._loaded_at = time.monotonic()


class ClefBackend(SystemOneBackend):
    """Cloudflare clef-flash held by ``laya.clef_server`` in its own venv. The 19 GB model
    cannot load per call, so this adapter only checks that the server is ready and never
    starts it; no key, no cooldown file, and the state never leaves the machine. Its answers
    must clear ``min_confidence`` as well as the engine threshold."""

    name = "clef"
    # Warm, a split fork at this cap takes 1.1-1.8 s on an M3 Pro (MPS).
    max_state_chars = 6000

    def __init__(
        self, url: str | None = None, *, model: str = CLEF_MODEL, timeout_ms: int = 8000, min_confidence: float | None = None
    ) -> None:
        super().__init__(url or CLEF_URL, model=model, timeout_ms=timeout_ms)
        self.min_confidence = CLEF_MIN_CONFIDENCE if min_confidence is None else min_confidence
        self._ready_at: float | None = None

    def _unreachable(self, exc: Exception) -> str:
        if isinstance(exc, URLError):
            return f"Clef is not running at {self.url}; {CLEF_START_HINT}"
        return super()._unreachable(exc)

    def warm(self) -> None:
        """Fail fast unless the server reports ready; a load in progress is never waited on."""

        if self._ready_at is not None and time.monotonic() - self._ready_at < CLEF_READY_TTL_S:
            return
        health = self._send("/health", None, timeout_s=1.0)
        status = health.get("status") if isinstance(health, dict) else None
        if status == "loading":
            elapsed = health.get("load_seconds")
            seconds = f"{elapsed:.0f}s" if isinstance(elapsed, (int, float)) else "an unknown time"
            raise LayaUnavailable(f"Clef at {self.url} is still loading its model ({seconds} elapsed)")
        if status == "failed":
            raise LayaUnavailable(f"Clef at {self.url} failed to load: {health.get('error') or 'no error recorded'}")
        if status != "ready":
            raise LayaUnavailable(f"Clef at {self.url} reported an unknown status: {status!r}")
        self._ready_at = time.monotonic()


class JevBackend(SystemOneBackend):
    """Hosted TypeSafe Jev. Sends the bounded, redacted state off the machine; opt-in only."""

    name = "jev"

    def __init__(
        self,
        *,
        api_key: str,
        url: str | None = None,
        model: str | None = None,
        timeout_ms: int = 2000,
        status_path: Path | None = None,
    ) -> None:
        super().__init__(
            url or os.environ.get("TYPESAFE_BASE_URL") or JEV_URL,
            model=model or JEV_MODEL,
            timeout_ms=timeout_ms,
            api_key=api_key,
            status_path=status_path or default_status_path(),
        )


def ollama_inventory(url: str | None = None, *, timeout_s: float = 1.0) -> dict[str, Any]:
    """What a local Ollama has installed, can decide with, and holds in memory. Never raises:
    status reports an unreachable server rather than failing on it."""

    base = (url or default_ollama_url()).rstrip("/")
    report: dict[str, Any] = {"url": base, "reachable": False, "version": None, "installed": [], "decision_models": [], "loaded": []}
    try:
        version = _fetch_json(f"{base}/api/version", timeout_s=timeout_s)
        report["reachable"] = True
        report["version"] = version.get("version") if isinstance(version, dict) else None
        tags = _fetch_json(f"{base}/api/tags", timeout_s=timeout_s)
        report["installed"] = [item["name"] for item in tags.get("models") or [] if isinstance(item, dict) and isinstance(item.get("name"), str)]
        running = _fetch_json(f"{base}/api/ps", timeout_s=timeout_s)
        report["loaded"] = [
            {key: item.get(key) for key in ("name", "context_length", "expires_at")}
            for item in running.get("models") or []
            if isinstance(item, dict)
        ]
        for name in report["installed"]:
            shown = _fetch_json(f"{base}/api/show", {"model": name}, timeout_s=timeout_s)
            if "decision" in (shown.get("capabilities") or []):
                report["decision_models"].append(name)
    except Exception as exc:
        report["error"] = str(getattr(exc, "reason", None) or exc) or type(exc).__name__
    return report


def clef_health(url: str | None = None, *, timeout_s: float = 1.0) -> dict[str, Any]:
    """The Clef server's ``/health`` with ``reachable`` and ``url`` added. Never raises: status
    reports a server that is down rather than failing on it."""

    base = (url or CLEF_URL).rstrip("/")
    try:
        value = _fetch_json(f"{base}/health", timeout_s=timeout_s)
    except Exception as exc:
        return {"url": base, "reachable": False, "status": None, "error": str(getattr(exc, "reason", None) or exc) or type(exc).__name__}
    if not isinstance(value, dict):
        return {"url": base, "reachable": True, "status": None, "error": "health is not a JSON object"}
    return {**value, "url": base, "reachable": True}
