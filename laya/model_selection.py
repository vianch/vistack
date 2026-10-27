"""The model-selection fork: which model and effort one dispatch runs on.

Each agent file's frontmatter holds its role's default model and effort. The fork keeps that
default, steps up, or steps down along ``RUNGS``, and returns the absolute model and effort so
the caller never recomputes the ladder. The agent files are read from this package's plugin
root, never the working directory, which is the consuming repository.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import re
from typing import Any, Mapping

from .policy import TIER_FLAGS, PolicyDraft, _COMPLEX_WORK, _MECHANICAL_WORK, _acceptance_criteria, _common, _int, _items, _request
from .schema import DecisionContext


AGENTS_DIR = Path(__file__).resolve().parents[1] / "agents"

# The closed ladder, least capable and cheapest first. Fable is the advisor's model and sits off
# the ladder, as does any model an agent file names that is not listed here; such a role is
# pinned. A frontmatter with no effort sits on the first rung of its model.
RUNGS: tuple[tuple[str, str], ...] = (
    ("haiku", "medium"),
    ("sonnet", "medium"),
    ("sonnet", "high"),
    ("opus", "medium"),
    ("opus", "high"),
    ("opus", "xhigh"),
)
# A role whose model is part of its contract never moves: the advisor and the coordinator are
# fixed seats, design runners and reviewers are compared on one model (docs/guide/design.md),
# and the complex tier is the top rung by definition.
PINNED_ROLES = ("advisor", "coordinator", "design-runner", "reviewer", "senior-implementer")
# Mechanical-tier roles move effort only, within their own model. Complex work changes owner
# through tier-selection and tier-mismatch, never through a model step.
TIER_LOCKED_ROLES = ("implementer", "design-implementer")
SMALL_CHANGE_LINES = 50
LARGE_CHANGE_LINES = 300
MANY_FILES = 10
# Each acceptance criterion is at least one QA assertion point with its own screenshot.
MANY_CRITERIA = 8
# A model's step-down must clear this floor: on the labelled split forks hosted Jev stepped a
# documentation lookup down at 0.72, and a wrong step-down costs a retry that outspends the saving.
STEP_DOWN_FLOOR = 0.85
_FRONTMATTER = re.compile(r"\A---\n(.*?)\n---", re.S)


@lru_cache(maxsize=1)
def roster() -> dict[str, tuple[str | None, str | None]]:
    """Each role's frontmatter model and effort, keyed by agent name."""

    found: dict[str, tuple[str | None, str | None]] = {}
    for path in sorted(AGENTS_DIR.glob("*.md")):
        match = _FRONTMATTER.match(path.read_text(encoding="utf-8"))
        if not match:
            continue
        fields = {}
        for line in match.group(1).splitlines():
            key, separator, value = line.partition(":")
            if separator:
                fields[key.strip()] = value.strip().strip("\"'")
        found[fields.get("name") or path.stem] = (fields.get("model") or None, fields.get("effort") or None)
    return found


def rung_of(model: str | None, effort: str | None) -> int | None:
    if (model, effort) in RUNGS:
        return RUNGS.index((model, effort))
    if effort is None:
        return next((index for index, (name, _) in enumerate(RUNGS) if name == model), None)
    return None


def feasible(base: Mapping[str, Any], action: str) -> bool:
    rung = base.get("rung")
    if action == "keep":
        return True
    if rung is None:
        return False
    return rung < base["band_high"] if action == "step-up" else rung > base["band_low"]


def resolved(base: Mapping[str, Any], action: str) -> dict[str, Any]:
    """The base outputs with the dispatch model and effort for ``action``, clamped to the band."""

    rung = base.get("rung")
    target = rung
    if rung is not None and action != "keep":
        steps = max(1, _int(base.get("retries")) or 0) if action == "step-up" else -1
        target = min(max(rung + steps, base["band_low"]), base["band_high"])
    if target == rung:
        model, effort = base.get("default_model"), base.get("default_effort")
    else:
        model, effort = RUNGS[target]
    return {**base, "dispatch_model": model, "dispatch_effort": effort, "changed": target != rung}


def _baseline(context: DecisionContext) -> dict[str, Any]:
    role = str(context.task.get("role") or "")
    model, effort = roster().get(role, (None, None))
    if model is None:
        # A role with no agent file, such as a host's built-in type, names its own default.
        model, effort = context.task.get("model") or None, context.task.get("effort") or None
    rung = None if role in PINNED_ROLES else rung_of(model, effort)
    band = [index for index, (name, _) in enumerate(RUNGS) if role not in TIER_LOCKED_ROLES or name == model] or [0]
    return {
        "role": role,
        "pinned": rung is None,
        "default_model": model,
        "default_effort": effort,
        "rung": rung,
        "band_low": band[0],
        "band_high": band[-1],
        "retries": _int(context.current_state.get("retries")) or 0,
    }


