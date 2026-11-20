"""Question lint: every typed question a decision model sees follows the operator's rules.

The question ID is never sent, so meaning lives in the instructions and option descriptions.
Each failure names the rule and the fix. The lint builds every type's questions from the
labelled scenarios plus a few synthetic contexts the scenarios lack, and checks them against
the state the engine actually sends.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path
from typing import Any, Mapping

from laya import questions as questions_module
from laya.schema import DECISION_TYPES, OPEN_ACTION_TYPES, DecisionContext


ROOT = Path(__file__).resolve().parents[2]
SCENARIOS = ROOT / "examples" / "laya" / "scenarios.jsonl"
RULE_EXITS = frozenset({"ask", "no-change", "none", "not-a-slice", "unclear"})
STATE_ROOTS = ("task", "current_state", "evidence", "constraints", "history", "playbook", "available_actions")
STATE_PATH = re.compile(rf"`((?:{'|'.join(STATE_ROOTS)})(?:\[\])?(?:\.[A-Za-z_][\w-]*(?:\[\])?)*)`")
DEGREE = re.compile(
    r"\b(?:low(?:er)?|moderate(?:ly)?|medium|high(?:er)?|more|less|most|least|some|partial(?:ly)?|partly|mostly|very|"
    r"slightly|somewhat|fairly|little|much|few|many|small(?:er)?|large(?:r)?|minor|major|previous|prior|above|below|better|worse)\b",
    re.I,
)
QUOTED_REF = re.compile(r'"([^"\n]+)"')
BUDGETS = (12000, 6000, 1200, 800)
BARE_NUMBER = re.compile(r"^\W*\d+(?:\.\d+)?\W*$")
MIN_LEVEL_WORDS = 3
INVERTED = re.compile(
    r"\b(?:safe(?:ly)?|okay|ok|fine|healthy|passing|passes|succeed(?:s|ed)?|correct(?:ly)?|valid)\b"
    r"|\b(?:is|are|does|do|did|was|were|has|have|can|will|would|should|could)(?:n't| not)\b"
    r"|\bthere (?:is|are) no\b|\b(?:absent|free of)\b",
    re.I,
)
FIXES = {
    "exit-set": "define the closed exit set once as laya.questions.EXIT_OPTIONS = {none, not-a-slice, ask, unclear, no-change}",
    "exit-option": "add one option from EXIT_OPTIONS so an unsure answer has a place to go, and map it in code to a split fork",
    "option-meaning": "describe the situation that makes the option right; the key alone carries no meaning to the model",
    "state-pointer": "name the state field the answer depends on in backticks, such as `task.request`, and send that field",
    "state-absent": "name only fields the state sent carries, or send the field the question names",
    "score-level": "write each level as a situation that stands alone: no degree word, no bare number, no reference to another level",
    "noul-polarity": "phrase it so a high number means yes, the risk is present",
    "silent-cut": "never drop candidates past the choice budget silently; decline to ask and say why",
}
SYNTHETIC = (
    ("synthetic-tool-undescribed", "tool-selection", {"task": {"request": "Find the callers"}, "available_actions": ["grep", "read"]}),
    ("synthetic-file-undescribed", "file-selection", {"task": {"request": "Fix the gate"}, "available_actions": ["laya/engine.py", "laya/cli.py"]}),
    (
        "synthetic-tool-over-budget",
        "tool-selection",
        {
            "task": {"request": "Pick a tool", "tools": {f"tool-{index}": f"tool number {index} for one job" for index in range(12)}},
            "available_actions": [f"tool-{index}" for index in range(12)],
        },
    ),
)


def exit_options() -> frozenset[str] | None:
    value = getattr(questions_module, "EXIT_OPTIONS", None)
    return frozenset(value) if value is not None else None


def values_at(state: Any, path: str) -> list[Any]:
    """Every value at ``path``; ``[]`` steps into each item of a list."""

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


def present(state: Mapping[str, Any], path: str) -> bool:
    return any(value not in (None, "", [], {}) for value in values_at(state, path))


def state_sent(context: DecisionContext, questions: Mapping[str, Mapping[str, Any]]) -> Mapping[str, Any]:
    build = getattr(questions_module, "state_for", None)
    return build(context, questions) if build else questions_module.state_for_laya(context)


def asked_at(context: DecisionContext, questions: Mapping[str, Mapping[str, Any]], budget: int) -> tuple[Mapping[str, Any], Mapping[str, Mapping[str, Any]]] | None:
    prune = getattr(questions_module, "sent", None)
    if prune is None:
        return questions_module.state_for(context, questions, max_chars=budget), questions
    try:
        return prune(context, questions, max_chars=budget)
    except questions_module.NoQuestion:
        return None


def entry_carries(state: Mapping[str, Any], ref: str, field: str) -> bool:
    return any(isinstance(entry, Mapping) and entry.get("ref") == ref and entry.get(field) not in (None, "", [], {}) for entry in state.get("evidence") or [])


def built(context: DecisionContext) -> Mapping[str, Mapping[str, Any]] | None:
    """The questions for ``context``, or None when the tree declines to ask on purpose."""

    declined = getattr(questions_module, "NoQuestion", None)
    try:
        return questions_module.questions_for(context)
    except Exception as exc:
        if declined is not None and isinstance(exc, declined):
            return None
        raise


def violations(
    decision_type: str,
    questions: Mapping[str, Mapping[str, Any]],
    state: Mapping[str, Any],
    exits: frozenset[str],
    candidates: tuple[str, ...] = (),
) -> list[tuple[str, str, str]]:
    """``(rule, where, detail)`` for every rule a question set breaks."""

    found: list[tuple[str, str, str]] = []
    for name, question in questions.items():
        where = f"{decision_type}.{name}"
        kind = question.get("type")
        instructions = str(question.get("instructions") or "")
        criteria = question.get("criteria") or {}
        texts = [instructions, *(criteria.values() if isinstance(criteria, Mapping) else criteria)]
        paths = [path for text in texts for path in STATE_PATH.findall(str(text))]
        if not STATE_PATH.search(instructions):
            found.append(("state-pointer", where, f"instructions name no state field: {instructions!r}"))
        for path in dict.fromkeys(paths):
            if not present(state, path):
                found.append(("state-absent", where, f"`{path}` is not in the state sent"))
        entry_fields = [path.split(".", 1)[1] for path in dict.fromkeys(paths) if path.startswith("evidence[].")]
        for ref in QUOTED_REF.findall(instructions) if entry_fields else ():
            for field in entry_fields:
                if not entry_carries(state, ref, field):
                    found.append(("state-absent", where, f'the evidence entry "{ref}" carries no `{field}` in the state sent'))
        if kind == "choice":
            keys = list(criteria)
            if not set(keys) & exits:
                found.append(("exit-option", where, f"options {keys} have no exit"))
            same_as_key = [key for key, text in criteria.items() if re.sub(r"\W+", " ", str(text)).strip().lower() == re.sub(r"\W+", " ", key).strip().lower()]
            for key in same_as_key:
                found.append(("option-meaning", where, f"option {key!r} is described by its own key"))
            templates = {str(text).lower().replace(key.lower(), "{key}") for key, text in criteria.items()}
            if len(keys) > 1 and len(templates) == 1 and "{key}" in next(iter(templates)) and not same_as_key:
                found.append(("option-meaning", where, f"every description is the template {next(iter(templates))!r}"))
            offered = [key for key in keys if key not in exits]
            if candidates and len(offered) < len(candidates):
                found.append(("silent-cut", where, f"{len(candidates)} candidates, {len(offered)} offered"))
        elif kind == "score":
            for level in criteria:
                text = str(level)
                if DEGREE.search(text) or BARE_NUMBER.match(text) or len(text.split()) < MIN_LEVEL_WORDS:
                    found.append(("score-level", where, f"level {text!r} names a degree, not a situation"))
        elif kind == "noul":
            if INVERTED.search(instructions):
                found.append(("noul-polarity", where, f"{instructions!r} reads high as safe or absent"))
    return found


def contexts() -> list[tuple[str, DecisionContext]]:
    rows = [json.loads(line) for line in SCENARIOS.read_text(encoding="utf-8").splitlines() if line.strip()]
    found = [(row["id"], DecisionContext.from_dict(row["context"], decision_type=row["decision_type"])) for row in rows]
    found += [(name, DecisionContext.from_dict(context, decision_type=decision_type)) for name, decision_type, context in SYNTHETIC]
    return found


def smallest_state_contexts() -> list[tuple[str, DecisionContext]]:
    criteria = [f"criterion {index}: the export writes row {index} with its totals and tax" for index in range(1, 23)]
    output = "\n".join(f"tests/test_export.py::test_case_{case} PASSED" for case in range(8)) + "\n8 passed in 0.4s"
    evidence = [{"kind": "command", "ref": f"pytest -q tests/test_export_{index}.py", "criterion": str(index), "output": output} for index in range(1, 23)]
    dispatch = {
        "request": "Implement the export slice",
        "brief": "Write the CSV export. " * 45,
        "writable_files": [f"src/export/part_{index}.ts" for index in range(40)],
        "verification_command": "npm test -- export",
        "acceptance_criteria": ["the export has a header row"],
    }
    return [
        ("synthetic-22-outputs", DecisionContext.from_dict({"task": {"request": "Verify the export", "acceptance_criteria": criteria}, "evidence": evidence}, decision_type="verification")),
        ("synthetic-long-dispatch", DecisionContext.from_dict({"task": dispatch}, decision_type="dispatch-readiness")),
    ]


def report(found: dict[tuple[str, str], list[str]]) -> str:
    lines = []
    for (rule, where), seen in sorted(found.items()):
        lines.append(f"RULE {rule}: {where} - {seen[0]} (in {len(seen)} context(s))\n    fix: {FIXES[rule]}")
    return "\n".join(lines)


class QuestionRuleTests(unittest.TestCase):
    maxDiff = None

    def test_the_exit_set_is_defined_once_and_closed(self):
        exits = exit_options()
        if exits is None:
            self.fail(f"RULE exit-set: laya.questions defines no EXIT_OPTIONS\n    fix: {FIXES['exit-set']}")
        self.assertEqual(exits, RULE_EXITS, f"RULE exit-set: EXIT_OPTIONS is {sorted(exits)}\n    fix: {FIXES['exit-set']}")

    def test_every_question_follows_the_rules(self):
        exits = exit_options() or RULE_EXITS
        found: dict[tuple[str, str], list[str]] = {}
        covered: set[str] = set()
        for scenario_id, context in contexts():
            questions = built(context)
            if questions is None:
                continue
            covered.add(context.decision_type)
            candidates = context.available_actions if context.decision_type in OPEN_ACTION_TYPES else ()
            for rule, where, detail in violations(context.decision_type, questions, state_sent(context, questions), exits, candidates):
                found.setdefault((rule, where), []).append(f"{detail} [{scenario_id}]")
        self.assertEqual(set(DECISION_TYPES) - covered, set(), "every decision type needs a labelled context the lint can build")
        self.assertFalse(found, "\n" + report(found))

    def test_every_question_asked_at_every_budget_names_only_what_its_state_carries(self):
        exits = exit_options() or RULE_EXITS
        found: dict[tuple[str, str], list[str]] = {}
        for scenario_id, context in [*contexts(), *smallest_state_contexts()]:
            questions = built(context)
            if questions is None:
                continue
            for budget in BUDGETS:
                asked = asked_at(context, questions, budget)
                if asked is None:
                    continue
                state, kept = asked
                for rule, where, detail in violations(context.decision_type, kept, state, exits):
                    if rule == "state-absent":
                        found.setdefault((rule, where), []).append(f"{detail} [{scenario_id} at {budget}]")
        self.assertFalse(found, "\n" + report(found))

    def test_the_state_honours_its_budget(self):
        over = []
        for scenario_id, context in [*contexts(), *smallest_state_contexts()]:
            questions = built(context)
            if questions is None:
                continue
            for budget in BUDGETS[:2]:
                asked = asked_at(context, questions, budget)
                size = len(json.dumps(asked[0], sort_keys=True, ensure_ascii=False)) if asked else 0
                if size > budget:
                    over.append(f"{scenario_id}: {size} > {budget}")
        self.assertEqual(over, [])

    def test_each_rule_fires_on_a_bad_question(self):
        state = {"task": {"request": "Add a flag"}}
        bad = {
            "pick": {"type": "choice", "instructions": "Which route?", "criteria": {"a": "a", "b": "existing route: b"}},
            "routes": {"type": "choice", "instructions": "Which route fits `task.request`?", "criteria": {"alpha": "existing route: alpha", "beta": "existing route: beta"}},
            "risk": {"type": "score", "instructions": "How risky is `task.request`?", "criteria": ["low", "high", "requires human decision"]},
            "safe": {"type": "noul", "instructions": "Is it safe to run `task.command`?"},
        }
        rules = {rule for rule, _, _ in violations("synthetic", bad, state, RULE_EXITS, ("a", "b", "c"))}
        self.assertEqual(rules, {"exit-option", "option-meaning", "state-pointer", "state-absent", "score-level", "noul-polarity", "silent-cut"})

    def test_a_question_that_follows_the_rules_passes(self):
        state = {"task": {"request": "Add a flag"}}
        good = {
            "tier": {
                "type": "choice",
                "instructions": "Which kind of work does `task.request` ask for?",
                "criteria": {"edit": "an edit that copies an existing example", "design": "work that needs a design decision", "not-a-slice": "no code to write"},
            },
            "contract": {"type": "noul", "instructions": "Does `task.request` change a contract other code relies on?"},
        }
        self.assertEqual(violations("synthetic", good, state, RULE_EXITS), [])


if __name__ == "__main__":
    unittest.main()
