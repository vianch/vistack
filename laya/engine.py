"""Decision engine: deterministic policy, a refinement ladder, and safety gates.

The deterministic policy answers every fork first. A sharp answer runs in code without a
model turn. Only a split answer climbs the ladder — Jev when opted in, then Cloudflare Workers
AI when opted in and inside the free daily Neurons, then the local Ollama model — and the first
typed answer that clears the confidence threshold and every safety gate makes the fork sharp.
Anything else stays split and goes back to the main session.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import json
import math
import os
import signal
import threading
import time
import uuid
from typing import Any, Mapping

from .errors import ContextOverflow, InferenceTimeout, LayaUnavailable
from .history import HistoryStore
from .model_selection import gate as model_gate, move_for, resolved as model_outputs
from .policy import PolicyDraft, _request as request_text, evaluate, irreversible, judged_evidence, option_descriptions, verification_sufficient
from .questions import (
    ACTION_QUESTION,
    EXIT_OPTIONS,
    FILE_LEVELS,
    MAX_STATE_CHARS,
    NoQuestion,
    file_question,
    holds_question,
    questions_for,
    sent,
    state_for_laya,
)
from .schema import (
    ACTIONS_BY_TYPE,
    Decision,
    DecisionContext,
    Alternative,
    OPEN_ACTION_TYPES,
    TIER_ROLES,
    default_actions,
    output_trimmed,
    utc_now,
)
from .tier_report import NearMiss, near_miss_note, served_model, tally


BACKENDS = ("auto", "deterministic", "jev", "cloudflare", "ollama")
FALLBACKS = ("none", "jev", "cloudflare")
# Every refinement tier, best first: ``auto`` makes the first configured one the primary and the
# others follow. Opted-in Jev leads: it settled 7 of 10 labelled split forks, all correctly, at
# about 340 ms. Opted-in Cloudflare answers what Jev leaves, with clef-flash on Workers AI, only
# while the day's free Neurons last (``laya.cloudflare``). The local Ollama model answers the
# rest and everything after the cap, held to its own floor (``laya.ollama_models``); clef-flash
# alone settled 7 of 10 at that floor, none wrongly.
LADDER = ("jev", "cloudflare", "ollama")
CONSULT_MODES = ("split", "always")
TRUE_VALUES = {"1", "true", "on", "yes", "enabled"}
# The 2000 ms engine default timed out an earlier 9B decision model 11 times on the
# three-question intake and grooming schemas. clef-flash's warm split forks took at most
# 1.28 s; its load runs outside this timer.
OLLAMA_MIN_TIMEOUT_MS = 8000
# After a context overflow the state is shrunk to the reported window with this headroom,
# since the questions share the window and do not shrink with the state.
OVERFLOW_HEADROOM = 0.85
MIN_STATE_CHARS = 800
NOUL_NO = 0.4
NOUL_YES = 0.6
# Jev reports file scores to two decimals; closer scores are one reading.
SCORE_TIE = 0.05


@dataclass(frozen=True)
class Declined:
    """A tier answered its fork's exit option: the fork goes back split and the climb stops."""

    backend: str
    question: str
    answer: str
    confidence: float

    def outputs(self, decision_type: str) -> dict[str, Any]:
        found = {"declined": {"backend": self.backend, "question": self.question, "answer": self.answer, "confidence": round(self.confidence, 4)}}
        if decision_type == "tier-selection" and self.answer == "not-a-slice":
            found["slice_like"] = False
        return found

    def reason(self) -> str:
        return f"{self.backend} unavailable or rejected: answered {self.answer!r} to {self.question} at {self.confidence:.2f}, so the main session decides"


def _answer(result: Mapping[str, Any], name: str) -> Mapping[str, Any] | None:
    value = result.get("answers", {}).get(name)
    return value if isinstance(value, Mapping) else None


def _choice(answer: Mapping[str, Any] | None) -> str | None:
    value = answer.get("choice") if answer else None
    return value if isinstance(value, str) else None