def _signals(context: DecisionContext, retries: int) -> tuple[list[str], list[str]]:
    """Evidence for a more capable rung, and for a cheaper one."""

    task = context.task
    request = f"{_request(context)} {task.get('brief') or ''}".lower()
    lines = _int(task.get("estimated_changed_lines"))
    files = len(_items(task.get("writable_files") or task.get("files")))
    up = [f"retries:{retries}"] if retries else []
    up += [name for name in TIER_FLAGS if task.get(name)]
    if lines is not None and lines > LARGE_CHANGE_LINES:
        up.append(f"lines:{lines}")
    if files > MANY_FILES:
        up.append(f"files:{files}")
    criteria = len(_acceptance_criteria(context))
    if criteria > MANY_CRITERIA:
        up.append(f"criteria:{criteria}")
    up += sorted({match.group(0) for match in _COMPLEX_WORK.finditer(request)})
    down = [f"lines:{lines}"] if lines is not None and lines <= SMALL_CHANGE_LINES else []
    if task.get("pattern"):
        down.append("pattern")
    down += sorted({match.group(0) for match in _MECHANICAL_WORK.finditer(request)})
    return up, down


def _kind(signals: list[str], *prefixes: str) -> bool:
    return any(item.startswith(prefixes) for item in signals)


def select_model(context: DecisionContext) -> PolicyDraft:
    base = _baseline(context)
    up, down = _signals(context, base["retries"])
    base = {**base, "up_signals": up, "down_signals": down}
    role = base["role"] or "this role"

    def draft(action: str, confidence: float, rationale: str, **extra: Any) -> PolicyDraft:
        return _common(context, action=action, confidence=confidence, rationale=rationale, outputs=resolved(base, action), **extra)

    if str(context.constraints.get("host") or "").lower() == "codex":
        return draft("keep", 0.99, "Codex runs every role on the model the thread runs.")
    if base["default_model"] is None:
        return draft("keep", 0.99, f"No default model is known for {role}, so the host's own choice stands.")
    if base["pinned"]:
        return draft("keep", 0.99, f"The {role} role keeps its frontmatter model; its model is part of its contract.")

    # A wrong step-down costs a retry that burns more than it saved, so only retries and contract
    # flags step up in code, and a step-down in code needs size, pattern, and mechanical work.
    small, pattern = _kind(down, "lines:"), "pattern" in down
    mechanical = any(item != "pattern" and not item.startswith("lines:") for item in down)
    lean = "keep"
    if _kind(up, "retries:", *TIER_FLAGS):
        lean, confidence = "step-up", 0.92
        rationale = f"The dispatch carries {', '.join(up[:3])}, so it runs on a more capable rung."
    elif _kind(up, "lines:", "files:", "criteria:") and not down:
        lean, confidence = "step-up", 0.82
        rationale = f"The dispatch is larger than the role usually takes ({', '.join(up[:3])})."
    elif up:
        lean, confidence = "step-up", 0.55
        rationale = f"The dispatch names {', '.join(repr(item) for item in up[:3])}; whether the default rung holds is a judgment."
    elif small and pattern and mechanical:
        lean, confidence = "step-down", 0.8
        rationale = f"The dispatch is small mechanical work that follows a named pattern ({', '.join(down[:3])})."
    elif down:
        confidence = 0.6
        rationale = f"Some signals point to a cheaper rung ({', '.join(down[:3])}), but not size, pattern, and mechanical work together."
    else:
        confidence = 0.75
        rationale = f"No signal moves the {role} role off its frontmatter default."

    if not feasible(base, lean):
        edge = "top" if lean == "step-up" else "bottom"
        return draft(
            "keep",
            0.9,
            f"The {role} role is already on the {edge} rung its band allows.",
            risks=("A worker that needs more moves through tier-mismatch or the unblocker, not a model step.",) if lean == "step-up" else (),
        )
    alternatives = tuple((item, "Another rung the role's band allows.") for item in ("keep", "step-up", "step-down") if item != lean and feasible(base, item) and not (item == "step-down" and up))
    return draft(
        lean,
        confidence,
        rationale,
        alternatives=alternatives,
        conditions=("Re-run the fork with retries raised when this dispatch stalls or fails.",) if lean != "step-up" else (),
    )


def question(context: DecisionContext) -> dict[str, Any]:
    base = select_model(context).outputs
    role = base["role"] or "the role"
    default = f"{base['default_model']} at {base['default_effort'] or 'default'} effort"
    moves = {"keep": f"{role}'s default, {default}, fits this job"}
    if feasible(base, "step-up"):
        moves["step-up"] = "the job is riskier, larger, or has failed before: run one rung more capable"
    if feasible(base, "step-down"):
        moves["step-down"] = "the job is small, mechanical, and follows a named pattern: run one rung cheaper"
    return {"type": "choice", "instructions": "Which model rung should run this dispatch?", "criteria": moves}


def gate(baseline: PolicyDraft, answer: PolicyDraft) -> str | None:
    """Why a model's answer may not stand, or None when it may."""

    base, action = baseline.outputs, answer.action
    if action == baseline.action:
        return None
    if base.get("pinned"):
        return "deterministic model gate kept a pinned role on its frontmatter model"
    if not feasible(base, action):
        return "deterministic model gate found no rung in that direction within the role's band"
    if action == "step-down" and base.get("up_signals"):
        return "deterministic model gate rejected a step-down with retry, contract, size, or complex-work evidence"
    if action == "step-down" and answer.confidence < STEP_DOWN_FLOOR:
        return f"a model step-down needs {STEP_DOWN_FLOOR:.2f} confidence, not {answer.confidence:.3f}"
    return None
