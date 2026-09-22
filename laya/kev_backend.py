"""HTTP adapter for a local Kev System One server.

Kev deliberately mirrors the typed decision protocol used by Laya. Keeping this
adapter HTTP-only means the viStack plugin does not need to install Kev, PyTorch,
or its model dependencies into every consuming repository.
"""

from __future__ import annotations

import json
from typing import Any, Mapping
from urllib.error import URLError
from urllib.request import Request, urlopen

from .mlx_backend import LayaUnavailable


class KevBackend:
    name = "kev"

    def __init__(
        self,
        url: str = "http://127.0.0.1:8009",
        *,
        model: str = "kev-latest",
        timeout_ms: int = 2000,
    ) -> None:
        self.url = url.rstrip("/")
        self.model = model
        self.timeout_ms = timeout_ms

    def predict(self, state: Mapping[str, Any], questions: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
        payload = json.dumps(
            {"state": dict(state), "model": self.model, "questions": dict(questions)},
            ensure_ascii=False,
        ).encode("utf-8")
        request = Request(
            f"{self.url}/v1/systemone",
            data=payload,
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=max(self.timeout_ms, 1) / 1000.0) as response:  # noqa: S310
                result = json.loads(response.read().decode("utf-8"))
        except (OSError, URLError, TimeoutError, ValueError) as exc:
            raise LayaUnavailable(f"Kev local server is unavailable: {exc}") from exc
        if not isinstance(result, dict) or not isinstance(result.get("answers"), dict):
            raise LayaUnavailable("Kev returned a result without an answers object")
        return result
