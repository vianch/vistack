from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from laya.engine import DecisionEngine
from laya.feedback import analyze, proposals


class FeedbackTests(unittest.TestCase):
    def test_repeated_overrides_produce_reviewable_proposal(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.jsonl"
            engine = DecisionEngine(backend="deterministic", history_path=str(path))
            for index in range(3):
                decision = engine.decide(
                    {
                        "decision_type": "runtime-progress",
                        "task": {"request": "Continue the lane"},
                        "current_state": {"phase": "implementing"},
                    },
                    request_id=f"decision-{index}",
                )
                engine.history.record_override(decision.decision_id, "pause", "human saw a safe stop")
            summary = analyze(path)
            self.assertEqual(summary["override_count"], 3)
            result = proposals(path)
            self.assertEqual(result[0]["human_action"], "pause")
            self.assertEqual(len(result[0]["evidence_decision_ids"]), 3)


if __name__ == "__main__":
    unittest.main()
