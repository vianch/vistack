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
    "tier-selection",
    "model-selection",
    "dispatch-readiness",
    "runtime-progress",
    "verification",
    "skill-improvement",
    "tool-selection",
    "file-selection",
    "seat-model",
)

# These forks choose among options the caller supplies in ``available_actions``: the tools a
# step may use, or the candidate files it may open. They have no fixed vocabulary.
OPEN_ACTION_TYPES = ("tool-selection", "file-selection")
FORKS = ("sharp", "split")

PLAYBOOKS = (
    "intake",
    "investigation",
    "feature",
    "bug-fix",
    "refactor",
    "design-implementation",
    "perf-issue",
    "maintenance",
    "crash-hunt",
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
    "agent-design",
    "html-report",
    "improve",
)

ROLES = (
    "groomer",
    "analyst",
    "researcher",
    "planner",
    "implementer",
    "senior-implementer",
    "design-implementer",
    "unblocker",
    "pr-author",
    "qa-verifier",
    "health-check",
    "coordinator",
    "design-runner",
    "reviewer",
    "agent-designer",
    "advisor",
    "report-writer",
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
    "tier-selection": ("mechanical", "complex"),
    "model-selection": ("keep", "step-up", "step-down"),
    "dispatch-readiness": ("dispatch", "hold", "clarify", "serialize"),
    "runtime-progress": ("continue", "retry", "rescope", "block", "pause", "escalate"),
    "verification": ("accept", "request-evidence", "block", "escalate"),
    "skill-improvement": ("no-change", "collect-evidence", "propose-change"),
    "tool-selection": (),
    "file-selection": (),
    "seat-model": ("opus", "fable-advisor", "fable"),
}

TIER_ROLES = {"mechanical": "implementer", "complex": "senior-implementer"}

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


# A runner prints its verdict last, so the excerpt keeps the tail. 2,000 characters keep three
# excerpts inside Ollama's 6,000-character state.
OUTPUT_MAX_LINES = 60
OUTPUT_MAX_CHARS = 2000
TRIMMED = "...[earlier output trimmed]\n"


# A command can print a credential inside its own output, and that output goes to hosted models
# and to the history file. Key names are not enough there, so the text itself is scrubbed. Long
# hex strings (git SHAs, checksums) are left alone: they are not secrets, and only a sensitive
# key in front of one, ``secret=<hex>``, blanks it.
_SECRET_KEY = (
    rf"[\w-]*(?:{_SENSITIVE_KEY.pattern}|passwd|api[_-]?key|authorization|(?<![a-z])auth(?![a-z]))[\w-]*"
)
_SECRET_PATTERNS = (
    (
        re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|\Z)"),
        "[REDACTED]",
    ),
    (re.compile(r"(?P<scheme>\b[a-z][a-z0-9+.-]*://)[^\s/:@]+:[^\s/@]+@", re.I), r"\g<scheme>[REDACTED]@"),
    (re.compile(r"\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*"), "[REDACTED]"),
    (re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{16,}", re.I), "[REDACTED]"),
    (
        re.compile(r"\bBasic\s+(?:(?=[A-Za-z0-9+/]*[0-9+/])[A-Za-z0-9+/]{8,}={0,2}|[A-Za-z0-9+/]{8,}={1,2})"),
        "[REDACTED]",
    ),
    (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), "[REDACTED]"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}|\bgithub_pat_[A-Za-z0-9_]{22,}"), "[REDACTED]"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{20,}|\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|\bxox[abprs]-[A-Za-z0-9-]{10,}"), "[REDACTED]"),
    (
        re.compile(
            rf"(?P<head>{_SECRET_KEY}(?:\\?[\"'])?[ \t]*(?P<sep>[=:])(?P<gap>[ \t]*(?:\r?\n[ \t]*)?))"
            r"(?!(?:\\?[\"'])?\[REDACTED\])(?P<value>"
            r'\\"(?:[^\\\n]|\\\\\\"|\\\\|\\[^"\n])*(?:\\"|(?=\n)|$)'
            r"|\"(?:[^\"\\\n]|\\.)*\"?"
            r"|'(?:[^'\\\n]|\\.)*'?"
            r"|(?:(?:Bearer|Basic|Digest|Token)[ \t]+)?[^\s\"',;&)}\]]+)",
            re.I,
        ),
        None,
    ),
)
_TEST_COUNT = re.compile(r"\d{1,6}")
_TEST_COUNT_NOUN = re.compile(
    r"[ \t]+(?:passed|passing|failed|failing|failures?|errors?|skipped|pending|checks?|tests?|specs?|suites?|assertions?|warnings?)\b", re.I
)
_PHRASE_WORD = re.compile(r"[a-z]{2,}")
_PHRASE_NEXT_WORD = re.compile(r"[ \t]+[a-z]{2,}\b")
_REST_OF_LINE = re.compile(r"[^\n]*")


