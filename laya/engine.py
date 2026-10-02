"""Decision engine: deterministic policy, a refinement ladder, and safety gates.

The deterministic policy answers every fork first. A sharp answer runs in code without a
model turn. Only a split answer climbs the ladder — Jev when opted in, then Clef, Ollama,
Laya-MLX, Kev, and the host CLI — and the first typed answer that clears the confidence
threshold and every safety gate makes the fork sharp. Anything else stays split and goes back to the main
session.
"""

from __future__ import annotations

from dataclasses import replace
import json
import os
import signal
import threading
import time
import uuid
from typing import Any, Mapping

from .history import HistoryStore
from .mlx_backend import ContextOverflow, InferenceTimeout, LayaUnavailable, MLXBackend
from .policy import PolicyDraft, evaluate, irreversible, option_descriptions, verification_sufficient
from .questions import MAX_STATE_CHARS, questions_for, state_for_laya
from .schema import (
    ACTIONS_BY_TYPE,
    Decision,
    DecisionContext,
    Alternative,
    OPEN_ACTION_TYPES,
    TIER_ROLES,
    default_actions,
    utc_now,
)


BACKENDS = ("auto", "deterministic", "mlx", "kev", "jev", "ollama", "clef", "host-llm")
FALLBACKS = ("none", "kev", "jev", "clef", "host-llm")
# Every refinement tier, best first: ``auto`` makes the first configured one the primary and the
# rest follow in this order. Opted-in Jev leads: it settled 7
# of 10 labelled split forks, all correctly, at about 340 ms. Clef follows, measured on the same
# scenarios; its answers clear a stricter floor of their own (``CLEF_MIN_CONFIDENCE``). Ollama
# settled one more labelled split fork after Jev, correctly, and none wrongly; the local
# Laya-MLX checkpoint settled none.
LADDER = ("jev", "clef", "ollama", "mlx", "kev", "host-llm")
CONSULT_MODES = ("split", "always")
TRUE_VALUES = {"1", "true", "on", "yes", "enabled"}
# nimble answers three questions at a 6k-character state in about 4 s; the 2000 ms engine
# default timed it out 11 times on the intake and grooming schemas.
OLLAMA_MIN_TIMEOUT_MS = 8000
# Warm Clef answers a split fork in 1.1-1.8 s on an M3 Pro; the server's warm-up call absorbs
# the 16-26 s first call before it reports ready.
CLEF_MIN_TIMEOUT_MS = 8000
# After a context overflow the state is shrunk to the reported window with this headroom,
# since the questions share the window and do not shrink with the state.
OVERFLOW_HEADROOM = 0.85
MIN_STATE_CHARS = 800


def _answer(result: Mapping[str, Any], name: str) -> Mapping[str, Any] | None:
    value = result.get("answers", {}).get(name)
    return value if isinstance(value, Mapping) else None


def _choice(answer: Mapping[str, Any] | None) -> str | None:
    value = answer.get("choice") if answer else None
    return value if isinstance(value, str) else None


def _noul_probability(answer: Mapping[str, Any] | None) -> float | None:
    if not answer:
        return None
    try:
        value = answer.get("noul")
        return max(0.0, min(1.0, float(value))) if value is not None else None
    except (TypeError, ValueError):
        return None


def _confidence(answer: Mapping[str, Any] | None) -> float:
    if not answer:
        return 0.0
    if "confidence" not in answer:
        # Hosted Jev returns only P(true) for a noul; its confidence is the distance from 0.5.
        probability = _noul_probability(answer)
        return max(probability, 1.0 - probability) if probability is not None else 0.0
    try:
        value = float(answer.get("confidence", 0.0))
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, value))


def _probabilities(answer: Mapping[str, Any] | None) -> dict[str, float]:
    if not answer or not isinstance(answer.get("probabilities"), Mapping):
        return {}
    result: dict[str, float] = {}
    for key, value in answer["probabilities"].items():
        try:
            result[str(key)] = max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            continue
    return result


def _requested_actions(context: DecisionContext) -> tuple[str, ...]:
    return context.available_actions or default_actions(context.decision_type)


def _flag(value: str | None) -> bool:
    return (value or "").strip().lower() in TRUE_VALUES


def _positive_int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _model_setting(explicit: str | None, variable: str) -> str | None:
    """An explicit ``none`` or empty value turns the tier off even when the environment names a
    model, so a project's switch file can opt out of a machine-wide setting."""

    value = (os.environ.get(variable) if explicit is None else explicit) or ""
    return None if value.strip().lower() in {"", "none"} else value.strip()


