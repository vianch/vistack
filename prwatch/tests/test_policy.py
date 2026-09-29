from __future__ import annotations

import json
import unittest

from prwatch.github import QueryError, read_snapshot
from prwatch.policy import Check, Snapshot, Thread, classify, combine


def snapshot(**overrides):
    value = {
        "number": 12,
        "url": "https://example.test/pr/12",
        "state": "OPEN",
        "is_draft": True,
        "mergeable": "MERGEABLE",
        "merge_state": "CLEAN",
        "review_decision": "REVIEW_REQUIRED",
        "head_sha": "abc123",
        "changed_lines": 120,
        "reviewer_requested": True,
        "checks": (Check("unit", "pass"),),
        "unresolved_threads": (),
    }
    value.update(overrides)
    return Snapshot(**value)


class ClassifyTests(unittest.TestCase):
    def test_clean_draft_is_merge_ready(self):
        result = classify(snapshot())
        self.assertEqual((result.kind, result.exit_code), ("merge-ready", 0))

    def test_merged_by_a_person_is_terminal_success(self):
        self.assertEqual(classify(snapshot(state="MERGED")).kind, "merged")

    def test_conflicts_block_before_anything_else(self):
        result = classify(snapshot(mergeable="CONFLICTING", checks=(Check("unit", "fail"),)))
        self.assertEqual((result.kind, result.exit_code), ("blocked", 2))

    def test_changes_requested_is_a_merge_gate(self):
        self.assertEqual(classify(snapshot(review_decision="CHANGES_REQUESTED")).exit_code, 6)

    def test_failing_checks_name_the_check(self):
        result = classify(snapshot(checks=(Check("unit", "fail", "https://ci/1"), Check("lint", "pass"))))
        self.assertEqual(result.exit_code, 4)
        self.assertEqual(result.details, ("unit: https://ci/1",))

    def test_unresolved_thread_blocks_even_while_checks_run(self):
        result = classify(
            snapshot(checks=(Check("unit", "pending"),), unresolved_threads=(Thread("a.ts", 3, "bot", "fix"),))
        )
        self.assertEqual((result.kind, result.exit_code), ("blocked", 3))
        self.assertEqual(result.details, ("a.ts:3 bot",))

    def test_pending_checks_wait(self):
        result = classify(snapshot(checks=(Check("unit", "pending"),)))
        self.assertEqual(result.kind, "waiting")
        self.assertFalse(result.terminal)

    def test_missing_reviewer_blocks_a_green_pr(self):
        self.assertEqual(classify(snapshot(reviewer_requested=False)).exit_code, 8)

    def test_oversized_diff_is_reported_not_blocking(self):
        result = classify(snapshot(changed_lines=640))
        self.assertEqual(result.kind, "merge-ready")
        self.assertIn("oversized: 640 changed lines", result.details)

    def test_combine_prefers_a_blocker_then_waiting(self):
        ready, waiting = classify(snapshot()), classify(snapshot(checks=(Check("unit", "pending"),)))
        blocked = classify(snapshot(number=13, reviewer_requested=False))
        self.assertEqual(combine([ready, waiting, blocked]).number, 13)
        self.assertEqual(combine([ready, waiting]).kind, "waiting")
        self.assertEqual(combine([ready, ready]).kind, "merge-ready")


def fake_gh(responses):
    calls = []

    def run(args, ok):
        calls.append(list(args))
        key = " ".join(args[:2])
        return responses[key]

    run.calls = calls
    return run


PR_VIEW = {
    "number": 12,
    "url": "https://example.test/pr/12",
    "state": "OPEN",
    "isDraft": True,
    "mergeable": "MERGEABLE",
    "mergeStateStatus": "CLEAN",
    "reviewDecision": "REVIEW_REQUIRED",
    "headRefOid": "abc123",
    "additions": 90,
    "deletions": 10,
    "reviewRequests": [{"login": "team"}],
    "latestReviews": [],
}
THREADS = {
    "data": {
        "repository": {
            "pullRequest": {
                "reviewThreads": {
                    "nodes": [
                        {"isResolved": True, "comments": {"nodes": [{"path": "a.ts", "line": 1}]}},
                        {
                            "isResolved": False,
                            "comments": {"nodes": [{"path": "b.ts", "line": 7, "author": {"login": "bot"}, "body": "x"}]},
                        },
                    ]
                }
            }
        }
    }
}


class GitHubReadTests(unittest.TestCase):
    def test_read_snapshot_maps_gh_output(self):
        run = fake_gh(
            {
                "pr view": json.dumps(PR_VIEW),
                "pr checks": json.dumps([{"name": "unit", "bucket": "pass", "link": ""}]),
                "api graphql": json.dumps(THREADS),
            }
        )
        result = read_snapshot(12, "org/repo", run=run)
        self.assertEqual(result.changed_lines, 100)
        self.assertTrue(result.reviewer_requested)
        self.assertEqual(result.unresolved_threads, (Thread("b.ts", 7, "bot", "x"),))
        self.assertEqual([call[:2] for call in run.calls], [["pr", "view"], ["pr", "checks"], ["api", "graphql"]])

    def test_empty_checks_output_means_no_checks(self):
        run = fake_gh({"pr view": json.dumps(PR_VIEW), "pr checks": "", "api graphql": json.dumps(THREADS)})
        self.assertEqual(read_snapshot(12, "org/repo", run=run).checks, ())

    def test_invalid_json_is_a_query_error(self):
        run = fake_gh({"pr view": "{not json", "pr checks": "", "api graphql": ""})
        with self.assertRaises(QueryError):
            read_snapshot(12, "org/repo", run=run)


if __name__ == "__main__":
    unittest.main()
