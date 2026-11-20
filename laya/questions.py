"""Question schemas sent to Laya's typed decision API.

The question ID is never sent, so meaning lives in the instructions and the option
descriptions, and each question names in backticks the state fields its answer depends on.
Counting, comparing numbers, set intersection, presence checks, and dates stay in code.
``laya/tests/test_question_rules.py`` holds every question to these rules.
"""

from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path
import re
from typing import Any, Mapping

from .policy import judged_evidence, score_classes, select_playbook
from .schema import DecisionContext, OPEN_ACTION_TYPES, PLAYBOOKS, redact, trim_output

# Decision models degrade with large option sets (the Laya model card names 20), and confidence
# from 11 or more options measured uncalibrated. Keep each choice at 10 options or fewer, well
# inside Ollama's 2 to 26.
MAX_CHOICE_OPTIONS = 10
# The state budget for a backend that does not declare its own ``max_state_chars``.
MAX_STATE_CHARS = 12000
MIN_OUTPUT_TAIL_CHARS = 200
EXIT_OPTIONS = frozenset({"ask", "no-change", "none", "not-a-slice", "unclear"})
ACTION_QUESTION = {
    "intake-analysis": "readiness",
    "grooming": "readiness",
    "playbook-selection": "playbook",
    "decomposition": "shape",
    "tier-selection": "tier",
    "model-selection": "rung",
    "seat-model": "seat",
    "dispatch-readiness": "readiness",
    "runtime-progress": "next",
    "verification": "result",
    "skill-improvement": "change",
    "tool-selection": "tool",
    "file-selection": "file",
}
ROUTER = Path(__file__).resolve().parents[1] / "skills" / "vistack" / "SKILL.md"
_ROUTE_ROW = re.compile(r"^\| `([a-z0-9-]+)` \| (.+?) \|\s*$", re.M)
_STATE_PATH = re.compile(r"`((?:task|current_state|evidence|constraints|history|playbook|available_actions)(?:\[\])?(?:\.[A-Za-z_][\w-]*(?:\[\])?)*)`")


class NoQuestion(ValueError):
    """The fork is not asked of a model on purpose; the message says why."""


def _choice(instructions: str, criteria: dict[str, str]) -> dict[str, Any]:
    return {"type": "choice", "instructions": instructions, "criteria": criteria}


def _noul(instructions: str) -> dict[str, Any]:
    return {"type": "noul", "instructions": instructions}


def _score(instructions: str, levels: tuple[str, ...]) -> dict[str, Any]:
    return {"type": "score", "instructions": instructions, "criteria": list(levels)}


# Lowest first: the engine reads a file's level by its index here.
FILE_LEVELS = (
    "the file covers the same topic, and the edit is written elsewhere",
    "the file holds code or text the edit reads or calls",
    "the edit is written into this file",
)


def holds_question(position: int) -> str:
    return f"holds_{position + 1}"


def file_question(index: int) -> str:
    return f"file_{index + 1}"


def _payload(context: DecisionContext) -> dict[str, Any]:
    criteria = {position: text for position, _, text in judged_evidence(context) if text} if context.decision_type == "verification" else {}
    return {
        "decision_type": context.decision_type,
        "task": context.task,
        "playbook": context.playbook,
        "current_state": context.current_state,
        "evidence": [
            {
                key: value
                for key, value in (
                    ("kind", item.kind),
                    ("ref", item.ref),
                    ("summary", item.summary),
                    ("criterion", criteria.get(position, item.criterion)),
                    ("status", item.status),
                    ("output", item.output),
                )
                if value
            }
            for position, item in enumerate(context.evidence)
        ],
        "constraints": context.constraints,
        "history": list(context.history[-3:]),
        "available_actions": list(context.available_actions),
    }


def _values(state: Any, path: str) -> list[Any]:
    found = [state]
    for part in path.replace("[]", ".[]").split("."):
        step: list[Any] = []
        for value in found:
            if part == "[]":
                step.extend(value if isinstance(value, list) else [])
            elif isinstance(value, Mapping) and part in value:
                step.append(value[part])
        found = step
    return found


def _present(state: Mapping[str, Any], path: str) -> bool:
    return any(value not in (None, "", [], {}) for value in _values(state, path))


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + f" and {items[-1]}"


def _fields(context: DecisionContext, *paths: str) -> str:
    """The named paths the context carries, in backticks; the first path when it carries none."""

    payload = _payload(context)
    found = [path for path in paths if _present(payload, path)] or [paths[0]]
    return _join([f"`{path}`" for path in found])