def _budget_setting(explicit: int | None, variable: str, name: str) -> int | None:
    if explicit is None:
        raw = os.environ.get(variable, "").strip()
        try:
            explicit = int(raw) if raw else None
        except ValueError:
            raise ValueError(f"{variable} must be a whole number of milliseconds") from None
    if explicit is not None and explicit <= 0:
        raise ValueError(f"{name} must be positive")
    return explicit


def _unit_setting(explicit: float | None, variable: str, name: str) -> float | None:
    if explicit is None:
        raw = os.environ.get(variable, "").strip()
        try:
            explicit = float(raw) if raw else None
        except ValueError:
            raise ValueError(f"{variable} must be a number between 0 and 1") from None
    if explicit is not None and not 0.0 <= explicit <= 1.0:
        raise ValueError(f"{name} must be between 0 and 1")
    return explicit


def _tier_floor(backend: Any) -> float | None:
    value = getattr(backend, "min_confidence", None)
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


class _Unavailable:
    """A configured backend that cannot run; every call falls through to the next tier."""

    def __init__(self, reason: str) -> None:
        self.reason = reason

    def predict(self, state: Mapping[str, Any], questions: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
        raise LayaUnavailable(self.reason)


# The HTTP and subprocess adapters are imported only when configured, so the default
# deterministic path does not pay for urllib or subprocess at startup.
def _kev_backend(url: str, *, model: str, timeout_ms: int) -> Any:
    from .system_one import KevBackend

    return KevBackend(url, model=model, timeout_ms=timeout_ms)


def _jev_backend(*, model: str | None, timeout_ms: int) -> Any:
    from .system_one import JevBackend, jev_api_key

    key = jev_api_key()
    if not key:
        return _Unavailable("Jev is enabled but neither TYPESAFE_API_KEY nor TYPESAFE_KEY is set")
    return JevBackend(api_key=key, model=model, timeout_ms=timeout_ms)


def _ollama_backend(model: str, *, url: str | None, keep_alive: str | None, timeout_ms: int) -> Any:
    from .system_one import OllamaBackend

    return OllamaBackend(model, url=url, keep_alive=keep_alive, timeout_ms=timeout_ms)


def _clef_backend(*, url: str | None, model: str, timeout_ms: int, min_confidence: float | None) -> Any:
    from .system_one import ClefBackend

    return ClefBackend(url, model=model, timeout_ms=timeout_ms, min_confidence=min_confidence)


def _host_backend(host: str, *, model: str | None, effort: str, timeout_ms: int, workdir: str | None) -> Any:
    from .host_llm import HostLLMBackend

    return HostLLMBackend(host, model=model, effort=effort, timeout_ms=timeout_ms, workdir=workdir)


class DecisionEngine:
    """A safe advisory decision engine.

    ``backend='auto'`` uses deterministic policy unless a local model, a local Kev, Ollama, or
    Clef server, an opted-in Jev key, or an explicit host fallback is configured. A single instance
    keeps the optional MLX Agent resident, which avoids model reloads for the JSONL server and
    library callers that make repeated decisions.
    """

    def __init__(
        self,
        *,
        backend: str = "auto",
        model: str | None = None,
        host: str | None = None,
        host_model: str | None = None,
        effort: str = "low",
        fallback: str | None = None,
        kev_url: str | None = None,
        kev_model: str = "kev-latest",
        jev: bool | None = None,
        jev_model: str | None = None,
        ollama_model: str | None = None,
        ollama_url: str | None = None,
        ollama_keep_alive: str | None = None,
        ollama_timeout_ms: int | None = None,
        clef_model: str | None = None,
        clef_url: str | None = None,
        clef_timeout_ms: int | None = None,
        clef_min_confidence: float | None = None,
        consult: str | None = None,
        dtype: str = "float16",
        device: str | None = None,
        min_confidence: float = 0.65,
        timeout_ms: int = 2000,
        history_path: str | None = None,
        failure_threshold: int = 2,
        cooldown_s: float = 30.0,
    ) -> None:
        if backend not in BACKENDS:
            raise ValueError(f"backend must be one of: {', '.join(BACKENDS)}")
        if effort not in {"low", "medium", "high"}:
            raise ValueError("effort must be low, medium, or high")
        if fallback not in {None, *FALLBACKS}:
            raise ValueError(f"fallback must be one of: {', '.join(FALLBACKS)}")
        consult = consult or os.environ.get("VISTACK_LAYA_CONSULT") or "split"
        if consult not in CONSULT_MODES:
            raise ValueError("consult must be split or always")
        if not 0.0 <= min_confidence <= 1.0:
            raise ValueError("min_confidence must be between 0 and 1")
        if timeout_ms < 0:
            raise ValueError("timeout_ms must be zero or positive")
        if failure_threshold < 1 or cooldown_s < 0:
            raise ValueError("failure_threshold must be positive and cooldown_s zero or positive")
        env_enabled = os.environ.get("VISTACK_LAYA_ENABLED", "").strip().lower()
        # The environment switch is an emergency/CI-safe off switch.  It must
        # win even when a library caller explicitly requested the MLX backend;
        # otherwise a host-wide disable could be bypassed accidentally.
        self.backend_mode = "deterministic" if env_enabled in {"0", "false", "off", "no", "disabled"} else backend
        self.model = model or os.environ.get("VISTACK_LAYA_MODEL")
        self.host = host or os.environ.get("VISTACK_LAYA_HOST")
        self.host_model = host_model or os.environ.get("VISTACK_LAYA_HOST_MODEL")
        self.effort = effort
        self.fallback_mode = fallback or os.environ.get("VISTACK_LAYA_FALLBACK")
        self.kev_url = kev_url or os.environ.get("VISTACK_LAYA_KEV_URL")
        self.kev_model = kev_model or os.environ.get("VISTACK_LAYA_KEV_MODEL", "kev-latest")
        # Jev sends the bounded, redacted state to TypeSafe, so it joins the ladder only when
        # asked for: the setting, VISTACK_LAYA_JEV, or --fallback jev. A key alone is not intent.
        self.jev = (_flag(os.environ.get("VISTACK_LAYA_JEV")) if jev is None else jev) or self.fallback_mode == "jev" or backend == "jev"
        self.jev_model = jev_model or os.environ.get("VISTACK_LAYA_JEV_MODEL")
        self.ollama_model = _model_setting(ollama_model, "VISTACK_LAYA_OLLAMA_MODEL")
        self.ollama_url = ollama_url or os.environ.get("VISTACK_LAYA_OLLAMA_URL")
        self.ollama_keep_alive = ollama_keep_alive or os.environ.get("VISTACK_LAYA_OLLAMA_KEEP_ALIVE")
        self.ollama_timeout_ms = _budget_setting(ollama_timeout_ms, "VISTACK_LAYA_OLLAMA_TIMEOUT_MS", "ollama_timeout_ms") or max(
            timeout_ms, OLLAMA_MIN_TIMEOUT_MS
        )
        self.clef_model = _model_setting(clef_model, "VISTACK_LAYA_CLEF_MODEL")
        self.clef_url = clef_url or os.environ.get("VISTACK_LAYA_CLEF_URL")
        self.clef_timeout_ms = _budget_setting(clef_timeout_ms, "VISTACK_LAYA_CLEF_TIMEOUT_MS", "clef_timeout_ms") or max(
            timeout_ms, CLEF_MIN_TIMEOUT_MS
        )
        self.clef_min_confidence = _unit_setting(clef_min_confidence, "VISTACK_LAYA_CLEF_MIN_CONFIDENCE", "clef_min_confidence")
        self.consult = consult
        self.min_confidence = min_confidence
        self.timeout_ms = timeout_ms
        self.history = HistoryStore(history_path) if history_path else None
        # A backend that keeps failing is skipped for ``cooldown_s`` so a long-lived server
        # does not pay a connect or inference timeout on every request during an outage.
        self.failure_threshold = failure_threshold
        self.cooldown_s = cooldown_s
        self._failures: dict[str, int] = {}
        self._open_until: dict[str, float] = {}
        workdir = os.environ.get("VISTACK_LAYA_WORKDIR")
        self._dtype, self._device = dtype, device
        self._backend_name, self._backend = self._make_backend(self.backend_mode, dtype=dtype, device=device, workdir=workdir)
        # Kept as a small compatibility seam for embedders/tests that replace
        # the optional MLX adapter with a fake backend.
        self._mlx = self._backend if self._backend_name == "laya-mlx" else None
        self._fallbacks = self._make_fallbacks(self._backend_name, workdir=workdir) if self._backend_name else []
        self._fallback_name, self._fallback_backend = self._fallbacks[0] if self._fallbacks else (None, None)

    def _configured(self, mode: str) -> bool:
        if mode == "jev":
            return self.jev
        if mode == "clef":
            return bool(self.clef_model)
        if mode == "ollama":
            return bool(self.ollama_model)
        if mode == "mlx":
            return bool(self.model)
        if mode == "kev":
            return bool(self.kev_url)
        return self.fallback_mode == "host-llm" and bool(self.host)

    def _make_backend(
        self,
        mode: str,
        *,
        dtype: str,
        device: str | None,
        workdir: str | None,
    ) -> tuple[str | None, Any]:
        if mode == "deterministic":
            return None, None
        if mode == "auto":
            configured = [tier for tier in LADDER if self._configured(tier)]
            if not configured:
                return None, None
            mode = configured[0]
        if mode == "ollama" and not self.ollama_model:
            raise ValueError("ollama backend requires --ollama-model or VISTACK_LAYA_OLLAMA_MODEL")
        if mode == "clef" and not self.clef_model:
            raise ValueError("clef backend requires --clef-model or VISTACK_LAYA_CLEF_MODEL")
        if mode == "host-llm" and not self.host:
            raise ValueError("host-llm backend requires --host or VISTACK_LAYA_HOST")
        return self._tier(mode, dtype=dtype, device=device, workdir=workdir)

    def _tier(self, mode: str, *, dtype: str, device: str | None, workdir: str | None) -> tuple[str, Any]:
        """Ollama and Clef are named for their model, so history and the ladder show
        ``ollama:nimble`` and ``clef:clef-flash``."""

        if mode == "jev":
            return "jev", _jev_backend(model=self.jev_model, timeout_ms=self.timeout_ms)
        if mode == "clef":
            name = (self.clef_model or "").rstrip("/").rsplit("/", 1)[-1]
            backend = _clef_backend(url=self.clef_url, model=name, timeout_ms=self.clef_timeout_ms, min_confidence=self.clef_min_confidence)
            return f"clef:{name}", backend
        if mode == "ollama":
            backend = _ollama_backend(
                self.ollama_model or "", url=self.ollama_url, keep_alive=self.ollama_keep_alive, timeout_ms=self.ollama_timeout_ms
            )
            return f"ollama:{self.ollama_model}", backend
        if mode == "mlx":
            return "laya-mlx", MLXBackend(self.model, dtype=dtype, device=device)
        if mode == "kev":
            return "kev", _kev_backend(self.kev_url or "http://127.0.0.1:8009", model=self.kev_model, timeout_ms=self.timeout_ms)
        return "host-llm", self._host(workdir)

    def _host(self, workdir: str | None) -> Any:
        return _host_backend(
            self.host or "",
            model=self.host_model,
            effort=self.effort,
            timeout_ms=max(self.timeout_ms, 5000),
            workdir=workdir,
        )

    def _make_fallbacks(self, primary_name: str | None, *, workdir: str | None) -> list[tuple[str, Any]]:
        """Every configured tier after the primary, in ``LADDER`` order."""

        if self.fallback_mode == "none":
            return []
        tiers = (self._tier(mode, dtype=self._dtype, device=self._device, workdir=workdir) for mode in LADDER if self._configured(mode))
        return [tier for tier in tiers if tier[0] != primary_name]

    def ladder(self) -> list[tuple[str, Any]]:
        """The refinement tiers a split fork climbs, in order."""

        if self._backend is None or self._backend_name is None:
            return []
        primary = self._mlx if self._backend_name == "laya-mlx" else self._backend
        fallbacks = list(self._fallbacks)
        # Preserve the small adapter seam used by embedders that
        # replace the first optional backend after construction.
        if self._fallback_backend is not None and (not fallbacks or fallbacks[0][1] is not self._fallback_backend):
            fallbacks.insert(0, (self._fallback_name or "fallback", self._fallback_backend))
        return [(self._backend_name, primary), *fallbacks]

    def _id(self, request_id: str | None) -> str:
        return request_id or f"dec_{uuid.uuid4().hex[:16]}"

    def _decision(
        self,
        context: DecisionContext,
        draft: PolicyDraft,
        *,
        backend: str,
        fallback_used: bool,
        fallback_reason: str | None,
        decision_id: str,
        fork: str,
    ) -> Decision:
        decision = Decision(
            decision_id=decision_id,
            decision_type=context.decision_type,
            action=draft.action,
            confidence=round(float(draft.confidence), 4),
            rationale=draft.rationale,
            evidence_considered=tuple(item.ref for item in context.evidence),
            risks=tuple(draft.risks),
            required_evidence=tuple(draft.required_evidence),
            alternatives=tuple(Alternative(action=item[0], reason=item[1]) for item in draft.alternatives),
            change_conditions=tuple(draft.change_conditions),
            outputs=draft.outputs,
            probabilities=draft.probabilities,
            backend=backend,
            fallback_used=fallback_used,
            fallback_reason=fallback_reason,
            fork=fork,
        )
        decision.validate(available_actions=_requested_actions(context))
        return decision

    def _fallback(
        self,
        context: DecisionContext,
        draft: PolicyDraft,
        *,
        reason: str,
        decision_id: str,
    ) -> Decision:
        risks = tuple(draft.risks) + (f"Laya refinement was not used: {reason}.",)
        fallback_draft = replace(draft, risks=risks, outputs={**dict(draft.outputs), "fallback": True})
        return self._decision(
            context,
            fallback_draft,
            backend="deterministic-fallback",
            fallback_used=True,
            fallback_reason=reason,
            decision_id=decision_id,
            fork="split",
        )

    def _model_draft(
        self,
        context: DecisionContext,
        result: Mapping[str, Any],
        baseline: PolicyDraft,
        backend_name: str = "laya-mlx",
    ) -> tuple[PolicyDraft | None, str | None]:
        decision_type = context.decision_type
        selected: str | None = None
        confidence_parts: list[float] = []
        outputs: dict[str, Any] = {}
        probabilities: dict[str, float] = {}

        if decision_type == "intake-analysis":
            task_type_answer = _answer(result, "task_type")
            readiness_answer = _answer(result, "readiness")
            task_type = _choice(task_type_answer)
            readiness = _choice(readiness_answer)
            if not task_type or not readiness:
                return None, "missing typed intake answer"
            ambiguity = _noul_probability(_answer(result, "ambiguity"))
            if ambiguity is not None and ambiguity >= 0.5:
                selected = "clarify"
                readiness = "needs-clarification"
            elif readiness == "needs-clarification":
                selected = "clarify"
            elif readiness == "needs-investigation":
                selected = "investigate"
            elif readiness == "ready":
                selected = "ready-for-implementation" if baseline.action == "ready-for-implementation" else "ready-for-grooming"
            else:
                selected = "ready-for-grooming"
            outputs.update(
                {"classification": task_type, "classification_confidence": round(_confidence(task_type_answer), 4), "readiness": readiness}
            )
            # The action follows readiness and ambiguity; the task class is reported, not decided.
            confidence_parts = [_confidence(readiness_answer)]
            if ambiguity is not None:
                confidence_parts.append(_confidence(_answer(result, "ambiguity")))
            probabilities = _probabilities(readiness_answer)
        elif decision_type == "grooming":
            answer = _answer(result, "readiness")
            decomposition = _choice(_answer(result, "decomposition"))
            selected = _choice(answer) if _choice(answer) in ACTIONS_BY_TYPE[decision_type] else None
            if not selected:
                return None, "invalid typed grooming answer"
            outputs.update({"ready": selected == "ready", "model_decomposition": decomposition})
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
        elif decision_type == "playbook-selection":
            answer = _answer(result, "playbook")
            selected = _choice(answer)
            if not selected:
                return None, "missing typed playbook answer"
            conflict = _noul_probability(_answer(result, "route_conflict"))
            if conflict is not None and conflict >= 0.5 and selected != baseline.action:
                return None, "model flagged a fence conflict for its own route"
            outputs.update({"playbook": selected})
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
        elif decision_type == "decomposition":
            answer = _answer(result, "shape")
            selected = _choice(answer)
            if selected not in ACTIONS_BY_TYPE[decision_type]:
                return None, "invalid typed decomposition answer"
            outputs.update({"shape": selected, "model_shared_conflict": _answer(result, "shared_conflict")})
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
        elif decision_type == "tier-selection":
            answer = _answer(result, "tier")
            selected = _choice(answer)
            if selected not in ACTIONS_BY_TYPE[decision_type]:
                return None, "invalid typed tier answer"
            outputs.update(
                {
                    "tier": selected,
                    "role": TIER_ROLES[selected],
                    "model_contract_change": _answer(result, "contract_change"),
                }
            )
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
        elif decision_type == "dispatch-readiness":
            answer = _answer(result, "readiness")
            selected = _choice(answer)
            if selected not in ACTIONS_BY_TYPE[decision_type]:
                return None, "invalid typed dispatch answer"
            role_answer = _answer(result, "role")
            outputs.update(
                {"ready": selected == "dispatch", "role": _choice(role_answer), "role_confidence": round(_confidence(role_answer), 4)}
            )
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
        elif decision_type == "runtime-progress":
            answer = _answer(result, "next")
            selected = _choice(answer)
            if selected not in ACTIONS_BY_TYPE[decision_type]:
                return None, "invalid typed runtime answer"
            outputs.update({"model_stalled": _answer(result, "stalled")})
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
        elif decision_type == "verification":
            answer = _answer(result, "result")
            selected = _choice(answer)
            if selected not in ACTIONS_BY_TYPE[decision_type]:
                return None, "invalid typed verification answer"
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
            outputs.update({"model_result": selected})
        elif decision_type == "skill-improvement":
            answer = _answer(result, "change")
            selected = _choice(answer)
            if selected not in ACTIONS_BY_TYPE[decision_type]:
                return None, "invalid typed skill-improvement answer"
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
            outputs.update({"model_change": selected})
        elif decision_type in OPEN_ACTION_TYPES:
            name = "tool" if decision_type == "tool-selection" else "file"
            answer = _answer(result, name)
            selected = _choice(answer)
            if selected not in context.available_actions:
                return None, f"invalid typed {name} answer"
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
            outputs.update({name: selected})
        if selected is None:
            return None, "no typed answer was selected"
        confidence = min(confidence_parts) if confidence_parts else 0.0
        return (
            PolicyDraft(
                action=selected,
                confidence=confidence,
                rationale=f"A typed model answer selected {selected}; deterministic safety gates remain authoritative.",
                risks=baseline.risks,
                required_evidence=baseline.required_evidence,
                alternatives=baseline.alternatives,
                change_conditions=baseline.change_conditions,
                outputs={**dict(baseline.outputs), **outputs, "model": backend_name},
                probabilities=probabilities,
            ),
            None,
        )

    def _safe_model_draft(
        self,
        context: DecisionContext,
        baseline: PolicyDraft,
        model_draft: PolicyDraft,
        min_confidence: float | None = None,
    ) -> tuple[bool, str | None]:
        allowed = _requested_actions(context)
        threshold = self.min_confidence if min_confidence is None else min_confidence
        if model_draft.action not in allowed:
            return False, "model action is not available in the context"
        if model_draft.confidence < threshold:
            return False, f"confidence {model_draft.confidence:.3f} is below {threshold:.3f}"
        if context.decision_type == "verification" and model_draft.action == "accept" and not verification_sufficient(context):
            return False, "evidence gate rejected accept because criteria are not fully covered"
        if context.decision_type == "dispatch-readiness" and model_draft.action == "dispatch" and baseline.action != "dispatch":
            return False, "deterministic dispatch readiness gate rejected dispatch"
        if context.decision_type == "grooming" and model_draft.action == "ready" and baseline.action != "ready":
            return False, "deterministic grooming gate rejected ready"
        if context.decision_type == "grooming" and baseline.action == "split" and model_draft.action != "split":
            return False, "deterministic size gate requires split above the changed-line limit"
        if context.decision_type == "intake-analysis" and model_draft.action == "ready-for-implementation" and baseline.action != "ready-for-implementation":
            return False, "deterministic intake gate rejected ready-for-implementation"
        if context.decision_type == "playbook-selection" and model_draft.action != baseline.action:
            # Current state (blocked, paused, at QA) and an explicit unattended handoff are
            # facts, not interpretations; a model may not route around them.
            if baseline.outputs.get("route_source") in {"state", "handoff"}:
                return False, f"deterministic route gate kept {baseline.action} from explicit state or handoff"
            if model_draft.action in {"overnight", "autopilot-stack", "autopilot-full"}:
                return False, "unattended routes require an explicit handoff in the request"
        if context.decision_type == "decomposition":
            if model_draft.action == "parallelize" and (
                baseline.outputs.get("shared_file_conflict") or baseline.outputs.get("dependencies")
            ):
                return False, "deterministic conflict gate rejected parallelize"
            if model_draft.action == "parallelize" and baseline.action == "sequence":
                return False, "deterministic dependency gate rejected parallelize"
            if baseline.action == "split" and model_draft.action != "split":
                return False, "deterministic size gate requires split above the changed-line limit"
        if context.decision_type == "runtime-progress":
            if baseline.action == "escalate" and model_draft.action != "escalate":
                return False, "deterministic fence gate requires escalation"
            if model_draft.action in {"continue", "retry"} and baseline.action in {"block", "pause"}:
                return False, "deterministic runtime gate rejected continuing"
            if model_draft.action == "continue" and baseline.action == "retry":
                return False, "deterministic stall gate rejected continuing a stalled lane"
        if context.decision_type == "tier-selection" and model_draft.action == "mechanical" and baseline.action == "complex":
            if baseline.outputs.get("tier_mismatch") or baseline.outputs.get("flags") or baseline.outputs.get("complex_signals"):
                return False, "deterministic tier gate kept evidenced complex work on the complex tier"
        if context.decision_type == "skill-improvement" and model_draft.action == "propose-change" and baseline.action != "propose-change":
            return False, "deterministic history gate requires repeated evidence before proposing a change"
        if context.decision_type in OPEN_ACTION_TYPES:
            key = "tools" if context.decision_type == "tool-selection" else "file_summaries"
            described = option_descriptions(context, key).get(model_draft.action, model_draft.action)
            if irreversible(f"{model_draft.action} {described}"):
                return False, "an irreversible option stays with the main session"
        return True, None

    def warm(self) -> None:
        """Load configured local models before the first request; failures stay fallbackable."""

        for _, backend in self.ladder():
            warm = getattr(backend, "warm", None)
            if callable(warm):
                try:
                    warm()
                except LayaUnavailable:
                    continue

    def _predict_with_timeout(
        self,
        backend: Any,
        state: Mapping[str, Any],
        questions: Mapping[str, Mapping[str, Any]],
    ) -> dict[str, Any]:
        if backend is None:
            raise LayaUnavailable("no refinement backend is configured")
        # Model load is a one-time cost. Charging it to the per-call budget would time out
        # the first request, discard the half-loaded model, and repeat on every request.
        warm = getattr(backend, "warm", None)
        if callable(warm):
            warm()
        if (
            self.timeout_ms == 0
            or not hasattr(signal, "SIGALRM")
            or threading.current_thread() is not threading.main_thread()
        ):
            return backend.predict(state, questions)
        # A backend that declares its own budget (Ollama, the host CLI) is timed by it, so the
        # engine default cannot kill a call the backend was built to wait for.
        budget_ms = _positive_int(getattr(backend, "timeout_ms", None)) or self.timeout_ms

        def alarm_handler(_signum: int, _frame: Any) -> None:
            raise InferenceTimeout(f"inference exceeded {budget_ms} ms")

        previous_handler = signal.getsignal(signal.SIGALRM)
        previous_timer = signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, alarm_handler)
        signal.setitimer(signal.ITIMER_REAL, budget_ms / 1000.0)
        try:
            return backend.predict(state, questions)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous_handler)
            if previous_timer[0] > 0:
                signal.setitimer(signal.ITIMER_REAL, previous_timer[0], previous_timer[1])

    def _ask(
        self,
        context: DecisionContext,
        backend: Any,
        questions: Mapping[str, Mapping[str, Any]],
        states: dict[int, dict[str, Any]],
    ) -> dict[str, Any]:
        """Predict on a state sized to the backend's budget, built once per budget per decision.

        A context overflow is retried once on a state shrunk to the reported window; only a
        failed retry reaches the caller, so an overflow alone never trips the breaker.
        """

        budget = _positive_int(getattr(backend, "max_state_chars", None)) or MAX_STATE_CHARS
        if budget not in states:
            states[budget] = state_for_laya(context, max_chars=budget)
        state = states[budget]
        try:
            return self._predict_with_timeout(backend, state, questions)
        except ContextOverflow as exc:
            size = len(json.dumps(state, sort_keys=True, ensure_ascii=False))
            ratio = exc.limit_tokens / max(exc.prompt_tokens, 1)
            smaller = state_for_laya(context, max_chars=max(MIN_STATE_CHARS, int(size * ratio * OVERFLOW_HEADROOM)))
            if smaller == state:
                raise
            return self._predict_with_timeout(backend, smaller, questions)

    def _try_backend(
        self,
        context: DecisionContext,
        baseline: PolicyDraft,
        backend_name: str,
        backend: Any,
        questions: Mapping[str, Mapping[str, Any]],
        states: dict[int, dict[str, Any]],
    ) -> tuple[PolicyDraft | None, str | None]:
        open_until = self._open_until.get(backend_name, 0.0)
        if open_until > time.monotonic():
            return None, f"skipped for {open_until - time.monotonic():.0f}s after repeated failures"
        try:
            raw = self._ask(context, backend, questions, states)
        except Exception as exc:  # An advisory engine must not break orchestration.
            failures = self._failures.get(backend_name, 0) + 1
            self._failures[backend_name] = failures
            if failures >= self.failure_threshold:
                self._open_until[backend_name] = time.monotonic() + self.cooldown_s
            return None, str(exc) or type(exc).__name__
        self._failures[backend_name] = 0
        self._open_until.pop(backend_name, None)
        try:
            model_draft, error = self._model_draft(context, raw, baseline, backend_name)
        except Exception as exc:
            return None, f"malformed typed model output: {exc}"
        if model_draft is None:
            return None, error or "invalid typed model output"
        floor = _tier_floor(backend)
        threshold = self.min_confidence if floor is None else max(self.min_confidence, floor)
        safe, safety_error = self._safe_model_draft(context, baseline, model_draft, threshold)
        if not safe:
            return None, safety_error or "safety gate rejected model output"
        return model_draft, None

    def _climb(
        self,
        context: DecisionContext,
        baseline: PolicyDraft,
        ladder: list[tuple[str, Any]],
    ) -> tuple[PolicyDraft | None, str | None, list[str]]:
        """Ask each tier in order; return the first answer that clears every gate."""

        questions = questions_for(context)
        states: dict[int, dict[str, Any]] = {}
        errors: list[str] = []
        for name, backend in ladder:
            draft, error = self._try_backend(context, baseline, name, backend, questions, states)
            if draft is not None:
                if draft.action == baseline.action:
                    # Two independent reads of the same fork; keep the policy's explanation.
                    draft = replace(
                        draft,
                        confidence=max(draft.confidence, baseline.confidence),
                        rationale=f"{baseline.rationale} {name} agreed at {draft.confidence:.2f}.",
                    )
                return draft, name, errors
            errors.append(f"{name} unavailable or rejected: {error}")
        return None, None, errors

    def _opinion(self, context: DecisionContext, baseline: PolicyDraft, ladder: list[tuple[str, Any]]) -> dict[str, Any]:
        """A model's answer on a sharp fork, recorded for evaluation and never applied."""

        questions = questions_for(context)
        states: dict[int, dict[str, Any]] = {}
        errors = []
        for name, backend in ladder:
            try:
                raw = self._ask(context, backend, questions, states)
                draft, error = self._model_draft(context, raw, baseline, name)
            except Exception as exc:
                draft, error = None, str(exc) or type(exc).__name__
            if draft is not None:
                return {
                    "backend": name,
                    "action": draft.action,
                    "confidence": round(float(draft.confidence), 4),
                    "agrees": draft.action == baseline.action,
                }
            errors.append(f"{name}: {error}")
        return {"error": "; ".join(errors) or "no refinement backend is configured"}

    def decide(
        self,
        context: DecisionContext | Mapping[str, Any],
        *,
        decision_type: str | None = None,
        request_id: str | None = None,
    ) -> Decision:
        ctx = context if isinstance(context, DecisionContext) else DecisionContext.from_dict(context, decision_type=decision_type)
        decision_id = self._id(request_id)
        baseline = evaluate(ctx)
        sharp = baseline.confidence >= self.min_confidence
        ladder = self.ladder()
        final: Decision
        if sharp or not ladder:
            # A sharp fork runs in code without a model turn. ``consult=always`` still asks the
            # ladder so history can compare the policy with a model, but never applies the answer.
            draft = baseline
            if sharp and ladder and self.consult == "always":
                draft = replace(baseline, outputs={**dict(baseline.outputs), "model_opinion": self._opinion(ctx, baseline, ladder)})
            final = self._decision(
                ctx,
                draft,
                backend="deterministic",
                fallback_used=False,
                fallback_reason=None,
                decision_id=decision_id,
                fork="sharp" if sharp else "split",
            )
        else:
            model_draft, name, errors = self._climb(ctx, baseline, ladder)
            if model_draft is not None and name is not None:
                final = self._decision(
                    ctx,
                    model_draft,
                    backend=name,
                    fallback_used=bool(errors),
                    fallback_reason="; ".join(errors) or None,
                    decision_id=decision_id,
                    fork="sharp",
                )
            else:
                final = self._fallback(ctx, baseline, reason="; ".join(errors), decision_id=decision_id)
        if self.history:
            self.history.append_decision(final, ctx)
        return final
