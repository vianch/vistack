"""Deterministic viStack policy used as the baseline and safety fallback."""

from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Any, Mapping

from .schema import ACTIONS_BY_TYPE, DECISION_TYPES, DecisionContext, PLAYBOOKS, ROLES


@dataclass(frozen=True)
class PolicyDraft:
    action: str
    confidence: float
    rationale: str
    risks: tuple[str, ...]
    required_evidence: tuple[str, ...]
    alternatives: tuple[tuple[str, str], ...]
    change_conditions: tuple[str, ...]
    outputs: Mapping[str, Any]
    probabilities: Mapping[str, float]


def _task_text(context: DecisionContext) -> str:
    # Search observed values, not field names. Keys such as ``playbook``, ``skill``, and
    # ``verification_command`` are present in structured contexts and would otherwise create
    # false classifications.
    def observed(value: Any) -> list[Any]:
        if isinstance(value, Mapping):
            result: list[Any] = []
            for item in value.values():
                result.extend(observed(item))
            return result
        if isinstance(value, (list, tuple)):
            result = []
            for item in value:
                result.extend(observed(item))
            return result
        return [value]

    values = observed(context.task) + observed(context.playbook or "") + observed(context.current_state) + observed(context.constraints)
    return json.dumps(values, sort_keys=True, ensure_ascii=False).lower()


def _request(context: DecisionContext) -> str:
    task = context.task
    values = [task.get(key, "") for key in ("request", "title", "description", "summary")]
    return " ".join(str(value) for value in values if value).strip()


def _acceptance_criteria(context: DecisionContext) -> list[Any]:
    value = context.task.get("acceptance_criteria", ())
    if isinstance(value, str):
        return [value] if value.strip() else []
    return list(value) if isinstance(value, (list, tuple)) else []


def _has_finish_condition(context: DecisionContext) -> bool:
    task = context.task
    return bool(task.get("finish_condition") or task.get("done") or task.get("done_means"))


def _contains(text: str, *terms: str) -> bool:
    return any(term in text for term in terms)


def classify_task(context: DecisionContext) -> str:
    text = _task_text(context)
    if _contains(text, "figma", "design implementation", "visual parity"):
        return "design-implementation"
    if _contains(text, "performance", "latency", "slow", "throughput", "memory leak"):
        return "perf-issue"
    if _contains(text, "bug", "broken", "regression", "wrong", "fail", "failure"):
        return "bug-fix"
    if _contains(text, "refactor", "rename", "reorganize", "restructure", "migrate"):
        return "refactor"
    if _contains(text, "investigate", "why", "understand", "audit", "explain"):
        return "investigation"
    if _contains(text, "prototype", "experiment", "spike"):
        return "prototype"
    if _contains(text, "blocker", "blocked"):
        return "blocker"
    if _contains(text, "skill", "playbook", "workflow contract"):
        return "authoring-skill"
    if _contains(text, "preference", "working style", "mode skill"):
        return "automate-me"
    if _contains(text, "clean worktree", "stale worktree"):
        return "worktree-cleanup"
    if _contains(text, "pause", "stop safely"):
        return "pause-safely"
    if _contains(text, "resume", "pick up", "session pickup"):
        return "session-pickup"
    if _contains(text, "qa", "verify", "verification", "screenshot evidence"):
        return "qa-verification"
    if _contains(text, "build", "add", "implement", "create", "introduce"):
        return "feature"
    return "unclear"


def select_playbook(context: DecisionContext) -> tuple[str, float, str]:
    text = _task_text(context)
    state = {str(key).lower(): value for key, value in context.current_state.items()}
    phase = str(state.get("phase", "")).lower()
    if phase == "blocked" or state.get("blockers"):
        return "blocker", 0.96, "The current state contains an unresolved blocker."
    if phase == "paused":
        return "pause-safely", 0.94, "The current state is paused and needs a resumable stop."
    if phase in {"qa", "verification"}:
        return "qa-verification", 0.92, "The current state is at behavioral verification."
    if _contains(text, "going to bed", "step away", "overnight"):
        return "overnight", 0.96, "The request explicitly names an unattended handoff."
    if _contains(text, "autopilot full", "independent pr", "independent queue"):
        return "autopilot-full", 0.93, "The request names independent work items for parallel execution."
    if _contains(text, "autopilot", "unattended"):
        return "autopilot-stack", 0.9, "The request names unattended execution for a groomed unit."
    classification = classify_task(context)
    if classification in PLAYBOOKS:
        return classification, 0.86, f"The request matches the {classification} task signals."
    if _contains(text, "large", "cross-cutting", "many services", "program"):
        return "multi-phase-plan", 0.78, "The request describes cross-cutting work without a narrower route."
    if not _acceptance_criteria(context):
        return "intake", 0.78, "The request has not supplied acceptance criteria."
    return "feature", 0.68, "The request contains implementation intent and acceptance criteria."