def _has(context: DecisionContext, path: str) -> bool:
    return _present(_payload(context), path)


def _option_texts(question: Mapping[str, Any]) -> list[Any]:
    criteria = question.get("criteria") or {}
    return list(criteria.values()) if isinstance(criteria, Mapping) else list(criteria)


def named_paths(questions: Mapping[str, Mapping[str, Any]]) -> tuple[str, ...]:
    texts = [str(text) for question in questions.values() for text in (question.get("instructions"), *_option_texts(question))]
    return tuple(dict.fromkeys(path for text in texts for path in _STATE_PATH.findall(text)))


@lru_cache(maxsize=1)
def route_descriptions() -> dict[str, str]:
    """Each playbook's "Match when" text from the router's route table, the one home of it."""

    try:
        text = ROUTER.read_text(encoding="utf-8")
    except OSError:
        return {}
    _, found, rest = text.partition("| Playbook | Match when |")
    return {match.group(1): match.group(2).strip() for match in _ROUTE_ROW.finditer(rest.split("\n\n", 1)[0])} if found else {}


def candidate_playbooks(context: DecisionContext) -> tuple[str, ...]:
    """Keep each choice question within Laya's documented option budget, its exit included."""

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
            "maintenance": ("maintenance", "refactor", "bug-fix", "investigation", "intake"),
            "crash-hunt": ("crash-hunt", "bug-fix", "investigation", "intake"),
            "perf-issue": ("perf-issue", "prototype", "investigation", "feature", "multi-phase-plan"),
            "pr-stack": ("pr-stack", "qa-verification", "babysit"),
            "babysit": ("babysit", "session-pickup", "pause-safely", "blocker"),
            "session-pickup": ("session-pickup", "babysit", "pause-safely"),
            "improve": ("improve", "authoring-skill", "investigation", "intake"),
        }
        # The runner-up classes carry real signal from the request; the family adds the
        # routes a human most often corrects toward.
        ranked = [item for item in score_classes(context).ranked()[:3] if item in PLAYBOOKS]
        candidates = [selected, *ranked, *family.get(selected, (selected, "intake", "investigation", "multi-phase-plan"))]
    return tuple(dict.fromkeys(item for item in candidates if item in PLAYBOOKS))[: MAX_CHOICE_OPTIONS - 1]


def _exit_for(options: Mapping[str, str]) -> str:
    return next(item for item in ("none", "unclear", "ask") if item not in options)


def open_options(context: DecisionContext) -> dict[str, str]:
    """The caller's candidates with the caller's descriptions; never cut, never self-described."""

    noun, key = ("tool", "tools") if context.decision_type == "tool-selection" else ("file", "file_summaries")
    described = context.task.get(key) if isinstance(context.task.get(key), Mapping) else {}
    options = {item: str(described.get(item) or "").strip() for item in context.available_actions}
    if len(options) > MAX_CHOICE_OPTIONS - 1:
        raise NoQuestion(f"{len(options)} candidate {noun}s exceed the {MAX_CHOICE_OPTIONS - 1} a choice carries beside its exit; narrow the candidates")
    bare = [item for item, text in options.items() if not text or text.lower() == item.lower()]
    if bare:
        raise NoQuestion(f"`task.{key}` describes no {noun} for {', '.join(bare[:3])}; a model sees only the name")
    return options


