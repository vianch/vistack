"""Question schemas sent to Laya's typed decision API."""

from __future__ import annotations

import json
from typing import Any

from .policy import classify_task, select_playbook
from .schema import DecisionContext, PLAYBOOKS, ROLES


def _choice(instructions: str, criteria: dict[str, str]) -> dict[str, Any]:
    return {"type": "choice", "instructions": instructions, "criteria": criteria}


def _noul(instructions: str) -> dict[str, Any]:
    return {"type": "noul", "instructions": instructions}


def _score(instructions: str, criteria: list[str]) -> dict[str, Any]:
    return {"type": "score", "instructions": instructions, "criteria": criteria}


def candidate_playbooks(context: DecisionContext) -> tuple[str, ...]:
    """Keep each choice question within Laya's documented option budget."""

    if context.available_actions:
        candidates = [item for item in context.available_actions if item in PLAYBOOKS]
    else:
        candidates = []
    if not candidates:
        selected, _, _ = select_playbook(context)
        family = {
            "intake": ("intake", "investigation", "feature", "bug-fix", "refactor", "prototype"),
            "investigation": ("investigation", "prototype", "multi-phase-plan", "intake"),
            "bug-fix": ("bug-fix", "blocker", "qa-verification", "investigation", "intake"),
            "feature": ("feature", "design-implementation", "prototype", "multi-phase-plan", "intake"),
            "refactor": ("refactor", "multi-phase-plan", "prototype", "intake"),
            "perf-issue": ("perf-issue", "prototype", "investigation", "feature", "multi-phase-plan"),
        }
        candidates = list(family.get(selected, (selected, "intake", "investigation", "multi-phase-plan")))
    # Laya documents degradation above 20 options. Keep a deterministic, unique list.
    return tuple(dict.fromkeys(item for item in candidates if item in PLAYBOOKS))[:10]


