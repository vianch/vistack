from __future__ import annotations

import unittest

from laya.engine import DecisionEngine
from laya.schema import PLAYBOOKS


RECORDED_UNATTENDED_ANALYSIS = (
    "unattended \n\nanalyze the current stack, search what can improved \nthen take a look if the following "
    "patterns are correct and make updates:\n\ndraft → test → inspect → correct → repeat\n\n"
    "check teh analysis skill where we interrogate verify and correct [Image #2]\n\n"
    "04. Supervisor: catch the failures\nOne supervising agent hands tasks to workers, checks every result, and "
    "sends failures back with a reason. Use it for long jobs where something will break, like building and "
    "testing a tool. Every agent's first step is to read all three. Analyse the following if it's secure"
)
RECORDED_IMPROVE_RUN_PASTE = (
    "unattended \n\nwe need to update our process to improve the performance of our agents and our skills see "
    "what went well and what went wrong \ndo not use github for creating PR, rising PR, commit, push, etc\n\n"
    "And extract the better for those skills and create a skill that is called `improve` where the principal "
    "obejctive is Find the mistakes agents keep repeating in this repo and make each one impossible. Try "
    "architecture first, then types, then a lint whose error names the fix, then a test, and write docs last. "
    "Prove each check fails on a real past mistake. Use for /improve \n\nonce this is completed we need revisit "
    "our decision layer strategy[Image #1] and evaluete or improve the questions on the loop\n\nIs this safe to "
    "run?\nis this done?\n\nclient = TypeSafeClient(model=\"jev-1.13.0\")"
)
RECORDED_IMPROVE_RUN = (
    "unattended. we need to update our process to improve the performance of our agents and our skills see what "
    "went well and what went wrong. do not use github for creating PR, rising PR, commit, push, etc however we "
    "need to read some repos to make improvements to the stack. read the retro SKILL, writing-for-agents SKILL and "
    "SKILL-MECHANICS, the correct SKILL, and create a skill called improve: Find the mistakes agents keep "
    "repeating in this repo and make each one impossible. Try architecture first, then types, then a lint whose "
    "error names the fix, then a test, and write docs last. Prove each check fails on a real past mistake. Use "
    "for /improve. Then revisit the decision layer strategy: which model to use, which files to read, is this "
    "safe to run, is this done, keep or drop. analyse, evaluate and improve the flow"
)
RECORDED_SKILL_WITH_PASTE = (
    "we need to create a skill and analyse if an agent with the following \"You are doing ONE high-value "
    "maintenance change, autonomously. Pick by RISK to the codebase's long-term integrity — the chance of a "
    "production incident — NOT by line count.\" also we need to identify which verbs or words trigger this, as "
    "refactor, change, update object update constant variable, etc. Also create a loop, or skill to do the "
    "following loop or cron job. Each night: 1. Boot the real app. 2. Send it random and malformed HTTP requests "
    "until it crashes. 3. Find the root cause of one new crash, then fix it. 4. Prove the fix and open one draft "
    "PR. Read every rule that applies, especially `testing-standards.md` and `error-codes.md`. Never fake a "
    "crash or a fix."
)


def route(request, **task):
    return DecisionEngine(backend="deterministic").decide({"decision_type": "playbook-selection", "task": {"request": request, **task}})


