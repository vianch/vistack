"""Optional adapter for the public laya-mlx Python API.

The dependency is intentionally imported only when this backend is selected. A normal
viStack installation therefore has no MLX, NumPy, tokenizer, or model download dependency.
"""

from __future__ import annotations

from typing import Any, Mapping


class LayaUnavailable(RuntimeError):
    """Raised when the optional local runtime cannot answer a request."""


class InferenceTimeout(LayaUnavailable):
    """Raised when a local inference call exceeds its configured budget."""


class MLXBackend:
    name = "laya-mlx"

    def __init__(
        self,
        model: str | None = None,
        *,
        dtype: str = "float16",
        device: str | None = None,
        batch_size: int = 16,
        compile: bool = False,
        cache_prompts: bool = True,
    ) -> None:
        self.model = model
        self.dtype = dtype
        self.device = device
        self.batch_size = batch_size
        self.compile = compile
        self.cache_prompts = cache_prompts
        self._agent: Any = None
        self._load_error: LayaUnavailable | None = None

    def warm(self) -> None:
        """Load the checkpoint now so a later ``predict`` pays inference cost only."""

        self._load()

    def _load(self) -> Any:
        if self._agent is not None:
            return self._agent
        # A failed load is not retried: a missing package or checkpoint does not fix itself
        # between requests, and retrying would repeat the import and download cost each time.
        if self._load_error is not None:
            raise self._load_error
        try:
            self._agent = self._load_agent()
        except LayaUnavailable as exc:
            self._load_error = exc
            raise
        return self._agent

    def _load_agent(self) -> Any:
        if not self.model:
            raise LayaUnavailable(
                "no Laya model configured; pass --model or set VISTACK_LAYA_MODEL"
            )
        try:
            import laya_mlx  # type: ignore[import-not-found]
        except Exception as exc:  # pragma: no cover - depends on the host Python
            raise LayaUnavailable("laya-mlx is not installed in this Python environment") from exc
        try:
            return laya_mlx.load(
                self.model,
                dtype=self.dtype,
                device=self.device,
                batch_size=self.batch_size,
                compile=self.compile,
                cache_prompts=self.cache_prompts,
            )
        except Exception as exc:  # model path, tokenizer, and MLX errors are all fallbackable
            raise LayaUnavailable(f"Laya model could not be loaded: {exc}") from exc

    def predict(self, state: Mapping[str, Any], questions: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
        agent = self._load()
        try:
            result = agent.predict(dict(state), dict(questions))
        except Exception as exc:
            raise LayaUnavailable(f"Laya inference failed: {exc}") from exc
        if not isinstance(result, dict) or not isinstance(result.get("answers"), dict):
            raise LayaUnavailable("Laya returned a result without an answers object")
        return result