def questions_for(context: DecisionContext) -> dict[str, dict[str, Any]]:
    decision_type = context.decision_type
    if decision_type == "intake-analysis":
        return {
            "task_type": _choice(
                "Which viStack task class best matches this request?",
                {
                    "bug-fix": "reported wrong behavior, regression, or failing behavior",
                    "feature": "new behavior with an implementation request",
                    "refactor": "structure changes while behavior stays the same",
                    "design-implementation": "implementation sourced from visual design",
                    "perf-issue": "measured slowness or resource use",
                    "investigation": "understanding or recommendation without code change",
                    "prototype": "a bounded experiment to settle an empirical question",
                    "blocker": "an existing lane is stuck on one obstacle",
                    "unclear": "the request does not identify one of these classes",
                },
            ),
            "readiness": _choice(
                "What is the next safe intake state?",
                {
                    "ready": "acceptance criteria and a finish condition are explicit",
                    "needs-grooming": "the request is actionable but still needs a specified ticket",
                    "needs-investigation": "repository facts must be established before classification",
                    "needs-clarification": "two readings could change behavior or a public contract",
                },
            ),
            "ambiguity": _noul("Would choosing an interpretation change acceptance criteria or a public contract?"),
        }
    if decision_type == "grooming":
        return {
            "readiness": _choice(
                "Is this ticket ready for dispatch?",
                {
                    "ready": "the request, acceptance criteria, finish condition, and verification are present",
                    "needs-information": "a required ticket field is missing",
                    "needs-decision": "a product or public-contract choice is unresolved",
                },
            ),
            "decomposition": _choice(
                "What decomposition shape is best supported?",
                {
                    "single": "one independently verifiable concern",
                    "sequential": "slices depend on prior output or shared files",
                    "parallel": "independent slices have disjoint writable files",
                    "split": "the unit is too large or contains multiple concerns",
                },
            ),
            "risk": _score(
                "How much execution risk is evidenced?",
                ["low", "moderate", "high", "requires human decision"],
            ),
        }
    if decision_type == "playbook-selection":
        candidates = candidate_playbooks(context)
        return {
            "playbook": _choice(
                "Which existing viStack playbook is the best route?",
                {item: f"existing route: {item}" for item in candidates},
            ),
            "route_conflict": _noul("Is there evidence that the top route would violate a viStack fence?"),
        }
    if decision_type == "decomposition":
        return {
            "shape": _choice(
                "How should the implementation be organized?",
                {
                    "single-slice": "one independently mergeable and verifiable concern",
                    "sequence": "multiple slices with dependencies or shared files",
                    "parallelize": "independent slices with disjoint writable files",
                    "split": "the current unit is too large or has multiple concerns",
                },
            ),
            "shared_conflict": _noul("Do candidate slices share a writable file?"),
            "too_large": _noul("Would the proposed unit exceed the 500 changed-line boundary?"),
        }
    if decision_type == "dispatch-readiness":
        return {
            "readiness": _choice(
                "What should the coordinator do before dispatch?",
                {
                    "dispatch": "the brief, files, dependencies, role, and checks are complete",
                    "hold": "the brief is missing required scope or evidence fields",
                    "clarify": "a behavior or public contract is ambiguous",
                    "serialize": "a dependency or shared-file conflict requires ordering",
                },
            ),
            "role": _choice(
                "Which existing viStack role best fits this slice?",
                {item: item for item in ROLES},
            ),
        }
    if decision_type == "runtime-progress":
        return {
            "next": _choice(
                "What is the next safe lane action?",
                {
                    "continue": "a side effect or evidence update shows progress",
                    "retry": "one distinct hypothesis can be tried safely",
                    "rescope": "the brief needs a reversible scope correction",
                    "block": "an obstacle needs the bounded unblocker contract",
                    "pause": "the lane can stop at a resumable safe point",
                    "escalate": "a viStack fence is reached",
                },
            ),
            "stalled": _noul("Is the lane stalled because it has no side effect or evidence delta?"),
        }
    if decision_type == "verification":
        return {
            "result": _choice(
                "Does the captured evidence support the named acceptance criteria?",
                {
                    "accept": "each criterion is asserted by a captured artifact",
                    "request-evidence": "one or more criteria lack sufficient evidence",
                    "block": "verification cannot proceed because the target is unavailable",
                    "escalate": "the evidence exposes an ambiguity or irreversible next action",
                },
            ),
            "coverage": _score(
                "How much of the acceptance predicate is covered by captured artifacts?",
                ["none", "partial", "complete"],
            ),
        }
    if decision_type == "skill-improvement":
        return {
            "change": _choice(
                "What is the right response to the historical pattern?",
                {
                    "no-change": "the evidence does not show a repeatable problem",
                    "collect-evidence": "more outcomes are needed before changing a rule",
                    "propose-change": "a reviewable, evidence-backed rule change is warranted",
                },
            ),
            "repeat": _noul("Does the history show a repeated override or failure pattern?"),
        }
    raise ValueError(f"no Laya question schema for {decision_type!r}")


def state_for_laya(context: DecisionContext, *, max_chars: int = 12000) -> dict[str, Any]:
    """Build a bounded state payload; avoid sending whole ledgers or secrets to the model."""

    payload = {
        "decision_type": context.decision_type,
        "task": context.task,
        "playbook": context.playbook,
        "current_state": context.current_state,
        "evidence": [{"kind": item.kind, "ref": item.ref, "summary": item.summary} for item in context.evidence],
        "constraints": context.constraints,
        "history": list(context.history[-3:]),
        "available_actions": list(context.available_actions),
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    if len(encoded) <= max_chars:
        return payload
    # Preserve the fields that drive the safety gates when a context is unusually large.
    return {
        "decision_type": context.decision_type,
        "task": {"title": context.task.get("title"), "request": context.task.get("request")},
        "playbook": context.playbook,
        "current_state": {"phase": context.current_state.get("phase"), "status": context.current_state.get("status")},
        "evidence": [{"kind": item.kind, "ref": item.ref} for item in context.evidence],
        "constraints": context.constraints,
        "available_actions": list(context.available_actions),
    }
