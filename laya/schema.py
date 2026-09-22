"""Typed records shared by the local decision engine and its adapters."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
import re
from typing import Any, Mapping


SCHEMA_VERSION = "1"

DECISION_TYPES = (
    "intake-analysis",
    "grooming",
    "playbook-selection",
    "decomposition",
    "dispatch-readiness",
    "runtime-progress",
    "verification",
    "skill-improvement",
)

PLAYBOOKS = (
    "intake",
    "investigation",
    "feature",
    "bug-fix",
    "refactor",
    "design-implementation",
    "perf-issue",
    "prototype",
    "blocker",
    "pr-stack",
    "qa-verification",
    "autopilot-stack",
    "autopilot-full",
    "overnight",
    "multi-phase-plan",
    "session-pickup",
    "pause-safely",
    "babysit",
    "worktree-cleanup",
    "authoring-skill",
    "automate-me",
)

ROLES = (
    "groomer",
    "analyst",
    "planner",
    "implementer",
    "design-implementer",
    "unblocker",
    "pr-author",
    "qa-verifier",
    "health-check",
    "coordinator",
)

ACTIONS_BY_TYPE = {
    "intake-analysis": (
        "classify",
        "investigate",
        "clarify",
        "ready-for-grooming",
        "ready-for-implementation",
    ),
    "grooming": ("ready", "needs-information", "needs-decision", "split"),
    "playbook-selection": PLAYBOOKS,
    "decomposition": ("single-slice", "sequence", "parallelize", "split"),
    "dispatch-readiness": ("dispatch", "hold", "clarify", "serialize"),
    "runtime-progress": ("continue", "retry", "rescope", "block", "pause", "escalate"),
    "verification": ("accept", "request-evidence", "block", "escalate"),
    "skill-improvement": ("no-change", "collect-evidence", "propose-change"),
}

_SENSITIVE_KEY = re.compile(r"(token|secret|password|cookie|credential|private.?key)", re.I)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def redact(value: Any, *, max_string: int = 2400) -> Any:
    """Return a JSON-safe copy with common credential fields removed."""

    if isinstance(value, Mapping):
        return {
            str(key): "[REDACTED]" if _SENSITIVE_KEY.search(str(key)) else redact(item, max_string=max_string)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(item, max_string=max_string) for item in value]
    if isinstance(value, str) and len(value) > max_string:
        return value[:max_string] + "...[truncated]"
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


@dataclass(frozen=True)
class Evidence:
    """An observed input. A model cannot create evidence; callers supply it."""

    kind: str
    ref: str
    summary: str = ""

    @classmethod
    def from_value(cls, value: Any) -> "Evidence":
        if isinstance(value, str):
            return cls(kind="reference", ref=value)
        if not isinstance(value, Mapping):
            raise ValueError("evidence entries must be strings or objects")
        kind = value.get("kind", "reference")
        ref = value.get("ref")
        if not isinstance(kind, str) or not isinstance(ref, str) or not ref:
            raise ValueError("evidence entries require non-empty string kind and ref")
        return cls(kind=kind, ref=ref, summary=str(value.get("summary", "")))


@dataclass(frozen=True)
class DecisionContext:
    """The bounded, serializable input presented to a decision policy."""

    decision_type: str
    task: Mapping[str, Any] = field(default_factory=dict)
    playbook: str | None = None
    current_state: Mapping[str, Any] = field(default_factory=dict)
    evidence: tuple[Evidence, ...] = ()
    constraints: Mapping[str, Any] = field(default_factory=dict)
    history: tuple[Mapping[str, Any], ...] = ()
    available_actions: tuple[str, ...] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)
    schema_version: str = SCHEMA_VERSION

    @classmethod
    def from_dict(cls, value: Mapping[str, Any], *, decision_type: str | None = None) -> "DecisionContext":
        if not isinstance(value, Mapping):
            raise ValueError("decision context must be a JSON object")
        selected_type = decision_type or value.get("decision_type")
        if selected_type not in DECISION_TYPES:
            raise ValueError(f"decision_type must be one of {', '.join(DECISION_TYPES)}")
        supplied_version = value.get("schema_version", SCHEMA_VERSION)
        if supplied_version != SCHEMA_VERSION:
            raise ValueError(f"unsupported decision context schema_version {supplied_version!r}")
        evidence = tuple(Evidence.from_value(item) for item in value.get("evidence", ()))
        available = value.get("available_actions", ())
        if not isinstance(available, (list, tuple)) or not all(isinstance(item, str) for item in available):
            raise ValueError("available_actions must be a list of strings")
        return cls(
            decision_type=selected_type,
            task=redact(value.get("task", {})),
            playbook=value.get("playbook"),
            current_state=redact(value.get("current_state", {})),
            evidence=evidence,
            constraints=redact(value.get("constraints", {})),
            history=tuple(redact(item) for item in value.get("history", ())),
            available_actions=tuple(available),
            metadata=redact(value.get("metadata", {})),
            schema_version=SCHEMA_VERSION,
        )

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["evidence"] = [asdict(item) for item in self.evidence]
        return redact(result)


@dataclass(frozen=True)
class Alternative:
    action: str
    reason: str


@dataclass(frozen=True)
class Decision:
    """A machine-consumable advisory result. It never authorizes execution."""

    decision_id: str
    decision_type: str
    action: str
    confidence: float
    rationale: str
    evidence_considered: tuple[str, ...]
    risks: tuple[str, ...]
    required_evidence: tuple[str, ...]
    alternatives: tuple[Alternative, ...]
    change_conditions: tuple[str, ...]
    outputs: Mapping[str, Any]
    probabilities: Mapping[str, float]
    backend: str
    fallback_used: bool
    fallback_reason: str | None
    created_at: str = field(default_factory=utc_now)
    schema_version: str = SCHEMA_VERSION
    authority: str = "advisory-only"

    def validate(self, *, available_actions: tuple[str, ...] = ()) -> None:
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(f"unsupported decision schema_version {self.schema_version!r}")
        if self.decision_type not in DECISION_TYPES:
            raise ValueError(f"unknown decision type {self.decision_type!r}")
        if self.action not in ACTIONS_BY_TYPE[self.decision_type]:
            raise ValueError(f"action {self.action!r} is not valid for {self.decision_type}")
        if available_actions and self.action not in available_actions:
            raise ValueError(f"action {self.action!r} is not available in this context")
        if not 0.0 <= float(self.confidence) <= 1.0:
            raise ValueError("confidence must be between 0 and 1")
        if self.authority != "advisory-only":
            raise ValueError("decision authority must remain advisory-only")
        for label, probability in self.probabilities.items():
            if not isinstance(label, str) or not 0.0 <= float(probability) <= 1.0:
                raise ValueError("probabilities must map labels to values between 0 and 1")

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["alternatives"] = [asdict(item) for item in self.alternatives]
        result["evidence_considered"] = list(self.evidence_considered)
        result["risks"] = list(self.risks)
        result["required_evidence"] = list(self.required_evidence)
        result["change_conditions"] = list(self.change_conditions)
        result["outputs"] = redact(self.outputs)
        result["probabilities"] = dict(self.probabilities)
        return redact(result)

    def json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, ensure_ascii=False)


def default_actions(decision_type: str) -> tuple[str, ...]:
    if decision_type not in ACTIONS_BY_TYPE:
        raise ValueError(f"unknown decision type {decision_type!r}")
    return tuple(ACTIONS_BY_TYPE[decision_type])
