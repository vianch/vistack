"""Errors a refinement tier raises when it cannot answer; the engine catches them and falls
through to the next tier."""

from __future__ import annotations


class LayaUnavailable(RuntimeError):
    """Raised when the optional local runtime cannot answer a request."""


class InferenceTimeout(LayaUnavailable):
    """Raised when a local inference call exceeds its configured budget."""


class ContextOverflow(LayaUnavailable):
    """Raised when a rendered prompt exceeds the loaded context window. Defined here so the
    engine can catch it without importing urllib on the deterministic path."""

    def __init__(self, message: str, *, prompt_tokens: int, limit_tokens: int) -> None:
        super().__init__(message)
        self.prompt_tokens = prompt_tokens
        self.limit_tokens = limit_tokens
