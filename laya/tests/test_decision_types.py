from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from laya.engine import DecisionEngine
from laya.schema import ACTIONS_BY_TYPE, DECISION_TYPES, OPEN_ACTION_TYPES

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "vistack-decision.py"
REQUEST = {"metadata": {"source": "main-session"}, "task": {"request": "Fix the failing upload test in the deck"}}
OPTIONS = {"tool-selection": ["Read", "Grep", "Bash"], "file-selection": ["hooks/lib/jev.ts", "hooks/register.tsx"]}


def run_cli(decision_type: str, context: dict, workdir: str) -> subprocess.CompletedProcess:
    path = Path(workdir) / f"{decision_type}.json"
    path.write_text(json.dumps(context), encoding="utf-8")
    env = {key: value for key, value in os.environ.items() if not key.startswith("VISTACK_LAYA_")}
    return subprocess.run(
        [sys.executable, str(SCRIPT), "decision", decision_type, "--backend", "deterministic", "--no-history", "--context", str(path)],
        capture_output=True,
        cwd=workdir,
        env=env,
        text=True,
        timeout=60,
    )


class EveryDecisionTypeTests(unittest.TestCase):
    def test_engine_answers_every_type_from_a_request(self):
        engine = DecisionEngine(backend="deterministic", history_path=None)
        for decision_type in DECISION_TYPES:
            with self.subTest(decision_type=decision_type):
                context = dict(REQUEST, available_actions=OPTIONS.get(decision_type, []))
                result = engine.decide(context, decision_type=decision_type)
                result.validate(available_actions=tuple(OPTIONS.get(decision_type, ())))
                self.assertEqual(result.decision_type, decision_type)
                expected = OPTIONS.get(decision_type) or ACTIONS_BY_TYPE[decision_type]
                self.assertIn(result.action, expected)

    def test_option_types_reject_a_request_without_options(self):
        engine = DecisionEngine(backend="deterministic", history_path=None)
        for decision_type in OPEN_ACTION_TYPES:
            with self.subTest(decision_type=decision_type):
                with self.assertRaisesRegex(ValueError, "requires the candidate options in available_actions"):
                    engine.decide(dict(REQUEST), decision_type=decision_type)

    def test_cli_prints_a_typed_decision_for_every_type(self):
        with tempfile.TemporaryDirectory() as workdir:
            for decision_type in DECISION_TYPES:
                with self.subTest(decision_type=decision_type):
                    context = dict(REQUEST, available_actions=OPTIONS[decision_type]) if decision_type in OPTIONS else REQUEST
                    ran = run_cli(decision_type, context, workdir)
                    self.assertEqual(ran.returncode, 0, ran.stderr)
                    answer = json.loads(ran.stdout)
                    self.assertEqual(answer["decision_type"], decision_type)
                    self.assertIsInstance(answer["outputs"], dict)
                    self.assertIn(answer["fork"], ("sharp", "split"))
            self.assertEqual(list(Path(workdir).glob("**/*.jsonl")), [])

    def test_cli_exits_with_a_usage_error_for_an_option_type_without_options(self):
        with tempfile.TemporaryDirectory() as workdir:
            for decision_type in OPEN_ACTION_TYPES:
                with self.subTest(decision_type=decision_type):
                    ran = run_cli(decision_type, REQUEST, workdir)
                    self.assertEqual(ran.returncode, 2, ran.stderr)
                    self.assertEqual(ran.stdout, "")
                    self.assertNotIn("Traceback", ran.stderr)
                    self.assertEqual(len(ran.stderr.strip().splitlines()), 1)
                    self.assertIn(decision_type, ran.stderr)
                    self.assertIn('pass "available_actions" in the context JSON', ran.stderr)

    def test_cli_usage_error_also_covers_an_empty_options_list(self):
        with tempfile.TemporaryDirectory() as workdir:
            for decision_type in OPEN_ACTION_TYPES:
                with self.subTest(decision_type=decision_type):
                    ran = run_cli(decision_type, dict(REQUEST, available_actions=[]), workdir)
                    self.assertEqual(ran.returncode, 2, ran.stderr)
                    self.assertNotIn("Traceback", ran.stderr)

    def test_the_deck_labels_every_type_in_schema_order(self):
        source = (ROOT / "hooks" / "lib" / "fork-types.ts").read_text(encoding="utf-8")
        labelled = re.findall(r"\['([a-z-]+)', '[a-z]+'\]", source)
        self.assertEqual(tuple(labelled), DECISION_TYPES)


if __name__ == "__main__":
    unittest.main()