def questions_for(context: DecisionContext) -> dict[str, dict[str, Any]]:
    decision_type = context.decision_type
    request = _fields(context, "task.request")
    if decision_type == "intake-analysis":
        if not _has(context, "task.request"):
            raise NoQuestion("`task.request` is empty, so there is nothing to classify")
        return {
            "task_type": _choice(
                f"Which kind of work does {request} ask for?",
                {
                    "bug-fix": "reported wrong behavior, regression, or failing behavior",
                    "feature": "new behavior with an implementation request",
                    "refactor": "structure changes while behavior stays the same",
                    "design-implementation": "implementation sourced from visual design",
                    "perf-issue": "measured slowness or resource use",
                    "maintenance": "one change the agent picks by production-incident risk, none named",
                    "investigation": "understanding or recommendation without code change",
                    "prototype": "a bounded experiment to settle an empirical question",
                    "blocker": "an existing lane is stuck on one obstacle",
                    "unclear": "the request does not identify one of these kinds of work",
                },
            ),
            "readiness": _choice(
                f"What does the request in {_fields(context, 'task.request', 'task.acceptance_criteria', 'task.finish_condition')} need before work starts?",
                {
                    "ready": "acceptance criteria and a finish condition are explicit",
                    "needs-grooming": "the request is actionable but still needs a specified ticket",
                    "needs-investigation": "repository facts must be established before classification",
                    "needs-clarification": "two readings could change behavior or a public contract",
                    "unclear": "the text is not a request for work",
                },
            ),
            "ambiguity": _noul(f"Can {request} be read two ways that lead to different acceptance criteria or a different public contract?"),
        }
    if decision_type == "grooming":
        return {
            "readiness": _choice(
                "Can the ticket in "
                f"{_fields(context, 'task.request', 'task.acceptance_criteria', 'task.finish_condition', 'task.verification_command', 'task.open_questions', 'task.estimated_changed_lines')}"
                " go to an implementer as written?",
                {
                    "ready": "the request, acceptance criteria, finish condition, and verification are present",
                    "needs-information": "a required ticket field is missing",
                    "needs-decision": "a product or public-contract choice is unresolved",
                    "split": "the unit exceeds 500 changed lines or bundles several concerns",
                    "unclear": "the text is not a ticket for work",
                },
            ),
        }
    if decision_type == "playbook-selection":
        routes = route_descriptions()
        candidates = candidate_playbooks(context)
        missing = [item for item in candidates if item not in routes]
        if missing:
            raise NoQuestion(f"the router's route table has no Match-when text for {', '.join(missing)}")
        notes = "".join(
            note
            for path, note in (
                ("task.acceptance_criteria", " `task.acceptance_criteria` lists what done means."),
                ("current_state.phase", " `current_state.phase` is where an earlier run stopped."),
            )
            if _has(context, path)
        )
        return {
            "playbook": _choice(
                f"Which route matches {request}?{notes}",
                {**{item: routes[item] for item in candidates}, "none": "the request fits none of these routes"},
            ),
        }
    if decision_type == "decomposition":
        return {
            "shape": _choice(
                f"How should the work in {_fields(context, 'task.request', 'task.slices', 'task.files', 'task.dependencies', 'task.estimated_changed_lines')} be cut into slices?",
                {
                    "single-slice": "one independently mergeable and verifiable concern",
                    "sequence": "multiple slices with dependencies or shared files",
                    "parallelize": "independent slices with disjoint writable files",
                    "split": "the current unit is too large or has multiple concerns",
                    "unclear": "the text is not work to implement",
                },
            ),
        }
    if decision_type == "tier-selection":
        pattern = " `task.pattern` names an existing example the work may copy." if _has(context, "task.pattern") else ""
        return {
            "tier": _choice(
                f"Which kind of work does {request} ask an implementer to do?{pattern}",
                {
                    "mechanical": "an edit that copies something the code already does: a rename, the same change repeated across files, a test, a helper function, a text, copy, or config change, or a version bump",
                    "complex": "work that needs a design decision: a new or changed data shape or public contract, a change across modules, services, or processes, concurrency, auth, money, a hot path, or new behavior with no example to copy",
                    "not-a-slice": "no code to write: a question, an explanation, a review, an analysis or research task, a status message, or a report or reply handed back from another agent",
                },
            ),
            "contract_change": _noul(
                f"Does {request} change the shape of stored or exchanged data, or a contract other code or people rely on, such as an API, a schema, a file format, or a command's flags?"
            ),
        }
    if decision_type == "model-selection":
        from .model_selection import question

        return {"rung": question(context)}
    if decision_type == "seat-model":
        return {
            "seat": _choice(
                f"Which seats should run the main session and the advisor for the work in {_fields(context, 'task.request', 'current_state.moment')}?",
                {
                    "opus": "Opus runs the main session and the advisor: routine work",
                    "fable-advisor": "an Opus main session with a Fable advisor: tough work that needs a stronger reviewer",
                    "fable": "Fable runs the main session and the advisor: tough work that keeps failing",
                    "unclear": "the text says too little about the work to place it",
                },
            ),
        }
    if decision_type == "dispatch-readiness":
        return {
            "readiness": _choice(
                "What should the coordinator do with the dispatch described by "
                f"{_fields(context, 'task.brief', 'task.request', 'task.acceptance_criteria', 'task.verification_command', 'task.writable_files', 'task.files', 'task.dependencies')}?",
                {
                    "dispatch": "the brief, files, dependencies, role, and checks are complete",
                    "hold": "the brief is missing required scope or evidence fields",
                    "clarify": "a behavior or public contract is ambiguous",
                    "serialize": "a dependency or shared-file conflict requires ordering",
                    "unclear": "the text says too little about the dispatch to judge it",
                },
            ),
        }
    if decision_type == "runtime-progress":
        return {
            "next": _choice(
                "What should the lane do next, given "
                f"{_fields(context, 'current_state.phase', 'current_state.next_action', 'current_state.blockers', 'current_state.stalled', 'task.request')}?",
                {
                    "continue": "a side effect or evidence update shows progress",
                    "retry": "one distinct hypothesis can be tried safely",
                    "rescope": "the brief needs a reversible scope correction",
                    "block": "an obstacle needs the bounded unblocker contract",
                    "pause": "the lane can stop at a resumable safe point",
                    "escalate": "the next step needs a human: an irreversible action, missing credentials, two readings of a contract, or a recovery loop that keeps repeating",
                    "unclear": "the state says too little about the lane to judge it",
                },
            ),
        }
    if decision_type == "verification":
        judged = judged_evidence(context)
        unread = [item.ref for _, item, text in judged if text is None]
        if unread:
            raise NoQuestion(f"{', '.join(unread[:3])} carries output but covers no acceptance criterion, so no question would read it")
        if judged:
            return {
                **{
                    holds_question(position): _noul(
                        f'Does the output captured from "{item.ref}", in `evidence[].output`, show that the criterion beside it in `evidence[].criterion` holds?'
                    )
                    for position, item, _ in judged
                },
                "unjudgeable": _noul(
                    "Does any item in `task.acceptance_criteria` describe how something feels or seems to a person, instead of a result a test, command, or screenshot can show?"
                ),
            }
        return {
            "result": _choice(
                f"Does the captured evidence in {_fields(context, 'evidence', 'task.request')} support the acceptance criteria in {_fields(context, 'task.acceptance_criteria', 'task.request')}?",
                {
                    "accept": "each criterion is asserted by a captured artifact",
                    "request-evidence": "one or more criteria lack sufficient evidence",
                    "block": "verification cannot proceed because the target is unavailable",
                    "escalate": "the evidence exposes an ambiguity or irreversible next action",
                    "unclear": "the state is not a verification of work against criteria",
                },
            ),
        }
    if decision_type == "skill-improvement":
        return {
            "change": _choice(
                f"What should change after the outcomes recorded in {_fields(context, 'current_state.human_overrides', 'current_state.repeated_pattern', 'history', 'task.request')}?",
                {
                    "no-change": "the evidence does not show a repeatable problem",
                    "collect-evidence": "more outcomes are needed before changing a rule",
                    "propose-change": "a reviewable, evidence-backed rule change is warranted",
                },
            ),
        }
    if decision_type in OPEN_ACTION_TYPES:
        options = open_options(context)
        if decision_type == "tool-selection":
            return {"tool": _choice(f"Which tool should the step in {request} use?", {**options, _exit_for(options): "no listed tool fits the step"})}
        if not _has(context, "task.request"):
            raise NoQuestion("`task.request` is empty, so there is no edit to place")
        return {
            file_question(index): _score(f'Where does the edit that {request} asks for happen, relative to the file "{path}" described in `task.file_summaries`?', FILE_LEVELS)
            for index, path in enumerate(options)
        }
    raise ValueError(f"no Laya question schema for {decision_type!r}")


