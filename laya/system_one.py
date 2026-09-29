"""HTTP adapters for the System One protocol: a local Kev server and hosted TypeSafe Jev.

Both speak ``POST /v1/systemone`` with ``{state, model, questions}`` and return typed
``answers``. Keeping the adapters HTTP-only means the viStack plugin installs neither Kev,
PyTorch, nor the TypeSafe SDK into a consuming repository.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import time
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import cache_dir
from .mlx_backend import LayaUnavailable


JEV_URL = "https://api.typesafe.ai"
JEV_MODEL = "jev-latest"
# TypeSafe documents no balance endpoint, so an auth or funds refusal is the only signal that
# credits ran out. It does not fix itself within a request, so Jev is skipped for this long.
JEV_REFUSAL_COOLDOWN_S = 3600.0
REFUSAL_STATUSES = {401, 402, 403}


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

    def predict(self, state: Mapping[str, Any], questions: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
        remaining = self._refused_until() - time.time()
        if remaining > 0:
            raise LayaUnavailable(f"{self.name} refused recently (auth or credits); retry in {remaining / 60:.0f} min")
        payload = json.dumps(
            {"state": dict(state), "model": self.model, "questions": dict(questions)},
            ensure_ascii=False,
        ).encode("utf-8")
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        request = Request(f"{self.url}/v1/systemone", data=payload, headers=headers, method="POST")
        try:
            with urlopen(request, timeout=max(self.timeout_ms, 1) / 1000.0) as response:  # noqa: S310
                result = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            exc.close()
            if exc.code in REFUSAL_STATUSES:
                self._record_refusal(exc.code)
            raise LayaUnavailable(f"{self.name} returned HTTP {exc.code}") from exc
        except (OSError, URLError, TimeoutError, ValueError) as exc:
            raise LayaUnavailable(f"{self.name} is unavailable: {exc}") from exc
        if not isinstance(result, dict) or not isinstance(result.get("answers"), dict):
            raise LayaUnavailable(f"{self.name} returned a result without an answers object")
        return result


class KevBackend(SystemOneBackend):
    """A local Kev server; no key, no cooldown file."""

    name = "kev"

    def __init__(self, url: str = "http://127.0.0.1:8009", *, model: str = "kev-latest", timeout_ms: int = 2000) -> None:
        super().__init__(url, model=model, timeout_ms=timeout_ms)


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