def _not_a_credential(match: re.Match[str]) -> bool:
    value, after = match.group("value"), match.string[match.end() :]
    if "\n" in match.group("gap"):
        return bool(_REST_OF_LINE.match(after).group().strip())
    if _TEST_COUNT.fullmatch(value):
        return bool(_TEST_COUNT_NOUN.match(after))
    return match.group("sep") == ":" and bool(_PHRASE_WORD.fullmatch(value)) and bool(_PHRASE_NEXT_WORD.match(after))


def _blank_value(match: re.Match[str]) -> str:
    if _not_a_credential(match):
        return match.group(0)
    value = match.group("value")
    quote = next((mark for mark in ('\\"', '"', "'") if value.startswith(mark)), "")
    closed = quote and len(value) > len(quote) and value.endswith(quote)
    return f"{match.group('head')}{quote}[REDACTED]{quote if closed else ''}"


def scrub_secrets(text: str) -> str:
    """Replace secret-shaped substrings in command output with ``[REDACTED]``."""

    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement or _blank_value, text)
    return text


def trim_output(text: str, *, max_lines: int = OUTPUT_MAX_LINES, max_chars: int = OUTPUT_MAX_CHARS) -> str:
    lines = scrub_secrets(text).rstrip().splitlines()
    tail = "\n".join(lines[-max_lines:])
    if len(lines) <= max_lines and len(tail) <= max_chars:
        return tail
    return TRIMMED + tail[-max(1, max_chars - len(TRIMMED)) :]


def output_trimmed(text: str | None) -> bool:
    return bool(text) and text.startswith(TRIMMED)


@dataclass(frozen=True)
class Evidence:
    """An observed input. A model cannot create evidence; callers supply it."""

    kind: str
    ref: str
    summary: str = ""
    criterion: str | None = None
    status: str | None = None
    # An excerpt of a command's output captured after the last change.
    output: str | None = None

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
        criterion = value.get("criterion")
        status = value.get("status")
        output = value.get("output")
        return cls(
            kind=kind,
            ref=ref,
            summary=str(value.get("summary", "")),
            criterion=None if criterion is None else str(criterion),
            status=None if status is None else str(status),
            output=(trim_output(str(output)) or None) if output is not None else None,
        )


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
        if selected_type in OPEN_ACTION_TYPES and not available:
            raise ValueError(f"{selected_type} requires the candidate options in available_actions")
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
    # ``sharp`` runs in code; ``split`` goes back to the main session to decide.
    fork: str = "split"
    created_at: str = field(default_factory=utc_now)
    schema_version: str = SCHEMA_VERSION
    authority: str = "advisory-only"

    def validate(self, *, available_actions: tuple[str, ...] = ()) -> None:
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(f"unsupported decision schema_version {self.schema_version!r}")
        if self.decision_type not in DECISION_TYPES:
            raise ValueError(f"unknown decision type {self.decision_type!r}")
        if self.decision_type in OPEN_ACTION_TYPES:
            if self.action not in available_actions:
                raise ValueError(f"action {self.action!r} is not one of the supplied options")
        elif self.action not in ACTIONS_BY_TYPE[self.decision_type]:
            raise ValueError(f"action {self.action!r} is not valid for {self.decision_type}")
        if self.fork not in FORKS:
            raise ValueError("fork must be sharp or split")
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
