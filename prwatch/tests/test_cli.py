from __future__ import annotations

import contextlib
import io
import json
import unittest

from prwatch.cli import backoff, main
from prwatch.github import QueryError
from prwatch.policy import Check

from .test_policy import snapshot


class WatchLoopTests(unittest.TestCase):
    def run_main(self, argv, reads, clock_values=None):
        out, sleeps = io.StringIO(), []
        sequence = iter(reads)

        def read(number):
            item = next(sequence)
            if isinstance(item, Exception):
                raise item
            return item

        clock = iter(clock_values or [0] * 100)
        code = main(argv, read=read, sleep=sleeps.append, clock=lambda: next(clock), out=out)
        return code, [json.loads(line) for line in out.getvalue().splitlines()], sleeps

    def test_waits_then_exits_on_the_terminal_verdict(self):
        pending = snapshot(checks=(Check("unit", "pending"),))
        code, events, sleeps = self.run_main(["--pr", "#12"], [pending, pending, snapshot()])
        self.assertEqual(code, 0)
        self.assertEqual([event["event"] for event in events], ["progress", "verdict"])
        self.assertEqual(sleeps, [60, 60])

    def test_blocker_exit_code_is_the_process_exit_code(self):
        code, events, _ = self.run_main(["--pr", "12"], [snapshot(reviewer_requested=False)])
        self.assertEqual(code, 8)
        self.assertEqual(events[-1]["overall"]["reason"], "no reviewer requested")

    def test_query_errors_back_off_then_give_up(self):
        error = QueryError("rate limited")
        code, _, sleeps = self.run_main(["--pr", "12", "--max-query-errors", "3"], [error, error, error])
        self.assertEqual(code, 7)
        self.assertEqual(sleeps, [60, 120])

    def test_timeout_ends_the_watch(self):
        pending = snapshot(checks=(Check("unit", "pending"),))
        code, events, _ = self.run_main(["--pr", "12", "--timeout", "90"], [pending, pending], clock_values=[0, 30, 95])
        self.assertEqual(code, 5)
        self.assertEqual(events[-1]["overall"]["kind"], "timeout")

    def test_status_only_reads_once_and_exits_zero(self):
        code, events, sleeps = self.run_main(["--pr", "12", "--status-only"], [snapshot(reviewer_requested=False)])
        self.assertEqual((code, len(events), sleeps), (0, 1, []))

    def test_bad_pr_argument_exits_64(self):
        with self.assertRaises(SystemExit) as raised, contextlib.redirect_stderr(io.StringIO()):
            main(["--pr", "abc"], read=lambda number: snapshot(), out=io.StringIO())
        self.assertEqual(raised.exception.code, 64)

    def test_backoff_caps_at_five_minutes(self):
        self.assertEqual([backoff(60, n) for n in (1, 2, 3, 4)], [60, 120, 240, 300])


if __name__ == "__main__":
    unittest.main()