def _offered_answers(result: Mapping[str, Any], asked: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    answers = result.get("answers") if isinstance(result.get("answers"), Mapping) else {}
    kept: dict[str, Any] = {}
    not_offered: dict[str, Any] = {}
    for name, answer in answers.items():
        if name not in asked:
            continue
        criteria = asked[name].get("criteria")
        if isinstance(criteria, Mapping) and isinstance(answer, Mapping) and answer.get("choice") not in criteria:
            not_offered[name] = answer.get("choice")
            continue
        kept[name] = answer
    return {**result, "answers": kept, **({"not_offered": not_offered} if not_offered else {})}


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _unit(value: Any) -> float | None:
    number = _finite_number(value)
    return None if number is None else max(0.0, min(1.0, number))


def _noul_probability(answer: Mapping[str, Any] | None) -> float | None:
    return _unit(answer.get("noul")) if answer else None


def _parsed_noul(answer: Mapping[str, Any] | None) -> dict[str, Any] | None:
    return {**answer, "noul": _noul_probability(answer)} if answer else None


def _confidence(answer: Mapping[str, Any] | None) -> float:
    if not answer:
        return 0.0
    if "confidence" not in answer:
        # Hosted Jev returns only P(true) for a noul; its confidence is the distance from 0.5.
        probability = _noul_probability(answer)
        return max(probability, 1.0 - probability) if probability is not None else 0.0
    return _unit(answer.get("confidence")) or 0.0


def _probabilities(answer: Mapping[str, Any] | None) -> dict[str, float]:
    if not answer or not isinstance(answer.get("probabilities"), Mapping):
        return {}
    found = {str(key): _unit(value) for key, value in answer["probabilities"].items()}
    return {} if None in found.values() else found


def _level(answer: Mapping[str, Any], levels: int) -> tuple[int, dict[int, float]]:
    found: dict[int, float] = {}
    for key, value in _probabilities(answer).items():
        if key.isdigit() and int(key) < levels:
            found[int(key)] = value
    if found:
        return max(found, key=lambda level: (found[level], -level)), found
    level = max(0, min(levels - 1, round(_finite_number(answer.get("score")) or 0.0)))
    return level, {level: _confidence(answer)}


def _ranking(context: DecisionContext, result: Mapping[str, Any]) -> list[dict[str, Any]] | None:
    found = []
    for index, path in enumerate(context.available_actions):
        answer = _answer(result, file_question(index))
        score = _finite_number(answer.get("score")) if answer else None
        if score is None:
            return None
        level, probabilities = _level(answer, len(FILE_LEVELS))
        found.append({"path": path, "score": round(score, 4), "level": level, "probabilities": probabilities})
    return sorted(found, key=lambda item: (-item["score"], -item["level"], item["path"]))


def _ranking_tie(ranking: list[dict[str, Any]]) -> list[str]:
    top = ranking[0]
    return [item["path"] for item in ranking if item["level"] >= top["level"] or top["score"] - item["score"] <= SCORE_TIE]


def _ranking_confidence(ranking: list[dict[str, Any]]) -> list[float]:
    level = ranking[0]["level"]
    top_at_its_level = ranking[0]["probabilities"].get(level, 0.0)
    others_below_it = [sum(value for below, value in item["probabilities"].items() if below < level) for item in ranking[1:]]
    return [top_at_its_level, *others_below_it]


def _sent_output(state: Mapping[str, Any], position: int, ref: str) -> str | None:
    entries = state.get("evidence") or []
    entry = entries[position] if position < len(entries) else None
    return entry.get("output") if isinstance(entry, Mapping) and entry.get("ref") == ref else None


def _verdict(
    context: DecisionContext, result: Mapping[str, Any], state: Mapping[str, Any]
) -> tuple[str | None, list[float], dict[str, Any], str | None]:
    brief_answer = _answer(result, "unjudgeable")
    unjudgeable = _noul_probability(brief_answer)
    reads = []
    unread = []
    for position, item, criterion in judged_evidence(context):
        output = _sent_output(state, position, item.ref)
        if not output:
            unread.append(item.ref)
            continue
        answer = _answer(result, holds_question(position))
        value = _noul_probability(answer)
        if value is None:
            return None, [], {}, f"missing typed answer for {item.ref!r}"
        reads.append({"ref": item.ref, "criterion": criterion, "noul": value, "confidence": _confidence(answer), "trimmed": output_trimmed(output)})
    if unjudgeable is None:
        return None, [], {}, "missing typed answer on whether the criteria can be judged"
    outputs = {"output_reads": [{key: read[key] for key in ("ref", "criterion", "noul")} for read in reads], "unjudgeable": unjudgeable}
    brief = _confidence(brief_answer)
    if unjudgeable >= NOUL_YES:
        return "escalate", [brief], outputs, None
    if unjudgeable >= NOUL_NO:
        return None, [], outputs, f"the unjudgeable answer {unjudgeable:.2f} is between {NOUL_NO} and {NOUL_YES}, so the model cannot tell"
    failing = [read for read in reads if read["noul"] < NOUL_NO]
    if failing:
        return "request-evidence", [brief, max(read["confidence"] for read in failing)], outputs, None
    unsure = next((read for read in reads if read["noul"] < NOUL_YES), None)
    if unsure:
        return None, [], outputs, f"the output of {unsure['ref']!r} reads {unsure['noul']:.2f} against its criterion, between {NOUL_NO} and {NOUL_YES}, so the model cannot tell"
    if unread:
        return None, [], outputs, f"the output of {unread[0]!r} is not in the state sent, so it was never read"
    trimmed = next((read for read in reads if read["trimmed"]), None)
    if trimmed:
        return None, [], outputs, f"the output of {trimmed['ref']!r} was trimmed before it was read, so a passing read cannot accept it"
    return "accept", [brief, *(read["confidence"] for read in reads)], outputs, None


def _exit_answer(context: DecisionContext, result: Mapping[str, Any]) -> tuple[str, str, float] | None:
    if context.decision_type == "file-selection":
        ranking = _ranking(context, result)
        if ranking and all(item["level"] == 0 for item in ranking):
            return "file", "none", min(item["probabilities"].get(0, 0.0) for item in ranking)
        return None
    name = ACTION_QUESTION[context.decision_type]
    answer = _answer(result, name)
    choice = _choice(answer)
    return (name, choice, _confidence(answer)) if choice in EXIT_OPTIONS else None


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


# The HTTP adapters are imported only when configured, so the default deterministic path does
# not pay for urllib at startup.
def _jev_backend(*, model: str | None, timeout_ms: int) -> Any:
    from .system_one import JevBackend, jev_api_key

    key = jev_api_key()
    if not key:
        return _Unavailable("Jev is enabled but neither TYPESAFE_API_KEY nor TYPESAFE_KEY is set")
    return JevBackend(api_key=key, model=model, timeout_ms=timeout_ms)


def _cloudflare_backend(*, timeout_ms: int | None) -> Any:
    from .cloudflare import DEFAULT_TIMEOUT_MS, cloudflare_credentials, daily_cap, missing_credentials
    from .system_one import CloudflareBackend

    token, account = cloudflare_credentials()
    if not token or not account:
        return _Unavailable(f"Cloudflare is enabled but {missing_credentials(token, account)}")
    # A mistyped variable turns the tier off with the reason rather than failing the engine.
    try:
        cap = daily_cap()
        budget_ms = _budget_setting(timeout_ms, "VISTACK_LAYA_CLOUDFLARE_TIMEOUT_MS", "cloudflare_timeout_ms") or DEFAULT_TIMEOUT_MS
    except ValueError as exc:
        return _Unavailable(str(exc))
    return CloudflareBackend(api_token=token, account_id=account, cap=cap, timeout_ms=budget_ms)


def _ollama_backend(model: str, *, url: str | None, keep_alive: str | None, timeout_ms: int, min_confidence: float | None) -> Any:
    from .system_one import OllamaBackend

    try:
        return OllamaBackend(model, url=url, keep_alive=keep_alive, timeout_ms=timeout_ms, min_confidence=min_confidence)
    except LayaUnavailable as exc:
        # An old switch file or shell can still name an unsupported model; the tier reports why
        # on every fork instead of failing the engine.
        return _Unavailable(str(exc))


class DecisionEngine:
    """A safe advisory decision engine.

    ``backend='auto'`` uses deterministic policy unless an opted-in hosted tier (Jev,
    Cloudflare) or an Ollama model is configured. A single instance keeps its backends and
    their failure counts, which the JSONL server and library callers that make repeated
    decisions reuse.
    """

    def __init__(
        self,
        *,
        backend: str = "auto",
        fallback: str | None = None,
        jev: bool | None = None,
        jev_model: str | None = None,
        cloudflare: bool | None = None,
        cloudflare_timeout_ms: int | None = None,
        ollama_model: str | None = None,
        ollama_url: str | None = None,
        ollama_keep_alive: str | None = None,
        ollama_timeout_ms: int | None = None,
        ollama_min_confidence: float | None = None,
        consult: str | None = None,
        min_confidence: float = 0.65,
        timeout_ms: int = 2000,
        history_path: str | None = None,
        failure_threshold: int = 2,
        cooldown_s: float = 30.0,
    ) -> None:
        if backend not in BACKENDS:
            raise ValueError(f"backend must be one of: {', '.join(BACKENDS)}")
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
        # win even when a library caller explicitly requested a model backend;
        # otherwise a host-wide disable could be bypassed accidentally.
        self.backend_mode = "deterministic" if env_enabled in {"0", "false", "off", "no", "disabled"} else backend
        self.fallback_mode = fallback or os.environ.get("VISTACK_LAYA_FALLBACK")
        # Jev sends the bounded, redacted state to TypeSafe, so it joins the ladder only when
        # asked for: the setting, VISTACK_LAYA_JEV, or --fallback jev. A key alone is not intent.
        self.jev = (_flag(os.environ.get("VISTACK_LAYA_JEV")) if jev is None else jev) or self.fallback_mode == "jev" or backend == "jev"
        self.jev_model = jev_model or os.environ.get("VISTACK_LAYA_JEV_MODEL")
        # Cloudflare also sends the state off the machine, so it joins the same way: the
        # setting, VISTACK_LAYA_CLOUDFLARE, --fallback cloudflare, or --backend cloudflare.
        self.cloudflare = (
            (_flag(os.environ.get("VISTACK_LAYA_CLOUDFLARE")) if cloudflare is None else cloudflare)
            or self.fallback_mode == "cloudflare"
            or backend == "cloudflare"
        )
        self.cloudflare_timeout_ms = cloudflare_timeout_ms
        self.ollama_model = _model_setting(ollama_model, "VISTACK_LAYA_OLLAMA_MODEL")
        self.ollama_url = ollama_url or os.environ.get("VISTACK_LAYA_OLLAMA_URL")
        self.ollama_keep_alive = ollama_keep_alive or os.environ.get("VISTACK_LAYA_OLLAMA_KEEP_ALIVE")
        self.ollama_timeout_ms = _budget_setting(ollama_timeout_ms, "VISTACK_LAYA_OLLAMA_TIMEOUT_MS", "ollama_timeout_ms") or max(
            timeout_ms, OLLAMA_MIN_TIMEOUT_MS
        )
        self.ollama_min_confidence = _unit_setting(
            ollama_min_confidence, "VISTACK_LAYA_OLLAMA_MIN_CONFIDENCE", "ollama_min_confidence"
        )
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
        self._backend_name, self._backend = self._make_backend(self.backend_mode)
        self._fallbacks = self._make_fallbacks(self._backend_name) if self._backend_name else []
        self._fallback_name, self._fallback_backend = self._fallbacks[0] if self._fallbacks else (None, None)

    def _configured(self, mode: str) -> bool:
        if mode == "jev":
            return self.jev
        if mode == "cloudflare":
            return self.cloudflare
        return bool(self.ollama_model)

    def _make_backend(self, mode: str) -> tuple[str | None, Any]:
        if mode == "deterministic":
            return None, None
        if mode == "auto":
            configured = [tier for tier in LADDER if self._configured(tier)]
            if not configured:
                return None, None
            mode = configured[0]
        if mode == "ollama" and not self.ollama_model:
            raise ValueError("ollama backend requires --ollama-model or VISTACK_LAYA_OLLAMA_MODEL")
        return self._tier(mode)

    def _tier(self, mode: str) -> tuple[str, Any]:
        """Ollama and Cloudflare are named for their model, so history and the ladder show
        ``ollama:clef-flash`` and ``cloudflare:clef-flash``."""

        if mode == "jev":
            return "jev", _jev_backend(model=self.jev_model, timeout_ms=self.timeout_ms)
        if mode == "cloudflare":
            from .cloudflare import BODY_MODEL

            return f"cloudflare:{BODY_MODEL}", _cloudflare_backend(timeout_ms=self.cloudflare_timeout_ms)
        backend = _ollama_backend(
            self.ollama_model or "",
            url=self.ollama_url,
            keep_alive=self.ollama_keep_alive,
            timeout_ms=self.ollama_timeout_ms,
            min_confidence=self.ollama_min_confidence,
        )
        return f"ollama:{self.ollama_model}", backend

    def _make_fallbacks(self, primary_name: str | None) -> list[tuple[str, Any]]:
        """Every configured tier after the primary, in ``LADDER`` order."""

        if self.fallback_mode == "none":
            return []
        tiers = (self._tier(mode) for mode in LADDER if self._configured(mode))
        return [tier for tier in tiers if tier[0] != primary_name]

    def ladder(self) -> list[tuple[str, Any]]:
        """The refinement tiers a split fork climbs, in order."""

        if self._backend is None or self._backend_name is None:
            return []
        fallbacks = list(self._fallbacks)
        # Preserve the small adapter seam used by embedders that
        # replace the first optional backend after construction.
        if self._fallback_backend is not None and (not fallbacks or fallbacks[0][1] is not self._fallback_backend):
            fallbacks.insert(0, (self._fallback_name or "fallback", self._fallback_backend))
        return [(self._backend_name, self._backend), *fallbacks]

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
        near_misses: tuple[NearMiss, ...] = (),
        declined: Declined | None = None,
    ) -> Decision:
        outputs = {**dict(draft.outputs), "fallback": True, **tally(draft.action, near_misses)}
        if declined is not None:
            outputs.update(declined.outputs(context.decision_type))
        fallback_draft = replace(draft, outputs=outputs)
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
        backend_name: str,
        state: Mapping[str, Any] | None = None,
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
            if ambiguity is not None and NOUL_NO <= ambiguity < NOUL_YES:
                return None, f"the ambiguity answer {ambiguity:.2f} is between {NOUL_NO} and {NOUL_YES}, so the model cannot tell"
            if ambiguity is not None and ambiguity >= NOUL_YES:
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
            selected = _choice(answer) if _choice(answer) in ACTIONS_BY_TYPE[decision_type] else None
            if not selected:
                return None, "invalid typed grooming answer"
            outputs.update({"ready": selected == "ready"})
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
            outputs.update({"shape": selected})
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
                    "model_contract_change": _parsed_noul(_answer(result, "contract_change")),
                }
            )
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
        elif decision_type == "model-selection":
            answer = _answer(result, "rung")
            selected = move_for(baseline.outputs, _choice(answer))
            if selected not in ACTIONS_BY_TYPE[decision_type]:
                return None, "invalid typed model-selection answer"
            outputs.update({**model_outputs(baseline.outputs, selected), "model_situation": _choice(answer)})
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
        elif decision_type == "seat-model":
            answer = _answer(result, "seat")
            selected = _choice(answer)
            if selected not in ACTIONS_BY_TYPE[decision_type]:
                return None, "invalid typed seat-model answer"
            outputs.update({"model_seat": selected})
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
        elif decision_type == "dispatch-readiness":
            answer = _answer(result, "readiness")
            selected = _choice(answer)
            if selected not in ACTIONS_BY_TYPE[decision_type]:
                return None, "invalid typed dispatch answer"
            outputs.update({"ready": selected == "dispatch"})
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
        elif decision_type == "runtime-progress":
            answer = _answer(result, "next")
            selected = _choice(answer)
            if selected not in ACTIONS_BY_TYPE[decision_type]:
                return None, "invalid typed runtime answer"
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
        elif decision_type == "verification" and judged_evidence(context):
            selected, confidence_parts, reads, error = _verdict(context, result, state_for_laya(context) if state is None else state)
            if selected is None:
                return None, error
            outputs.update({**reads, "model_result": selected})
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
        elif decision_type == "file-selection":
            ranking = _ranking(context, result)
            if not ranking:
                return None, "missing typed file score"
            selected = ranking[0]["path"]
            confidence_parts = _ranking_confidence(ranking)
            tied = _ranking_tie(ranking)
            outputs.update(
                {"file": selected, "ranking": [{"path": item["path"], "score": item["score"]} for item in ranking], **({"ranking_tie": tied} if len(tied) > 1 else {})}
            )
        elif decision_type == "tool-selection":
            answer = _answer(result, "tool")
            selected = _choice(answer)
            if selected not in context.available_actions:
                return None, "invalid typed tool answer"
            confidence_parts = [_confidence(answer)]
            probabilities = _probabilities(answer)
            outputs.update({"tool": selected})
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
        if model_draft.outputs.get("ranking_tie"):
            return False, f"{', '.join(model_draft.outputs['ranking_tie'])} tie at the top of the ranking by score or level, so the ranking picks no file"
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
            if irreversible(request_text(context)):
                return False, "the request names an irreversible action, so a model may not change its route"
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
        if context.decision_type == "model-selection":
            rejected = model_gate(baseline, model_draft)
            if rejected:
                return False, rejected
        if context.decision_type == "seat-model" and model_draft.action != baseline.action:
            return False, "deterministic seat gate: only named signals move the coordinator and advisor seats"
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
        # A backend that declares its own budget (Ollama) is timed by it, so the engine default
        # cannot kill a call the backend was built to wait for.
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
        states: dict[int, tuple[dict[str, Any], dict[str, dict[str, Any]]]],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Predict on a state sized to the backend's budget, built once per budget per decision,
        with only the questions that state can answer.

        A context overflow is retried once on a state shrunk to the reported window; only a
        failed retry reaches the caller, so an overflow alone never trips the breaker.
        """

        budget = _positive_int(getattr(backend, "max_state_chars", None)) or MAX_STATE_CHARS
        if budget not in states:
            states[budget] = sent(context, questions, max_chars=budget)
        state, asked = states[budget]
        try:
            return _offered_answers(self._predict_with_timeout(backend, state, asked), asked), state
        except ContextOverflow as exc:
            size = len(json.dumps(state, sort_keys=True, ensure_ascii=False))
            ratio = exc.limit_tokens / max(exc.prompt_tokens, 1)
            smaller, smaller_asked = sent(context, questions, max_chars=max(MIN_STATE_CHARS, int(size * ratio * OVERFLOW_HEADROOM)))
            if smaller == state:
                raise
            return _offered_answers(self._predict_with_timeout(backend, smaller, smaller_asked), smaller_asked), smaller

    def _try_backend(
        self,
        context: DecisionContext,
        baseline: PolicyDraft,
        backend_name: str,
        backend: Any,
        questions: Mapping[str, Mapping[str, Any]],
        states: dict[int, dict[str, Any]],
    ) -> tuple[PolicyDraft | None, str | None, NearMiss | None, Declined | None]:
        open_until = self._open_until.get(backend_name, 0.0)
        if open_until > time.monotonic():
            return None, f"skipped for {open_until - time.monotonic():.0f}s after repeated failures", None, None
        try:
            raw, state = self._ask(context, backend, questions, states)
        except NoQuestion as exc:
            return None, f"not asked: {exc}", None, None
        except Exception as exc:  # An advisory engine must not break orchestration.
            failures = self._failures.get(backend_name, 0) + 1
            self._failures[backend_name] = failures
            if failures >= self.failure_threshold:
                self._open_until[backend_name] = time.monotonic() + self.cooldown_s
            return None, str(exc) or type(exc).__name__, None, None
        self._failures[backend_name] = 0
        self._open_until.pop(backend_name, None)
        floor = _tier_floor(backend)
        threshold = self.min_confidence if floor is None else max(self.min_confidence, floor)
        exit_answer = _exit_answer(context, raw)
        if exit_answer is not None:
            question, answer, confidence = exit_answer
            if confidence >= threshold:
                return None, None, None, Declined(backend_name, question, answer, confidence)
            return None, f"answered {answer!r} to {question} at {confidence:.3f}, below {threshold:.3f}", None, None
        try:
            model_draft, error = self._model_draft(context, raw, baseline, backend_name, state)
        except Exception as exc:
            return None, f"malformed typed model output: {exc}", None, None
        if model_draft is None:
            unoffered = ", ".join(f"{choice!r} to {name}" for name, choice in raw.get("not_offered", {}).items())
            return None, f"answered {unoffered}, which the question did not offer" if unoffered else error or "invalid typed model output", None, None
        served = served_model(raw, backend)
        if served:
            model_draft = replace(model_draft, outputs={**dict(model_draft.outputs), "backend_model": served})
        safe, safety_error = self._safe_model_draft(context, baseline, model_draft, threshold)
        if not safe:
            if model_draft.confidence < threshold and self._safe_model_draft(context, baseline, model_draft, 0.0)[0]:
                miss = NearMiss(backend_name, model_draft.action, model_draft.confidence)
                return None, f"{safety_error}; {near_miss_note(miss, baseline.action)}", miss, None
            return None, safety_error or "safety gate rejected model output", None, None
        return model_draft, None, None, None

    def _climb(
        self,
        context: DecisionContext,
        baseline: PolicyDraft,
        ladder: list[tuple[str, Any]],
    ) -> tuple[PolicyDraft | None, str | None, list[str], tuple[NearMiss, ...], Declined | None]:
        """Ask each tier in order; return the first answer that clears every gate, or the first
        exit that clears the tier's floor, which ends the climb."""

        try:
            questions = questions_for(context)
        except NoQuestion as exc:
            return None, None, [f"not asked: {exc}"], (), None
        states: dict[int, tuple[dict[str, Any], dict[str, dict[str, Any]]]] = {}
        errors: list[str] = []
        near_misses: list[NearMiss] = []
        for name, backend in ladder:
            draft, error, miss, declined = self._try_backend(context, baseline, name, backend, questions, states)
            if miss is not None:
                near_misses.append(miss)
            if declined is not None:
                return None, None, [*errors, declined.reason()], tuple(near_misses), declined
            if draft is not None:
                if draft.action == baseline.action:
                    # Two independent reads of the same fork; keep the policy's explanation.
                    draft = replace(
                        draft,
                        confidence=max(draft.confidence, baseline.confidence),
                        rationale=f"{baseline.rationale} {name} agreed at {draft.confidence:.2f}.",
                    )
                return draft, name, errors, tuple(near_misses), None
            errors.append(f"{name} unavailable or rejected: {error}")
        return None, None, errors, tuple(near_misses), None

    def _opinion(self, context: DecisionContext, baseline: PolicyDraft, ladder: list[tuple[str, Any]]) -> dict[str, Any]:
        """A model's answer on a sharp fork, recorded for evaluation and never applied."""

        try:
            questions = questions_for(context)
        except NoQuestion as exc:
            return {"error": f"not asked: {exc}"}
        states: dict[int, tuple[dict[str, Any], dict[str, dict[str, Any]]]] = {}
        errors = []
        for name, backend in ladder:
            try:
                raw, state = self._ask(context, backend, questions, states)
                exit_answer = _exit_answer(context, raw)
                if exit_answer is not None:
                    return {"backend": name, "exit": exit_answer[1], "question": exit_answer[0], "confidence": round(exit_answer[2], 4)}
                draft, error = self._model_draft(context, raw, baseline, name, state)
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
        ladder = [] if baseline.outputs.get("slice_like") is False else self.ladder()
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
            model_draft, name, errors, near_misses, declined = self._climb(ctx, baseline, ladder)
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
                final = self._fallback(ctx, baseline, reason="; ".join(errors), decision_id=decision_id, near_misses=near_misses, declined=declined)
        if self.history:
            self.history.append_decision(final, ctx)
        return final
