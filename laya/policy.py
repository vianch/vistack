"""Deterministic viStack policy used as the baseline and safety fallback."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Mapping

from .schema import DECISION_TYPES, DecisionContext, Evidence, PLAYBOOKS, ROLES


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


MAX_CHANGED_LINES = 500
UNBLOCK_ATTEMPT_LIMIT = 20
IDENTICAL_RESULT_LIMIT = 3

# Signals are matched on word boundaries against observed values, never field names. The
# request text carries full weight; acceptance criteria, briefs, and other task values carry
# SUPPORT_WEIGHT, so "no failures in the console" in a criterion cannot turn a feature into a
# bug fix. Strong signals (2.0) name a route outright; weak ones (<1.0) only break ties.
SUPPORT_WEIGHT = 0.35
CLASS_SIGNALS: tuple[tuple[str, tuple[tuple[str, float], ...]], ...] = (
    ("design-implementation", ((r"figma", 2.0), (r"design implementation", 2.0), (r"visual parity", 2.0), (r"mock-?ups?", 1.0))),
    ("worktree-cleanup", ((r"(?:clean(?:\s?up)?|prune|stale|old|orphaned|remove|delete)\b.{0,30}\bworktrees?", 2.0), (r"worktrees?\b.{0,30}\b(?:clean(?:\s?up)?|prune|stale)", 2.0))),
    ("pr-stack", ((r"stack(?:ed)? prs?", 2.0), (r"gh stack", 2.0), (r"split (?:the |this |my )?(?:branch|pr|diff)", 2.0), (r"(?:open|raise|create) (?:a |the )?(?:draft )?(?:pr|pull request)", 1.5))),
    ("babysit", ((r"babysit", 2.0), (r"status of (?:the |my )?(?:\w+ )?(?:run|lanes?|prs?|pull requests?)", 2.0), (r"check on (?:the )?(?:run|lanes?|prs?)", 1.5), (r"monitor (?:the )?(?:run|lanes?|prs?)", 1.5))),
    ("session-pickup", ((r"session pickup", 2.0), (r"resume", 1.5), (r"pick (?:it |this |the run )?(?:back )?up", 1.5), (r"where (?:did )?we (?:leave|left) off", 1.5))),
    ("pause-safely", ((r"pause", 1.5), (r"stop safely", 2.0), (r"park (?:the |this )?(?:run|work|slice)", 1.5))),
    ("authoring-skill", ((r"skill\.md", 2.0), (r"skills?", 1.2), (r"playbooks?", 1.2), (r"workflow contract", 2.0), (r"agent (?:file|definition)", 1.2))),
    ("automate-me", ((r"preferences?", 1.2), (r"working style", 2.0), (r"mode skill", 2.0))),
    ("perf-issue", ((r"performance", 1.2), (r"perf", 1.0), (r"latency", 1.2), (r"slow(?:er|ness|ly)?", 1.2), (r"throughput", 1.2), (r"memory leak", 1.5), (r"p9[059]", 1.2), (r"takes? \d+(?:\.\d+)? ?(?:ms|s|sec|seconds|minutes)", 1.2), (r"optimi[sz](?:e|ation)", 0.6), (r"cpu usage", 1.2))),
    ("bug-fix", ((r"bugs?", 1.2), (r"broken", 1.2), (r"regression", 1.2), (r"wrong", 1.0), (r"incorrect(?:ly)?", 1.0), (r"fail(?:s|ed|ing|ures?)?", 1.0), (r"crash(?:es|ed|ing)?", 1.2), (r"errors?", 0.8), (r"exceptions?", 0.8), (r"fix(?:es|ed|ing)?", 1.0), (r"not working", 1.2), (r"doesn'?t work", 1.2), (r"debug", 0.5))),
    ("refactor", ((r"refactor(?:ing)?", 1.5), (r"rename", 1.2), (r"reorgani[sz]e", 1.2), (r"restructure", 1.2), (r"migrate", 1.0), (r"extract", 0.8), (r"dedupe|deduplicate", 1.0), (r"simplify", 0.8))),
    ("investigation", ((r"investigate", 1.5), (r"why", 0.6), (r"understand", 1.0), (r"audit(?!\s+(?:logs?|trails?))", 1.2), (r"explain", 1.2), (r"how (?:does|do|is)", 1.0), (r"analy[sz]e", 1.0), (r"research", 1.0), (r"compare", 0.8))),
    ("prototype", ((r"prototype", 1.5), (r"experiment", 1.2), (r"spike", 1.5), (r"proof of concept|poc", 1.5))),
    ("blocker", ((r"blocker", 1.5), (r"blocked", 1.5), (r"stuck", 1.2))),
    ("qa-verification", ((r"qa", 1.2), (r"verify", 1.0), (r"verification", 1.0), (r"screenshot evidence", 1.5), (r"preview (?:deployment|url)", 1.0))),
    ("feature", ((r"build", 0.8), (r"add(?:s|ed|ing)?", 0.8), (r"implement", 0.8), (r"create", 0.8), (r"introduce", 0.8), (r"support", 0.5), (r"new", 0.4), (r"enable", 0.5), (r"allow", 0.4), (r"update|change|modify|improve", 0.4))),
)
_COMPILED = tuple(
    (name, tuple((re.compile(rf"\b(?:{pattern})\b"), weight, pattern) for pattern, weight in signals))
    for name, signals in CLASS_SIGNALS
)
_PRIORITY = {name: index for index, (name, _) in enumerate(CLASS_SIGNALS)}

_OVERNIGHT = re.compile(r"\b(?:going to bed|step(?:ping)? away|overnight|run until done|don'?t stop)\b")
_AUTOPILOT_FULL = re.compile(r"\b(?:autopilot full|independent (?:prs?|pull requests|queue|tickets))\b")
_AUTOPILOT = re.compile(r"\b(?:autopilot|unattended)\b")
_CROSS_CUTTING = re.compile(r"\b(?:large|cross-cutting|many services|program|multi-phase|multiple repos(?:itories)?)\b")
_NEEDS_DECISION = re.compile(r"\b(?:product decision|choose between|ambiguous|tbd|to be decided|undecided)\b|\beither\b.{1,80}\bor\b")
_SPLIT = re.compile(r"\b(?:split|decompose)\b")
_INDEPENDENT = re.compile(r"\b(?:independent|separate directories|parallel(?:ize)?|disjoint)\b")
_IRREVERSIBLE = re.compile(
    r"\b(?:merge|force[- ]push|history rewrite|rewrite history|deploy(?: to)? prod(?:uction)?|production deploy|"
    r"drop (?:table|database)|delete (?:data|rows|records|the database)|rotate (?:the )?secrets?|secret rotation|"
    r"shared[- ]environment migration|major (?:version )?bump)\b"
)
# Summaries are free text, so only unambiguous failure reports count; "shows the error
# message" describes behavior under test, not a failed run. Use ``status`` to be exact.
_FAILURE = re.compile(
    r"\b(?:[1-9]\d* (?:tests? )?(?:failed|failures?|errors?)|tests? failed|failed tests?|traceback|timed out|"
    r"exit (?:code|status) [1-9]\d*)\b"
)
_NO_FAILURE = re.compile(r"\b(?:0|no|zero) (?:tests? )?(?:failed|failures?|errors?)\b")
_ACCEPTED_EVIDENCE = {"command", "test", "test-output", "artifact", "screenshot", "response", "file"}
_UNAVAILABLE = {"unavailable", "unreachable", "blocked"}
_FAILED = {"fail", "failed", "failing", "error"}


def _observed(value: Any) -> list[str]:
    if isinstance(value, Mapping):
        return [item for child in value.values() for item in _observed(child)]
    if isinstance(value, (list, tuple)):
        return [item for child in value for item in _observed(child)]
    return [] if value is None or isinstance(value, bool) else [str(value)]


def _request(context: DecisionContext) -> str:
    task = context.task
    values = [task.get(key, "") for key in ("request", "title", "description", "summary")]
    return " ".join(str(value) for value in values if value).strip()


def _supporting_text(context: DecisionContext) -> str:
    rest = {key: value for key, value in context.task.items() if key not in {"request", "title", "description", "summary"}}
    return " ".join(_observed(rest)).lower()


def _acceptance_criteria(context: DecisionContext) -> list[Any]:
    value = context.task.get("acceptance_criteria", ())
    if isinstance(value, str):
        return [value] if value.strip() else []
    return [item for item in value if str(item).strip()] if isinstance(value, (list, tuple)) else []


def _has_finish_condition(context: DecisionContext) -> bool:
    task = context.task
    return bool(task.get("finish_condition") or task.get("done") or task.get("done_means"))


def _int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    match = re.search(r"\d+", str(value or "").replace(",", ""))
    return int(match.group()) if match else None


def _items(value: Any) -> list[Any]:
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, Mapping):
        return list(value)
    return [value] if value else []


@dataclass(frozen=True)
class Classification:
    label: str
    confidence: float
    scores: Mapping[str, float]
    signals: Mapping[str, tuple[str, ...]]

    @property
    def runner_up(self) -> str | None:
        ranked = [name for name in self.ranked() if name != self.label]
        return ranked[0] if ranked else None

    def ranked(self) -> list[str]:
        return sorted(self.scores, key=lambda name: (-self.scores[name], _PRIORITY[name]))

    def probabilities(self, limit: int = 5) -> dict[str, float]:
        total = sum(self.scores.values())
        if not total:
            return {"unclear": 1.0}
        return {name: round(self.scores[name] / total, 4) for name in self.ranked()[:limit]}


def score_classes(context: DecisionContext) -> Classification:
    """Score every task class from word-boundary signals and explain the winner."""

    sources = ((_request(context).lower(), 1.0), (_supporting_text(context), SUPPORT_WEIGHT))
    scores: dict[str, float] = {}
    signals: dict[str, tuple[str, ...]] = {}
    for name, compiled in _COMPILED:
        total = 0.0
        matched: list[str] = []
        for regex, weight, _ in compiled:
            best = 0.0
            for text, source_weight in sources:
                found = regex.search(text) if text else None
                if found:
                    best = max(best, weight * source_weight)
                    if source_weight == 1.0 and found.group() not in matched:
                        matched.append(found.group())
            total += best
        if total:
            scores[name] = round(total, 4)
            signals[name] = tuple(matched)
    if not scores:
        return Classification("unclear", 0.5, {}, {})
    ranked = sorted(scores, key=lambda name: (-scores[name], _PRIORITY[name]))
    top = scores[ranked[0]]
    second = scores[ranked[1]] if len(ranked) > 1 else 0.0
    if top < 0.5:
        return Classification("unclear", 0.55, scores, signals)
    margin = (top - second) / top
    confidence = round(min(0.92, 0.6 + 0.2 * min(top, 2.0) / 2.0 + 0.12 * margin), 4)
    return Classification(ranked[0], confidence, scores, signals)


def classify_task(context: DecisionContext) -> str:
    return score_classes(context).label


def _signal_phrase(classification: Classification) -> str:
    terms = classification.signals.get(classification.label, ())
    if terms:
        return f"The request matches {classification.label} signals: {', '.join(repr(term) for term in terms[:4])}."
    return f"Supporting task fields match {classification.label} signals."


def select_playbook(context: DecisionContext) -> tuple[str, float, str]:
    playbook, confidence, rationale, _, _ = _route(context)
    return playbook, confidence, rationale


def _route(context: DecisionContext) -> tuple[str, float, str, Classification, str]:
    request = _request(context).lower()
    classification = score_classes(context)
    state = {str(key).lower(): value for key, value in context.current_state.items()}
    phase = str(state.get("phase", "")).lower()
    if phase == "blocked" or state.get("blockers"):
        return "blocker", 0.96, "The current state contains an unresolved blocker.", classification, "state"
    if phase == "paused":
        return "pause-safely", 0.94, "The current state is paused and needs a resumable stop.", classification, "state"
    if phase in {"qa", "verification"}:
        return "qa-verification", 0.92, "The current state is at behavioral verification.", classification, "state"
    if classification.label == "babysit":
        return "babysit", 0.9, _signal_phrase(classification), classification, "signals"
    if _OVERNIGHT.search(request):
        return "overnight", 0.96, "The request explicitly names an unattended handoff.", classification, "handoff"
    if _AUTOPILOT_FULL.search(request):
        return "autopilot-full", 0.93, "The request names independent work items for parallel execution.", classification, "handoff"
    if _AUTOPILOT.search(request):
        return "autopilot-stack", 0.9, "The request names unattended execution for a groomed unit.", classification, "handoff"
    if classification.label in PLAYBOOKS:
        if _CROSS_CUTTING.search(request) and classification.label in {"feature", "refactor"}:
            return "multi-phase-plan", 0.8, "The request describes cross-cutting work that needs a plan first.", classification, "signals"
        return classification.label, classification.confidence, _signal_phrase(classification), classification, "signals"
    if _CROSS_CUTTING.search(request):
        return "multi-phase-plan", 0.78, "The request describes cross-cutting work without a narrower route.", classification, "signals"
    if not _acceptance_criteria(context):
        return "intake", 0.78, "The request matches no route and has no acceptance criteria yet.", classification, "default"
    return "feature", 0.62, "The request has acceptance criteria but no stronger route signal.", classification, "default"


def evidence_refs(context: DecisionContext) -> tuple[str, ...]:
    return tuple(dict.fromkeys(item.ref for item in context.evidence))


def _evidence_state(item: Evidence) -> str:
    status = (item.status or "").strip().lower()
    if status in _UNAVAILABLE:
        return "unavailable"
    if status in _FAILED:
        return "failed"
    if status:
        return "passed"
    if _FAILURE.search(_NO_FAILURE.sub(" ", item.summary.lower())):
        return "failed"
    return "passed"


def _criterion_index(item: Evidence, criteria: list[Any]) -> int | None:
    if item.criterion is None:
        return None
    number = _int(item.criterion) if str(item.criterion).strip().isdigit() else None
    if number is not None and 1 <= number <= len(criteria):
        return number - 1
    wanted = str(item.criterion).strip().lower()
    for index, criterion in enumerate(criteria):
        if str(criterion).strip().lower() == wanted:
            return index
    return None


def assess_evidence(context: DecisionContext) -> dict[str, Any]:
    """Map evidence onto acceptance criteria and flag failing or unavailable artifacts."""

    criteria = _acceptance_criteria(context)
    seen: set[str] = set()
    usable: list[Evidence] = []
    failed: list[str] = []
    unavailable: list[str] = []
    for item in context.evidence:
        if item.ref in seen:
            continue
        seen.add(item.ref)
        state = _evidence_state(item)
        if state == "failed":
            failed.append(item.ref)
        elif state == "unavailable":
            unavailable.append(item.ref)
        elif item.kind in _ACCEPTED_EVIDENCE:
            usable.append(item)
    mapped = {index for item in usable if (index := _criterion_index(item, criteria)) is not None}
    unmapped = sum(1 for item in usable if _criterion_index(item, criteria) is None)
    # Artifacts without a criterion label cover the remaining criteria one-to-one; labelled
    # artifacts cover exactly the criterion they name.
    uncovered = [index for index in range(len(criteria)) if index not in mapped]
    uncovered = uncovered[unmapped:]
    return {
        "criteria_count": len(criteria),
        "usable": [item.ref for item in usable],
        "failed": failed,
        "unavailable": unavailable,
        "uncovered": [index + 1 for index in uncovered],
        "sufficient": bool(criteria) and bool(usable) and not failed and not unavailable and not uncovered,
    }


def verification_sufficient(context: DecisionContext) -> bool:
    return bool(assess_evidence(context)["sufficient"])


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
    probabilities: Mapping[str, float] | None = None,
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
        probabilities=dict(probabilities) if probabilities else {action: confidence},
    )


def _runner_up_alternative(classification: Classification) -> tuple[tuple[str, str], ...]:
    runner_up = classification.runner_up
    if not runner_up:
        return ()
    terms = classification.signals.get(runner_up, ())
    detail = f" ({', '.join(repr(term) for term in terms[:3])})" if terms else ""
    return ((runner_up, f"The request also matches {runner_up} signals{detail}."),)


def _slice_conflicts(context: DecisionContext) -> list[str]:
    slices = context.task.get("slices")
    if not isinstance(slices, (list, tuple)):
        return []
    owners: dict[str, int] = {}
    shared: set[str] = set()
    for item in slices:
        if not isinstance(item, Mapping):
            continue
        for path in _items(item.get("files") or item.get("writable_files")):
            owners[str(path)] = owners.get(str(path), 0) + 1
            if owners[str(path)] > 1:
                shared.add(str(path))
    return sorted(shared)


def _slice_dependencies(context: DecisionContext) -> bool:
    slices = context.task.get("slices")
    if not isinstance(slices, (list, tuple)):
        return False
    return any(isinstance(item, Mapping) and _items(item.get("depends_on") or item.get("dependencies")) for item in slices)


def evaluate(context: DecisionContext) -> PolicyDraft:
    """Evaluate a context without importing MLX or making external calls."""

    decision_type = context.decision_type
    if decision_type not in DECISION_TYPES:
        raise ValueError(f"unknown decision type {decision_type!r}")

    if decision_type == "intake-analysis":
        criteria = _acceptance_criteria(context)
        classification = score_classes(context)
        label = classification.label
        if not _request(context):
            return _common(
                context,
                action="clarify",
                confidence=0.99,
                rationale="No request text was provided.",
                required=("a one-sentence request",),
                outputs={"classification": "unclear", "readiness": "needs-clarification"},
            )
        if label == "unclear":
            return _common(
                context,
                action="clarify",
                confidence=0.77,
                rationale="The request does not match a single known task class.",
                risks=("Routing before classification can select the wrong playbook.",),
                required=("task type or an investigation goal",),
                alternatives=(("investigate", "Use investigation when the user wants understanding."),),
                outputs={"classification": label, "readiness": "needs-clarification", "signals": {}},
                probabilities=classification.probabilities(),
            )
        if label == "investigation" and not criteria:
            return _common(
                context,
                action="investigate",
                confidence=classification.confidence,
                rationale=f"{_signal_phrase(classification)} Repository facts come before a ticket.",
                required=("a question the investigation must answer",),
                alternatives=(("ready-for-grooming", "Groom instead when the user already wants a code change."),),
                outputs={"classification": label, "readiness": "needs-investigation", "signals": dict(classification.signals)},
                probabilities=classification.probabilities(),
            )
        ready = bool(criteria) and _has_finish_condition(context)
        return _common(
            context,
            action="ready-for-implementation" if ready else "ready-for-grooming",
            confidence=0.86 if ready else 0.74,
            rationale=_signal_phrase(classification),
            risks=() if criteria else ("Acceptance criteria are not yet explicit.",),
            required=() if ready else tuple(
                item for item, present in (("acceptance criteria", criteria), ("a finish condition", _has_finish_condition(context))) if not present
            ),
            alternatives=(("investigate", "Use investigation if repository facts are still unknown."),) + _runner_up_alternative(classification),
            conditions=("Change to clarify if the acceptance criteria alter a public contract.",),
            outputs={"classification": label, "readiness": "ready" if ready else "needs-grooming", "signals": dict(classification.signals)},
            probabilities=classification.probabilities(),
        )


    if decision_type == "grooming":
        criteria = _acceptance_criteria(context)
        request = _request(context).lower()
        missing: list[str] = []
        if not request:
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
                rationale=f"The ticket is missing required readiness fields: {', '.join(missing)}.",
                risks=("Dispatching without a finish predicate makes completion unverifiable.",),
                required=tuple(missing),
                outputs={"missing": missing, "ready": False},
            )
        open_questions = _items(context.task.get("open_questions"))
        decision_text = " ".join([request, *(str(item).lower() for item in criteria)])
        decision_match = _NEEDS_DECISION.search(decision_text)
        if open_questions or decision_match:
            cause = f"{len(open_questions)} open question(s) are recorded" if open_questions else f"the ticket says {decision_match.group()!r}"
            return _common(
                context,
                action="needs-decision",
                confidence=0.9,
                rationale=f"The ticket contains an unresolved behavior choice: {cause}.",
                risks=("Choosing one reading would create an unapproved public contract.",),
                required=("a human decision recorded in the ticket",),
                outputs={"missing": [], "ready": False, "open_questions": open_questions},
            )
        parallel = bool(context.constraints.get("parallelizable")) or bool(_INDEPENDENT.search(request))
        estimated = _int(context.task.get("estimated_changed_lines"))
        too_large = estimated is not None and estimated > MAX_CHANGED_LINES
        split = len(criteria) > 4 or bool(_SPLIT.search(request)) or too_large
        if split:
            reason = (
                f"the estimate of {estimated} changed lines exceeds {MAX_CHANGED_LINES}" if too_large
                else f"{len(criteria)} acceptance criteria exceed one reviewable concern" if len(criteria) > 4
                else "the request asks for decomposition"
            )
            rationale = f"The ticket is specified, but {reason}."
        else:
            rationale = "The ticket has a request, explicit acceptance criteria, and a finish condition."
        return _common(
            context,
            action="split" if split else "ready",
            confidence=0.8,
            rationale=rationale,
            risks=("File ownership is still required before parallel dispatch.",) if parallel else (),
            required=("file-level ownership and a conflict matrix",) if parallel else (),
            alternatives=(("ready", "Keep the unit intact when splitting would not add an independent check."),) if split else (),
            outputs={"missing": [], "ready": not split, "parallel_candidate": parallel},
        )


    if decision_type == "playbook-selection":
        playbook, confidence, rationale, classification, source = _route(context)
        alternatives = [item for item in _runner_up_alternative(classification) if item[0] != playbook]
        if playbook != "intake" and not _acceptance_criteria(context):
            alternatives.append(("intake", "Use intake when the ticket has not passed readiness."))
        probabilities = classification.probabilities() if playbook == classification.label else {playbook: confidence}
        return _common(
            context,
            action=playbook,
            confidence=confidence,
            rationale=rationale,
            risks=("The router must validate this recommendation against the route table.",),
            required=("the matched playbook's finish predicate",),
            alternatives=tuple(alternatives),
            conditions=("Change route when the request adds a different finish condition.",),
            outputs={
                "classification": classification.label,
                "playbook": playbook,
                "route_source": source,
                "signals": dict(classification.signals),
            },
            probabilities=probabilities,
        )


    if decision_type == "decomposition":
        request = _request(context).lower()
        files = _items(context.task.get("files") or context.task.get("touched_files"))
        shared = [str(item) for item in _items(context.task.get("shared_files") or context.task.get("conflicts"))] + _slice_conflicts(context)
        shared = list(dict.fromkeys(shared))
        dependencies = _items(context.task.get("dependencies")) or _slice_dependencies(context)
        estimated = _int(context.task.get("estimated_changed_lines"))
        base = {"estimated_files": len(files), "shared_files": shared, "estimated_changed_lines": estimated}
        if estimated is not None and estimated > MAX_CHANGED_LINES:
            return _common(
                context,
                action="split",
                confidence=0.99,
                rationale=f"The estimate of {estimated} changed lines exceeds the {MAX_CHANGED_LINES}-line slice boundary.",
                risks=("A large slice weakens reviewability and independent verification.",),
                required=("slice list, file ownership, and conflict matrix",),
                outputs={**base, "parallelizable": False, "shared_file_conflict": bool(shared)},
            )
        if shared:
            return _common(
                context,
                action="sequence",
                confidence=0.95,
                rationale=f"Candidate slices share writable files ({', '.join(shared[:5])}), so they must be serialized.",
                risks=("Concurrent writers could corrupt the shared file.",),
                required=("a conflict matrix naming the shared files",),
                alternatives=(("parallelize", "Use only after file ownership becomes disjoint."),),
                outputs={**base, "parallelizable": False, "shared_file_conflict": True},
            )
        if dependencies:
            return _common(
                context,
                action="sequence",
                confidence=0.92,
                rationale="A slice declares a dependency on earlier output, so the slices run in order.",
                risks=("Parallel dispatch would start a lane before its input exists.",),
                required=("the dependency order in the wave schedule",),
                alternatives=(("parallelize", "Use once no slice reads another slice's output."),),
                outputs={**base, "parallelizable": False, "shared_file_conflict": False, "dependencies": True},
            )
        if _INDEPENDENT.search(request) or (isinstance(context.task.get("slices"), (list, tuple)) and len(context.task["slices"]) > 1):
            return _common(
                context,
                action="parallelize",
                confidence=0.84,
                rationale="The context names independent work with disjoint files and no declared dependency.",
                risks=("Parallelism is safe only with one worktree per slice.",),
                required=("one worktree and one owner per slice", "conflict matrix"),
                alternatives=(("sequence", "Serialize if a later slice reads an earlier output."),),
                outputs={**base, "parallelizable": True, "shared_file_conflict": False},
            )
        return _common(
            context,
            action="single-slice",
            confidence=0.72,
            rationale="No independent boundary, dependency, or shared-file conflict is evidenced.",
            risks=("Re-cut if the implementation grows beyond one independently verifiable concern.",),
            required=("a check that passes without a later slice",),
            alternatives=(("split", "Split only when each part has its own acceptance check."),),
            outputs={**base, "parallelizable": False, "shared_file_conflict": False},
        )


    if decision_type == "dispatch-readiness":
        criteria = _acceptance_criteria(context)
        dependencies = _items(context.task.get("dependencies"))
        files = context.task.get("writable_files") or context.task.get("files")
        missing = []
        if not context.task.get("brief"):
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
                rationale=f"The dispatch brief is incomplete: {', '.join(missing)}.",
                risks=("An incomplete brief causes scope drift and unverifiable completion.",),
                required=tuple(missing),
                outputs={"ready": False, "missing": missing},
            )
        if dependencies and not context.current_state.get("dependencies_satisfied", False):
            return _common(
                context,
                action="serialize",
                confidence=0.94,
                rationale=f"Declared dependencies are not satisfied: {', '.join(str(item) for item in dependencies[:5])}.",
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
        state = context.current_state
        phase = str(state.get("phase", "")).lower()
        blockers = _items(state.get("blockers"))
        attempts = _int(state.get("attempts")) or 0
        identical = _int(state.get("identical_results")) or 0
        next_action = str(state.get("next_action") or "").lower()
        base = {"phase": phase, "attempts": attempts}
        fence: tuple[int, str] | None = None
        if state.get("credentials_missing") or state.get("credentials_expired"):
            fence = (4, "Credentials are missing or expired.")
        elif next_action and _IRREVERSIBLE.search(next_action):
            fence = (3, f"The next action {next_action!r} is irreversible.")
        elif state.get("unblock_exhausted") or attempts >= UNBLOCK_ATTEMPT_LIMIT or identical >= IDENTICAL_RESULT_LIMIT:
            fence = (1, "The bounded unblock loop is exhausted or repeating identical results.")
        elif state.get("contract_ambiguity"):
            fence = (2, "Two interpretations change acceptance criteria or a public contract.")
        if fence:
            return _common(
                context,
                action="escalate",
                confidence=0.97,
                rationale=f"FENCE {fence[0]}: {fence[1]}",
                required=("the fence dossier for the human",),
                outputs={**base, "stalled": bool(state.get("stalled")), "fence": fence[0]},
            )
        if blockers or phase == "blocked":
            return _common(
                context,
                action="block",
                confidence=0.96,
                rationale="The lane has a recorded blocker and cannot silently continue.",
                required=("exact blocker text and the bounded unblock attempt log",),
                alternatives=(("escalate", f"Escalate after {UNBLOCK_ATTEMPT_LIMIT} attempts or {IDENTICAL_RESULT_LIMIT} identical results."),),
                outputs={**base, "stalled": True},
            )
        if state.get("stalled"):
            return _common(
                context,
                action="retry",
                confidence=0.82,
                rationale="The lane is marked stalled without a completed side effect.",
                risks=("Retry only with a distinct hypothesis or route to unblocker.",),
                required=("a new hypothesis and one changed variable",),
                alternatives=(("block", "Route to the unblocker when no distinct hypothesis remains."),),
                outputs={**base, "stalled": True},
            )
        if phase == "paused":
            return _common(
                context,
                action="pause",
                confidence=0.98,
                rationale="The lane is already at a safe paused state.",
                outputs={**base, "stalled": False},
            )
        return _common(
            context,
            action="continue",
            confidence=0.75,
            rationale="The lane has no recorded blocker, stall, or fence condition.",
            required=("a commit, check delta, captured artifact, or completed unit",),
            outputs={**base, "stalled": False},
        )


    if decision_type == "verification":
        assessment = assess_evidence(context)
        outputs = {
            "sufficient": assessment["sufficient"],
            "criteria_count": assessment["criteria_count"],
            "evidence_count": len(evidence_refs(context)),
            "failing_evidence": assessment["failed"],
            "uncovered_criteria": assessment["uncovered"],
        }
        if assessment["unavailable"]:
            return _common(
                context,
                action="block",
                confidence=0.93,
                rationale=f"The verification target is unavailable: {', '.join(assessment['unavailable'][:3])}.",
                required=("a reachable verification target",),
                outputs=outputs,
            )
        if assessment["failed"]:
            return _common(
                context,
                action="request-evidence",
                confidence=0.97,
                rationale=f"Captured artifacts report failures: {', '.join(assessment['failed'][:3])}.",
                risks=("A failing artifact disproves the criterion it covers.",),
                required=tuple(f"a passing re-run of {ref}" for ref in assessment["failed"][:5]),
                outputs=outputs,
            )
        if not assessment["sufficient"]:
            uncovered = assessment["uncovered"]
            return _common(
                context,
                action="request-evidence",
                confidence=0.99,
                rationale=(
                    f"Acceptance criteria {', '.join(str(item) for item in uncovered)} have no captured artifact."
                    if uncovered
                    else "The supplied artifacts do not cover the acceptance criteria."
                ),
                risks=("A green test command alone does not prove behavior not exercised by that test.",),
                required=tuple(f"evidence for acceptance criterion {index}" for index in uncovered) or ("at least one captured artifact",),
                outputs=outputs,
            )
        return _common(
            context,
            action="accept",
            confidence=0.79,
            rationale="Each acceptance criterion has a distinct passing artifact of an allowed kind.",
            outputs=outputs,
            conditions=("Reopen verification if an artifact does not assert the named predicate.",),
        )


    if decision_type == "skill-improvement":
        overrides = _int(context.current_state.get("human_overrides")) or 0
        repeated = bool(context.current_state.get("repeated_pattern", False))
        if repeated or overrides >= 3:
            return _common(
                context,
                action="propose-change",
                confidence=0.83,
                rationale=f"{'A repeated failure pattern' if repeated else f'{overrides} human overrides'} are recorded.",
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