def state_for(context: DecisionContext, questions: Mapping[str, Mapping[str, Any]], *, max_chars: int = MAX_STATE_CHARS) -> dict[str, Any]:
    """The state sent with ``questions``."""

    return state_for_laya(context, max_chars=max_chars)


def _verdict_questions(context: DecisionContext, questions: Mapping[str, Mapping[str, Any]]) -> tuple[str, ...]:
    if context.decision_type == "file-selection":
        return tuple(questions)
    if context.decision_type == "intake-analysis":
        return ("task_type", "readiness")
    if "unjudgeable" in questions:
        return ("unjudgeable",)
    return (ACTION_QUESTION[context.decision_type],)


def _carries_output(state: Mapping[str, Any], position: int, ref: str) -> bool:
    entries = state.get("evidence") or []
    entry = entries[position] if position < len(entries) else None
    return isinstance(entry, Mapping) and entry.get("ref") == ref and bool(entry.get("output"))


def sent(
    context: DecisionContext, questions: Mapping[str, Mapping[str, Any]], *, max_chars: int = MAX_STATE_CHARS
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """The state sized to ``max_chars`` and the questions it can answer; ``NoQuestion`` when the
    state cannot fit the budget or the fork's verdict questions name what it does not carry."""

    state = state_for_laya(context, max_chars=max_chars)
    if _size(state) > max_chars:
        raise NoQuestion(f"the state needs {_size(state)} characters, over the {max_chars}-character budget")
    outputs = {name: (position, item.ref) for position, item, _ in judged_evidence(context) if (name := holds_question(position)) in questions}
    kept: dict[str, dict[str, Any]] = {}
    dropped: list[str] = []
    for name, question in questions.items():
        absent = [path for path in named_paths({name: question}) if not _present(state, path)]
        if absent or (name in outputs and not _carries_output(state, *outputs[name])):
            dropped.append(name)
        else:
            kept[name] = dict(question)
    missing = [name for name in _verdict_questions(context, questions) if name in dropped]
    if missing:
        raise NoQuestion(f"the {max_chars}-character state does not carry what {_join(missing)} names")
    if outputs and not any(name in kept for name in outputs):
        raise NoQuestion(f"the {max_chars}-character state carries none of the judged outputs")
    return state, kept


def _size(value: Any) -> int:
    return len(json.dumps(value, sort_keys=True, ensure_ascii=False))


def _with_output_tails(state: dict[str, Any], outputs: list[str | None], max_chars: int, *, drop_last_outputs: bool = False) -> dict[str, Any]:
    outputs = list(outputs)
    while True:
        count = sum(1 for output in outputs if output)
        if not count:
            return state
        share = max(MIN_OUTPUT_TAIL_CHARS, (max_chars - _size(state)) // count)
        while True:
            fitted = {
                **state,
                "evidence": [{**entry, "output": trim_output(output, max_chars=share)} if output else entry for entry, output in zip(state["evidence"], outputs)],
            }
            if _size(fitted) <= max_chars:
                return fitted
            if share == MIN_OUTPUT_TAIL_CHARS:
                break
            share = max(MIN_OUTPUT_TAIL_CHARS, share * 3 // 4)
        if not drop_last_outputs:
            return fitted
        outputs[max(index for index, output in enumerate(outputs) if output)] = None


def state_for_laya(context: DecisionContext, *, max_chars: int = MAX_STATE_CHARS) -> dict[str, Any]:
    """Build a bounded state payload; avoid sending whole ledgers or secrets to the model."""

    payload = _payload(context)
    if _size(payload) <= max_chars:
        return payload
    # Shorten long strings first; the acceptance criteria and state flags drive the answer
    # and the safety gates, so they survive before whole sections are dropped. Shortening keeps
    # the head of a string, so evidence output, whose verdict is at its end, is cut separately.
    outputs = [entry.get("output") for entry in payload["evidence"]]
    bare = {**payload, "evidence": [{key: value for key, value in entry.items() if key != "output"} for entry in payload["evidence"]]}
    shortened = _with_output_tails(redact(bare, max_string=400), outputs, max_chars)
    if _size(shortened) <= max_chars:
        return shortened
    keep_state = ("phase", "status", "blockers", "stalled", "attempts", "dependencies_satisfied", "next_action")
    judged = {position: text for position, _, text in judged_evidence(context) if text} if context.decision_type == "verification" else {}
    smallest = redact(
        {
            "decision_type": context.decision_type,
            "task": {
                key: context.task.get(key)
                for key in ("title", "request", "acceptance_criteria", "finish_condition", "estimated_changed_lines", "file_summaries")
                if context.task.get(key) is not None
            },
            "playbook": context.playbook,
            "current_state": {key: context.current_state.get(key) for key in keep_state if key in context.current_state},
            "evidence": [
                {"kind": item.kind, "ref": item.ref, **({"criterion": judged[position]} if position in judged else {})}
                for position, item in enumerate(context.evidence[:20])
            ],
            "constraints": context.constraints,
            "available_actions": list(context.available_actions),
        },
        max_string=200,
    )
    tails = [item.output if position in judged else None for position, item in enumerate(context.evidence[:20])]
    return _with_output_tails(smallest, tails, max_chars, drop_last_outputs=True)