def evidence_refs(context: DecisionContext) -> tuple[str, ...]:
    return tuple(item.ref for item in context.evidence)


def verification_sufficient(context: DecisionContext) -> bool:
    criteria = _acceptance_criteria(context)
    if not criteria or not context.evidence:
        return False
    accepted_kinds = {"command", "test", "test-output", "artifact", "screenshot", "response", "file"}
    usable = [item for item in context.evidence if item.kind in accepted_kinds]
    return len(usable) >= len(criteria)


def _common(
    context: DecisionContext,
    *,
    action: str,
    confidence: float,
    rationale: str,
    risks: tuple[str, ...] = (),
    required: tuple[str, ...] = (),
    alternatives: tuple[tuple[str, str], ...] = (),
    conditions: tuple[str, ...] = (),
    outputs: Mapping[str, Any] | None = None,
) -> PolicyDraft:
    return PolicyDraft(
        action=action,
        confidence=confidence,
        rationale=rationale,
        risks=risks,
        required_evidence=required,
        alternatives=alternatives,
        change_conditions=conditions,
        outputs=outputs or {},
        probabilities={action: confidence},
    )


def evaluate(context: DecisionContext) -> PolicyDraft:
    """Evaluate a context without importing MLX or making external calls."""

    decision_type = context.decision_type
    if decision_type not in DECISION_TYPES:
        raise ValueError(f"unknown decision type {decision_type!r}")
    text = _task_text(context)
    criteria = _acceptance_criteria(context)
    refs = evidence_refs(context)

    if decision_type == "intake-analysis":
        classification = classify_task(context)
        if not _request(context):
            return _common(
                context,
                action="clarify",
                confidence=0.99,
                rationale="No request text was provided.",
                required=("a one-sentence request",),
                outputs={"classification": "unclear", "readiness": "needs-clarification"},
            )
        if classification == "unclear":
            return _common(
                context,
                action="clarify",
                confidence=0.77,
                rationale="The request does not match a single known task class.",
                risks=("Routing before classification can select the wrong playbook.",),
                required=("task type or an investigation goal",),
                alternatives=(("investigate", "Use investigation when the user wants understanding."),),
                outputs={"classification": classification, "readiness": "needs-clarification"},
            )
        action = "ready-for-implementation" if criteria and _has_finish_condition(context) else "ready-for-grooming"
        return _common(
            context,
            action=action,
            confidence=0.86 if criteria and _has_finish_condition(context) else 0.74,
            rationale=f"The request matches the {classification} task class.",
            risks=() if criteria else ("Acceptance criteria are not yet explicit.",),
            required=() if criteria else ("acceptance criteria and a finish condition",),
            alternatives=(("investigate", "Use investigation if repository facts are still unknown."),),
            conditions=("Change to clarify if the acceptance criteria alter a public contract.",),
            outputs={"classification": classification, "readiness": "ready" if criteria else "needs-grooming"},
        )

    if decision_type == "grooming":
        missing: list[str] = []
        if not _request(context):
            missing.append("request summary")
        if not criteria:
            missing.append("acceptance criteria")
        if not _has_finish_condition(context):
            missing.append("finish condition")
        if missing:
            return _common(
                context,
                action="needs-information",
                confidence=0.98,
                rationale="The ticket is missing required readiness fields.",
                risks=("Dispatching without a finish predicate makes completion unverifiable.",),
                required=tuple(missing),
                outputs={"missing": missing, "ready": False},
            )
        if _contains(text, "product decision", "choose between", "either", "ambiguous"):
            return _common(
                context,
                action="needs-decision",
                confidence=0.9,
                rationale="The ticket contains a behavior choice that changes acceptance criteria.",
                risks=("Choosing one reading would create an unapproved public contract.",),
                required=("a human decision recorded in the ticket",),
                outputs={"missing": [], "ready": False},
            )
        parallel = bool(context.constraints.get("parallelizable")) or _contains(text, "independent slices")
        action = "split" if len(criteria) > 4 or _contains(text, "split", "decompose") else "ready"
        return _common(
            context,
            action=action,
            confidence=0.8,
            rationale="The ticket has a finish condition and explicit acceptance criteria.",
            risks=("File ownership is still required before parallel dispatch.",) if parallel else (),
            required=("file-level ownership and a conflict matrix",) if parallel else (),
            alternatives=(("ready", "Keep the unit intact when splitting would not add an independent check."),),
            outputs={"missing": [], "ready": action == "ready", "parallel_candidate": parallel},
        )

    if decision_type == "playbook-selection":
        playbook, confidence, rationale = select_playbook(context)
        return _common(
            context,
            action=playbook,
            confidence=confidence,
            rationale=rationale,
            risks=("The router must validate this recommendation against the route table.",),
            required=("the matched playbook's finish predicate",),
            alternatives=(("intake", "Use intake when the ticket has not passed readiness."),),
            conditions=("Change route when the request adds a different finish condition.",),
            outputs={"classification": classify_task(context), "playbook": playbook},
        )

    if decision_type == "decomposition":
        files = context.task.get("files") or context.task.get("touched_files") or []
        conflict = bool(context.task.get("shared_files") or context.task.get("conflicts"))
        if context.task.get("estimated_changed_lines", 0) and int(context.task["estimated_changed_lines"]) > 500:
            return _common(
                context,
                action="split",
                confidence=0.99,
                rationale="The estimated change exceeds the 500-line slice boundary.",
                risks=("A large slice weakens reviewability and independent verification.",),
                required=("slice list, file ownership, and conflict matrix",),
                outputs={"parallelizable": False, "shared_file_conflict": conflict, "estimated_files": len(files)},
            )
        if conflict:
            return _common(
                context,
                action="sequence",
                confidence=0.95,
                rationale="Candidate slices share writable files, so they must be serialized.",
                risks=("Concurrent writers could corrupt the shared file.",),
                required=("a conflict matrix naming the shared files",),
                alternatives=(("parallelize", "Use only after file ownership becomes disjoint."),),
                outputs={"parallelizable": False, "shared_file_conflict": True, "estimated_files": len(files)},
            )
        if _contains(text, "independent", "separate directories", "parallel"):
            return _common(
                context,
                action="parallelize",
                confidence=0.84,
                rationale="The context names independent work and no shared-file conflict.",
                risks=("Parallelism is safe only with one worktree per slice.",),
                required=("one worktree and one owner per slice", "conflict matrix"),
                alternatives=(("sequence", "Serialize if a later slice reads an earlier output."),),
                outputs={"parallelizable": True, "shared_file_conflict": False, "estimated_files": len(files)},
            )
        return _common(
            context,
            action="single-slice",
            confidence=0.72,
            rationale="No independent boundary or shared-file conflict is evidenced.",
            risks=("Re-cut if the implementation grows beyond one independently verifiable concern.",),
            required=("a check that passes without a later slice",),
            alternatives=(("split", "Split only when each part has its own acceptance check."),),
            outputs={"parallelizable": False, "shared_file_conflict": False, "estimated_files": len(files)},
        )

    if decision_type == "dispatch-readiness":
        brief = context.task.get("brief")
        dependencies = context.task.get("dependencies", [])
        files = context.task.get("writable_files") or context.task.get("files")
        missing = []
        if not brief:
            missing.append("standalone slice brief")
        if not criteria:
            missing.append("acceptance checks")
        if not context.task.get("verification_command"):
            missing.append("verification command")
        if not files:
            missing.append("writable file list")
        if missing:
            return _common(
                context,
                action="hold",
                confidence=0.99,
                rationale="The dispatch brief is incomplete.",
                risks=("An incomplete brief causes scope drift and unverifiable completion.",),
                required=tuple(missing),
                outputs={"ready": False, "missing": missing},
            )
        if dependencies and not context.current_state.get("dependencies_satisfied", False):
            return _common(
                context,
                action="serialize",
                confidence=0.94,
                rationale="A declared dependency is not satisfied.",
                risks=("Dispatching now would make the lane depend on unfinished work.",),
                required=("evidence that all declared dependencies are satisfied",),
                outputs={"ready": False, "missing": [], "dependencies_satisfied": False},
            )
        if context.task.get("shared_file_conflict"):
            return _common(
                context,
                action="serialize",
                confidence=0.97,
                rationale="The slice has a shared-file conflict with another lane.",
                required=("the predecessor lane's completion evidence",),
                outputs={"ready": False, "missing": [], "dependencies_satisfied": True},
            )
        role = context.task.get("role") if context.task.get("role") in ROLES else "implementer"
        return _common(
            context,
            action="dispatch",
            confidence=0.87,
            rationale="The slice brief, writable files, acceptance checks, and verification command are present.",
            outputs={"ready": True, "missing": [], "role": role},
            conditions=("Hold if the conflict matrix changes before dispatch.",),
        )

    if decision_type == "runtime-progress":
        phase = str(context.current_state.get("phase", "")).lower()
        blockers = context.current_state.get("blockers") or []
        if blockers or phase == "blocked":
            return _common(
                context,
                action="block",
                confidence=0.96,
                rationale="The lane has a recorded blocker and cannot silently continue.",
                required=("exact blocker text and the bounded unblock attempt log",),
                outputs={"phase": phase, "stalled": True},
            )
        if context.current_state.get("stalled"):
            return _common(
                context,
                action="retry",
                confidence=0.82,
                rationale="The lane is marked stalled without a completed side effect.",
                risks=("Retry only with a distinct hypothesis or route to unblocker.",),
                required=("a new hypothesis and one changed variable",),
                outputs={"phase": phase, "stalled": True},
            )
        if phase == "paused":
            return _common(
                context,
                action="pause",
                confidence=0.98,
                rationale="The lane is already at a safe paused state.",
                outputs={"phase": phase, "stalled": False},
            )
        return _common(
            context,
            action="continue",
            confidence=0.75,
            rationale="The lane has no recorded blocker or stall condition.",
            required=("a commit, check delta, captured artifact, or completed unit",),
            outputs={"phase": phase, "stalled": False},
        )

    if decision_type == "verification":
        enough = verification_sufficient(context)
        if not enough:
            return _common(
                context,
                action="request-evidence",
                confidence=0.99,
                rationale="The supplied artifacts do not cover every acceptance criterion.",
                risks=("A green test command alone does not prove behavior not exercised by that test.",),
                required=tuple(f"evidence for acceptance criterion {index + 1}" for index, _ in enumerate(criteria))
                or ("at least one captured artifact",),
                outputs={"sufficient": False, "criteria_count": len(criteria), "evidence_count": len(refs)},
            )
        return _common(
            context,
            action="accept",
            confidence=0.79,
            rationale="Each acceptance criterion has a captured artifact of an allowed kind.",
            outputs={"sufficient": True, "criteria_count": len(criteria), "evidence_count": len(refs)},
            conditions=("Reopen verification if an artifact does not assert the named predicate.",),
        )

    if decision_type == "skill-improvement":
        overrides = context.current_state.get("human_overrides", 0)
        repeated = context.current_state.get("repeated_pattern", False)
        if repeated or (isinstance(overrides, int) and overrides >= 3):
            return _common(
                context,
                action="propose-change",
                confidence=0.83,
                rationale="Repeated overrides or a repeated failure pattern is recorded.",
                risks=("The proposal must be reviewed and applied explicitly; model output cannot rewrite the skill.",),
                required=("the affected decision IDs and final outcomes",),
                outputs={"override_count": overrides, "repeated_pattern": repeated},
            )
        return _common(
            context,
            action="collect-evidence",
            confidence=0.78,
            rationale="There is not yet enough outcome evidence to change a workflow rule.",
            required=("more decisions with recorded outcomes or overrides",),
            outputs={"override_count": overrides, "repeated_pattern": repeated},
        )

    raise AssertionError(f"unhandled decision type {decision_type}")
