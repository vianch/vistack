"""Decision engine with deterministic policy, optional Laya-MLX refinement, and gates."""

from __future__ import annotations

import os
import signal
import threading
import time
import uuid
from typing import Any, Mapping

from .history import HistoryStore
from .mlx_backend import InferenceTimeout, LayaUnavailable, MLXBackend
from .policy import PolicyDraft, evaluate, verification_sufficient
from .questions import questions_for, state_for_laya
from .schema import (
    ACTIONS_BY_TYPE,
    Decision,
    DecisionContext,
    Alternative,
    default_actions,
    utc_now,
)


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
    try:
        value = float(answer.get("confidence", 0.0)) if answer else 0.0
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


# The HTTP and subprocess adapters are imported only when configured, so the default
# deterministic path does not pay for urllib or subprocess at startup.
def _kev_backend(url: str, *, model: str, timeout_ms: int) -> Any:
    from .kev_backend import KevBackend

    return KevBackend(url, model=model, timeout_ms=timeout_ms)


def _host_backend(host: str, *, model: str | None, effort: str, timeout_ms: int, workdir: str | None) -> Any:
    from .host_llm import HostLLMBackend

    return HostLLMBackend(host, model=model, effort=effort, timeout_ms=timeout_ms, workdir=workdir)


class DecisionEngine:
    """A safe advisory decision engine.

    ``backend='auto'`` uses deterministic policy unless a local model or an explicitly
    configured local/host fallback is available. A single instance keeps the optional MLX
    Agent resident, which avoids model reloads for the JSONL server and library callers that
    make repeated decisions.
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
        dtype: str = "float16",
        device: str | None = None,
        min_confidence: float = 0.65,
        timeout_ms: int = 2000,
        history_path: str | None = None,
        failure_threshold: int = 2,
        cooldown_s: float = 30.0,
    ) -> None:
        if backend not in {"auto", "deterministic", "mlx", "kev", "host-llm"}:
            raise ValueError("backend must be auto, deterministic, mlx, kev, or host-llm")
        if effort not in {"low", "medium", "high"}:
            raise ValueError("effort must be low, medium, or high")
        if fallback not in {None, "none", "kev", "host-llm"}:
            raise ValueError("fallback must be none, kev, or host-llm")
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
        self.min_confidence = min_confidence
        self.timeout_ms = timeout_ms
        self.history = HistoryStore(history_path) if history_path else None
        # A backend that keeps failing is skipped for ``cooldown_s`` so a long-lived server
        # does not pay a connect or inference timeout on every request during an outage.
        self.failure_threshold = failure_threshold
        self.cooldown_s = cooldown_s
        self._failures: dict[str, int] = {}
        self._open_until: dict[str, float] = {}
        self._backend_name, self._backend = self._make_backend(
            self.backend_mode,
            dtype=dtype,
            device=device,
            workdir=os.environ.get("VISTACK_LAYA_WORKDIR"),
        )
        # Kept as a small compatibility seam for embedders/tests that replace
        # the optional MLX adapter with a fake backend.
        self._mlx = self._backend if self._backend_name == "laya-mlx" else None
        self._fallbacks = self._make_fallbacks(
            self._backend_name,
            dtype=dtype,
            device=device,
            workdir=os.environ.get("VISTACK_LAYA_WORKDIR"),
        )
        self._fallback_name, self._fallback_backend = self._fallbacks[0] if self._fallbacks else (None, None)

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
            if self.model:
                mode = "mlx"
            elif self.kev_url:
                mode = "kev"
            elif self.fallback_mode == "host-llm" and self.host:
                mode = "host-llm"
            else:
                return None, None
        if mode == "mlx":
            return "laya-mlx", MLXBackend(self.model, dtype=dtype, device=device)
        if mode == "kev":
            return "kev", _kev_backend(self.kev_url or "http://127.0.0.1:8009", model=self.kev_model, timeout_ms=self.timeout_ms)
        if not self.host:
            raise ValueError("host-llm backend requires --host or VISTACK_LAYA_HOST")
        return "host-llm", _host_backend(
            self.host,
            model=self.host_model,
            effort=self.effort,
            timeout_ms=max(self.timeout_ms, 5000),
            workdir=workdir,
        )

    def _make_fallbacks(
        self,
        primary_name: str | None,
        *,
        dtype: str,
        device: str | None,
        workdir: str | None,
    ) -> list[tuple[str, Any]]:
        mode = self.fallback_mode
        if mode in {None, "", "none"}:
            return []
        fallbacks: list[tuple[str, Any]] = []
        # When host fallback is explicitly enabled, prefer a configured local
        # Kev service before sending the bounded context to a provider.
        if mode == "kev" and primary_name != "kev" and self.kev_url:
            fallbacks.append(("kev", _kev_backend(self.kev_url, model=self.kev_model, timeout_ms=self.timeout_ms)))
        if mode == "host-llm":
            if primary_name != "kev" and self.kev_url:
                fallbacks.append(("kev", _kev_backend(self.kev_url, model=self.kev_model, timeout_ms=self.timeout_ms)))
            if primary_name != "host-llm" and self.host:
                fallbacks.append(
                    (
                        "host-llm",
                        _host_backend(
                            self.host,
                            model=self.host_model,
                            effort=self.effort,
                            timeout_ms=max(self.timeout_ms, 5000),
                            workdir=workdir,
                        ),
                    )
                )
        return fallbacks

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
        fallback_draft = PolicyDraft(
            action=draft.action,
            confidence=draft.confidence,
            rationale=draft.rationale,
            risks=risks,
            required_evidence=draft.required_evidence,
            alternatives=draft.alternatives,
            change_conditions=draft.change_conditions,
            outputs={**dict(draft.outputs), "fallback": True},
            probabilities=draft.probabilities,
        )
        return self._decision(
            context,
            fallback_draft,
            backend="deterministic-fallback",
            fallback_used=True,
            fallback_reason=reason,
            decision_id=decision_id,
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
            outputs.update({"classification": task_type, "readiness": readiness})
            confidence_parts = [_confidence(task_type_answer), _confidence(readiness_answer)]
            if ambiguity is not None:
                confidence_parts.append(_confidence(_answer(result, "ambiguity")))
            probabilities = _probabilities(readiness_answer)
        elif decision_type == "grooming":
            answer = _answer(result, "readiness")
            decomposition = _choice(_answer(result, "decomposition"))
            selected = {"ready": "ready", "needs-information": "needs-information", "needs-decision": "needs-decision"}.get(
                _choice(answer) or ""
            )
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
        elif decision_type == "dispatch-readiness":
            answer = _answer(result, "readiness")
            selected = _choice(answer)
            if selected not in ACTIONS_BY_TYPE[decision_type]:
                return None, "invalid typed dispatch answer"
            role = _choice(_answer(result, "role"))
            outputs.update({"ready": selected == "dispatch", "role": role})
            confidence_parts = [_confidence(answer), _confidence(_answer(result, "role"))]
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
    ) -> tuple[bool, str | None]:
        allowed = _requested_actions(context)
        if model_draft.action not in allowed:
            return False, "model action is not available in the context"
        if model_draft.confidence < self.min_confidence:
            return False, f"confidence {model_draft.confidence:.3f} is below {self.min_confidence:.3f}"
        if context.decision_type == "verification" and model_draft.action == "accept" and not verification_sufficient(context):
            return False, "evidence gate rejected accept because criteria are not fully covered"
        if context.decision_type == "dispatch-readiness" and model_draft.action == "dispatch" and baseline.action != "dispatch":
            return False, "deterministic dispatch readiness gate rejected dispatch"
        if context.decision_type == "grooming" and model_draft.action == "ready" and baseline.action != "ready":
            return False, "deterministic grooming gate rejected ready"
        if context.decision_type == "intake-analysis" and model_draft.action == "ready-for-implementation" and baseline.action != "ready-for-implementation":
            return False, "deterministic intake gate rejected ready-for-implementation"
        if context.decision_type == "decomposition":
            if model_draft.action == "parallelize" and (context.task.get("shared_files") or context.task.get("conflicts")):
                return False, "deterministic conflict gate rejected parallelize"
            if model_draft.action == "parallelize" and baseline.action == "sequence":
                return False, "deterministic dependency gate rejected parallelize"
        if context.decision_type == "runtime-progress" and model_draft.action in {"continue", "retry"} and baseline.action in {"block", "pause", "escalate"}:
            return False, "deterministic runtime gate rejected continuing"
        if context.decision_type == "skill-improvement" and model_draft.action == "propose-change" and baseline.action != "propose-change":
            return False, "deterministic history gate requires repeated evidence before proposing a change"
        return True, None

    def warm(self) -> None:
        """Load configured local models before the first request; failures stay fallbackable."""

        for backend in (self._mlx if self._backend_name == "laya-mlx" else self._backend, *(item[1] for item in self._fallbacks)):
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

        def alarm_handler(_signum: int, _frame: Any) -> None:
            raise InferenceTimeout(f"inference exceeded {self.timeout_ms} ms")

        previous_handler = signal.getsignal(signal.SIGALRM)
        previous_timer = signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, alarm_handler)
        signal.setitimer(signal.ITIMER_REAL, self.timeout_ms / 1000.0)
        try:
            return backend.predict(state, questions)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous_handler)
            if previous_timer[0] > 0:
                signal.setitimer(signal.ITIMER_REAL, previous_timer[0], previous_timer[1])

    def _try_backend(
        self,
        context: DecisionContext,
        baseline: PolicyDraft,
        backend_name: str,
        backend: Any,
        state: Mapping[str, Any],
        questions: Mapping[str, Mapping[str, Any]],
    ) -> tuple[PolicyDraft | None, str | None]:
        open_until = self._open_until.get(backend_name, 0.0)
        if open_until > time.monotonic():
            return None, f"skipped for {open_until - time.monotonic():.0f}s after repeated failures"
        try:
            raw = self._predict_with_timeout(backend, state, questions)
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
        safe, safety_error = self._safe_model_draft(context, baseline, model_draft)
        if not safe:
            return None, safety_error or "safety gate rejected model output"
        return model_draft, None

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
        final: Decision
        if self._backend is None or self._backend_name is None:
            final = self._decision(
                ctx,
                baseline,
                backend="deterministic",
                fallback_used=False,
                fallback_reason=None,
                decision_id=decision_id,
            )
        else:
            primary_backend = self._mlx if self._backend_name == "laya-mlx" else self._backend
            state = state_for_laya(ctx)
            questions = questions_for(ctx)
            model_draft, primary_error = self._try_backend(
                ctx, baseline, self._backend_name, primary_backend, state, questions
            )
            if model_draft is not None:
                final = self._decision(
                    ctx,
                    model_draft,
                    backend=self._backend_name,
                    fallback_used=False,
                    fallback_reason=None,
                    decision_id=decision_id,
                )
            else:
                fallbacks = list(self._fallbacks)
                # Preserve the small adapter seam used by embedders that
                # replace the first optional backend after construction.
                if self._fallback_backend is not None and (
                    not fallbacks or fallbacks[0][1] is not self._fallback_backend
                ):
                    fallbacks.insert(0, (self._fallback_name or "fallback", self._fallback_backend))
                if not fallbacks:
                    final = self._fallback(
                        ctx,
                        baseline,
                        reason=f"{self._backend_name}: {primary_error}",
                        decision_id=decision_id,
                    )
                else:
                    fallback_draft = None
                    fallback_error = None
                    fallback_name = None
                    for candidate_name, candidate_backend in fallbacks:
                        fallback_name = candidate_name
                        fallback_draft, fallback_error = self._try_backend(
                            ctx,
                            baseline,
                            candidate_name,
                            candidate_backend,
                            state,
                            questions,
                        )
                        if fallback_draft is not None:
                            break
                    if fallback_draft is not None:
                        final = self._decision(
                            ctx,
                            fallback_draft,
                            backend=fallback_name or "fallback",
                            fallback_used=True,
                            fallback_reason=f"{self._backend_name} unavailable or rejected: {primary_error}",
                            decision_id=decision_id,
                        )
                    else:
                        fallback_label = fallback_name or self._fallback_name or "fallback"
                        final = self._fallback(
                            ctx,
                            baseline,
                            reason=(
                                f"{self._backend_name}: {primary_error}; "
                                f"{fallback_label}: {fallback_error}"
                            ),
                            decision_id=decision_id,
                        )
        if self.history:
            self.history.append_decision(final, ctx)
        return final
