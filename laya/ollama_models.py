"""The Ollama decision models the fork layer supports, and the facts measured for each.

This is the only list. The CLI help, the ``--ollama-model`` check, ``decisions status``, and
the engine's per-tier floor all read it. It imports nothing, so the deterministic path can
check a model name without loading urllib.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class OllamaModel:
    name: str
    # Tags that name the same weights, so ``clef-flash:9b`` is the supported model too.
    tags: tuple[str, ...]
    # The tier's own answer floor; the engine applies the stricter of it and --min-confidence.
    min_confidence: float
    # The first Ollama release whose ``POST /v1/systemone`` serves the model.
    min_ollama: str
    disk_gb: float
    resident_gb: float
    warm_split_s: float
    cold_load_s: float


# Measured on 2026-10-05 on an Apple M3 Pro with 36 GB, Ollama 0.35.1, clef-flash:latest
# (Q8_0), on the 108 labelled scenarios in examples/laya/scenarios.jsonl. Resident size is at
# the model's default 16,384-token window. A warm split fork took 0.88-1.28 s, median 0.98 s.
# Raw answers wrong at confidence >= 0.65: 2 of 46; >= 0.75: 1 of 37; >= 0.85: 0 of 23. The
# 0.827 wrong answer moved evidenced complex work to the mechanical tier. The 0.85 floor costs
# one split fork (8 of 10 settled at 0.65, 7 of 10 at 0.85, none wrong either way).
OLLAMA_MODELS: dict[str, OllamaModel] = {
    "clef-flash": OllamaModel(
        name="clef-flash",
        tags=("latest", "9b"),
        min_confidence=0.85,
        min_ollama="0.35.1",
        disk_gb=10.9,
        resident_gb=14.2,
        warm_split_s=1.0,
        cold_load_s=7.0,
    ),
}
# The first entry is the one `decisions on` recommends and every fix names.
RECOMMENDED = next(iter(OLLAMA_MODELS.values()))


def supported_ollama_model(tag: str | None) -> str | None:
    """The supported model a configured tag names, or ``None``."""

    name, _, version = (tag or "").strip().lower().partition(":")
    model = OLLAMA_MODELS.get(name)
    if model is None or (version and version not in model.tags):
        return None
    return model.name


def unsupported_reason(tag: str) -> str:
    supported = ", ".join(OLLAMA_MODELS)
    return (
        f"{tag} is not a supported Ollama decision model; supported: {supported}. "
        f"Run `decisions on --ollama-model {RECOMMENDED.name}` (pull with `ollama pull {RECOMMENDED.name}`)"
    )


def describe(model: OllamaModel) -> str:
    return (
        f"{model.name}: {model.disk_gb:g} GB on disk, {model.resident_gb:g} GB loaded, about {model.warm_split_s:g} s "
        f"per split fork and {model.cold_load_s:g} s to load, answers kept at {model.min_confidence:g} or higher; "
        f"needs Ollama {model.min_ollama}+"
    )