class UnattendedIsNoShortcutTests(unittest.TestCase):
    def test_recorded_unattended_requests_are_not_autopilot(self):
        for request in (RECORDED_UNATTENDED_ANALYSIS, RECORDED_IMPROVE_RUN_PASTE, RECORDED_IMPROVE_RUN):
            result = route(request)
            self.assertNotEqual(result.action, "autopilot-stack", request[:60])
            self.assertEqual(result.fork, "split", request[:60])
            self.assertEqual(result.outputs["route_source"], "signals", request[:60])

    def test_unattended_or_autopilot_as_a_noun_routes_by_its_signals(self):
        labelled = {
            "why did the unattended run fail last night": "investigation",
            "the autopilot docs are wrong, fix the typo": "bug-fix",
            "add an unattended flag to the cron script": "feature",
            "the autopilot-stack playbook skips step 3": "authoring-skill",
        }
        for request, expected in labelled.items():
            result = route(request)
            self.assertEqual((result.action, result.fork), (expected, "sharp"), request)

    def test_a_playbook_name_or_a_failure_on_autopilot_is_not_the_run_mode(self):
        for request in (
            "autopilot-stack docs are stale, fix them",
            "run the autopilot-stack tests",
            "handle the autopilot-full edge case",
            "fix autopilot mode detection",
            "why did it fail on autopilot this morning",
        ):
            self.assertNotEqual(route(request).action, "autopilot-stack", request)

    def test_an_image_placeholder_or_a_pr_number_is_not_a_ticket_reference(self):
        for request in ("unattended: look at [Image #2] and analyze the stack", "PR #12 is broken, run it unattended"):
            self.assertNotEqual(route(request).action, "autopilot-stack", request)

    def test_a_past_tense_why_asks_for_an_explanation(self):
        self.assertEqual(route("Why did the build fail on CI").action, "investigation")
        self.assertEqual(route("Why does the build fail on CI").action, "bug-fix")

    def test_unattended_with_a_groomed_unit_is_autopilot(self):
        for request, task in (
            ("Run #42 unattended", {}),
            ("Run PROJ-12 unattended", {}),
            ("run this unattended", {"acceptance_criteria": ["the export button downloads a CSV"]}),
        ):
            result = route(request, **task)
            self.assertEqual((result.action, result.fork, result.outputs["route_source"]), ("autopilot-stack", "sharp", "handoff"), request)

    def test_autopilot_named_as_the_run_mode_needs_no_ticket(self):
        for request in ("Run the queue autopilot and give me a dashboard page at the end", "autopilot it", "Put the auth refactor on autopilot"):
            result = route(request)
            self.assertEqual((result.action, result.fork), ("autopilot-stack", "sharp"), request)


class QuotedTextTests(unittest.TestCase):
    def test_quoted_backticked_and_fenced_words_do_not_route(self):
        for request in (
            'Add a "Report a bug" button to the help menu',
            "Add a `--fix` flag to the lint script",
            "Add this snippet to the README:\n```\nnpm run fix -- broken\n```",
        ):
            self.assertEqual(route(request).action, "feature", request)

    def test_a_pasted_prompt_does_not_make_a_skill_request_a_sharp_bug_fix(self):
        result = route(RECORDED_SKILL_WITH_PASTE)
        self.assertEqual(result.fork, "split")
        self.assertIn("authoring-skill", result.probabilities)


class MultiAskTests(unittest.TestCase):
    def test_three_kinds_of_work_leave_the_pick_to_the_fork_layer(self):
        result = route("Fix the broken login redirect, refactor the cart module, and investigate why exports are slow")
        self.assertEqual(result.fork, "split")
        self.assertIn("kinds of work", result.rationale)

    def test_state_and_handoff_routes_ignore_the_cap(self):
        many = "fix the broken login redirect, refactor the cart module, and investigate why exports are slow"
        self.assertEqual((route(f"I'm going to bed: {many}").action, route(f"I'm going to bed: {many}").fork), ("overnight", "sharp"))
        blocked = DecisionEngine(backend="deterministic").decide(
            {"decision_type": "playbook-selection", "task": {"request": many}, "current_state": {"phase": "blocked"}}
        )
        self.assertEqual((blocked.action, blocked.fork), ("blocker", "sharp"))


class ImproveAndAuthoringTests(unittest.TestCase):
    def test_improve_is_a_playbook_reached_by_phrases(self):
        self.assertIn("improve", PLAYBOOKS)
        for request in (
            "Find the mistakes agents keep repeating in this repo and make each one impossible",
            "/improve the coordinator keeps making the same mistake: it waives the 500-line limit every run",
            "Agents keep running git in this repo despite the rule; make it impossible to repeat",
        ):
            result = route(request)
            self.assertEqual((result.action, result.fork), ("improve", "sharp"), request)

    def test_a_bare_improve_or_a_correct_path_is_not_the_improve_route(self):
        self.assertEqual(route("Improve performance of the checkout page").action, "perf-issue")
        self.assertNotEqual(route("read pstack/skills/correct/SKILL.md").action, "improve")

    def test_creating_or_changing_a_skill_is_a_strong_authoring_signal(self):
        for request in ("Create a skill called improve", "Update the commit skill to run the linter first"):
            result = route(request)
            self.assertEqual((result.action, result.fork), ("authoring-skill", "sharp"), request)
            self.assertGreaterEqual(result.confidence, 0.85, request)


if __name__ == "__main__":
    unittest.main()
