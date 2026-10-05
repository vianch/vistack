"""The Cloudflare Workers AI tier and its daily Neuron ledger. Every test patches
``laya.system_one.urlopen`` and uses fake credentials: the developer's shell exports real ones,
and a test must never send a request."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from laya import cli
from laya.cloudflare import DEFAULT_DAILY_CAP, FREE_NEURONS_PER_DAY, NEURONS_PER_M_INPUT, NeuronBudget, daily_cap, estimate_neurons, neurons
from laya.config import read_settings, write_enabled
from laya.engine import DecisionEngine, _Unavailable
from laya.errors import InferenceTimeout, LayaUnavailable
from laya.system_one import CloudflareBackend, probe_cloudflare


ROOT = Path(__file__).resolve().parents[2]
TOKEN = "test-token-value"
ACCOUNT = "test-account-value"
RUN_URL = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/ai/run/@cf/cloudflare/clef-flash"
OLLAMA = "http://127.0.0.1:11434"
# The live bodies from 2026-10-05, verbatim.
LIVE_SUCCESS = (
    '{"result":{"model":"clef-flash","answers":{"green":{"type":"noul","noul":0.9661},"pick":{"type":"choice",'
    '"choice":"mechanical","probabilities":{"mechanical":0.8954,"complex":0.1046},"confidence":0.6254}},'
    '"usage":{"input_tokens":217,"output_tokens":0}},"success":true,"errors":[],"messages":[]}'
)
LIVE_AUTH_FAILURE = '{"result":null,"success":false,"errors":[{"code":10000,"message":"Authentication error"}],"messages":[]}'
LIVE_NEURONS = 217 * NEURONS_PER_M_INPUT / 1_000_000
QUESTION = {"green": {"type": "noul", "instructions": "Is the build passing?"}}
SPLIT_FORK = {"decision_type": "tier-selection", "task": {"request": "Update the order summary panel"}}


def response(payload):
    body = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
    return type(
        "Response",
        (),
        {"__enter__": lambda self: self, "__exit__": lambda self, *args: False, "read": lambda self: body},
    )()


def cloudflare_error(status, code=None, message="error"):
    errors = [{"code": code, "message": message}] if code is not None else []
    body = json.dumps({"result": None, "success": False, "errors": errors, "messages": []}).encode()
    return HTTPError(RUN_URL, status, "error", {}, io.BytesIO(body))


def raw_error(status, body):
    return HTTPError(RUN_URL, status, "error", {}, io.BytesIO(body.encode()))


def tier_answer(confidence=0.9):
    answers = {"tier": {"type": "choice", "choice": "mechanical", "confidence": confidence}}
    return {"result": {"answers": answers, "usage": {"input_tokens": 400, "output_tokens": 0}}, "success": True}


class CloudflareCase(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        cleared = {name: "" for name in os.environ if name.startswith(("CLOUDFLARE_", "VISTACK_LAYA_", "TYPESAFE_"))}
        self.environment = patch.dict(
            os.environ,
            {**cleared, "CLOUDFLARE_API_TOKEN": TOKEN, "CLOUDFLARE_ACCOUNT_ID": ACCOUNT, "VISTACK_LAYA_CACHE_DIR": self.directory.name},
        )
        self.environment.start()
        self.now = datetime(2026, 10, 5, 20, 0, tzinfo=timezone.utc)
        self.clock = patch("laya.cloudflare._now", new=lambda: self.now)
        self.clock.start()

    def tearDown(self):
        self.clock.stop()
        self.environment.stop()
        self.directory.cleanup()

    def backend(self, **options):
        return CloudflareBackend(api_token=TOKEN, account_id=ACCOUNT, **options)

    def budget(self):
        return NeuronBudget(ACCOUNT, cap=DEFAULT_DAILY_CAP)

    def used(self):
        return self.budget().snapshot()["used"]

    def fail_and_skip(self, error, pattern):
        """The failing call raises; the next call is refused before a request is sent."""

        with patch("laya.system_one.urlopen", side_effect=error):
            with self.assertRaisesRegex(LayaUnavailable, pattern):
                self.backend().predict({}, QUESTION)
        with patch("laya.system_one.urlopen") as call:
            with self.assertRaises(LayaUnavailable) as caught:
                self.backend().predict({}, QUESTION)
        call.assert_not_called()
        return str(caught.exception)

    def sends(self):
        with patch("laya.system_one.urlopen", return_value=response(LIVE_SUCCESS)) as call:
            self.backend().predict({}, QUESTION)
        return call.call_count


class RequestTests(CloudflareCase):
    def test_request_goes_to_the_account_model_with_a_bearer_token(self):
        with patch("laya.system_one.urlopen", return_value=response(LIVE_SUCCESS)) as call:
            result = self.backend().predict({"build": "green"}, QUESTION)
        sent = call.call_args.args[0]
        self.assertEqual((sent.full_url, sent.get_method()), (RUN_URL, "POST"))
        self.assertEqual(sent.headers["Authorization"], f"Bearer {TOKEN}")
        self.assertEqual(json.loads(sent.data), {"model": "clef-flash", "state": {"build": "green"}, "questions": QUESTION})
        self.assertEqual(result["answers"]["pick"]["choice"], "mechanical")
        self.assertEqual(call.call_args.kwargs["timeout"], 5.0)

    def test_top_level_answers_are_accepted(self):
        with patch("laya.system_one.urlopen", return_value=response({"answers": {"green": {"type": "noul", "noul": 0.9}}})):
            result = self.backend().predict({}, QUESTION)
        self.assertEqual(result["answers"]["green"]["noul"], 0.9)

    def test_success_false_on_http_200_is_unavailable(self):
        body = {"result": None, "success": False, "errors": [{"code": 3007, "message": "Request timeout"}]}
        with patch("laya.system_one.urlopen", return_value=response(body)):
            with self.assertRaisesRegex(LayaUnavailable, "3007.*Request timeout"):
                self.backend().predict({}, QUESTION)

    def test_errors_never_name_the_token_or_the_account(self):
        failures = (raw_error(401, LIVE_AUTH_FAILURE), URLError(f"cannot reach {RUN_URL}"), cloudflare_error(500, 9999, f"boom {ACCOUNT}"))
        for failure in failures:
            with self.subTest(failure=type(failure).__name__), patch("laya.system_one.urlopen", side_effect=failure):
                with patch.dict(os.environ, {"VISTACK_LAYA_CACHE_DIR": tempfile.mkdtemp(dir=self.directory.name)}):
                    with self.assertRaises(LayaUnavailable) as caught:
                        self.backend().predict({}, QUESTION)
            self.assertNotIn(TOKEN, str(caught.exception))
            self.assertNotIn(ACCOUNT, str(caught.exception))
        ledgers = list(Path(self.directory.name).rglob("cloudflare-status.json"))
        self.assertEqual(len(ledgers), len(failures))
        for ledger in ledgers:
            self.assertNotIn(ACCOUNT, ledger.read_text())


class LedgerTests(CloudflareCase):
    def test_success_reconciles_the_reservation_to_the_reported_tokens(self):
        self.sends()
        snapshot = self.budget().snapshot()
        self.assertAlmostEqual(snapshot["used"], LIVE_NEURONS, places=4)
        self.assertEqual(snapshot["calls"], 1)

    def test_calls_accumulate(self):
        self.sends()
        self.sends()
        snapshot = self.budget().snapshot()
        self.assertAlmostEqual(snapshot["used"], 2 * LIVE_NEURONS, places=4)
        self.assertEqual(snapshot["calls"], 2)

    def test_a_new_utc_day_resets_the_count(self):
        self.sends()
        self.now = datetime(2026, 10, 6, 0, 0, 1, tzinfo=timezone.utc)
        snapshot = self.budget().snapshot()
        self.assertEqual((snapshot["day"], snapshot["used"], snapshot["calls"]), ("2026-10-06", 0, 0))
        self.sends()
        self.assertAlmostEqual(self.used(), LIVE_NEURONS, places=4)

    def test_the_estimate_covers_the_measured_probe(self):
        body = json.dumps({"state": {"build": "green"}, "model": "clef-flash", "questions": QUESTION}, ensure_ascii=False).encode()
        self.assertEqual(len(body), 135)
        self.assertGreaterEqual(estimate_neurons(body), neurons(146))

    def test_missing_usage_keeps_the_estimate(self):
        with patch("laya.system_one.urlopen", return_value=response({"answers": {"green": {"type": "noul", "noul": 0.9}}})):
            self.backend().predict({}, QUESTION)
        self.assertGreater(self.used(), 0)

    def test_an_unwritable_ledger_sends_nothing(self):
        blocker = Path(self.directory.name) / "not-a-directory"
        blocker.write_text("")
        with patch.dict(os.environ, {"VISTACK_LAYA_CACHE_DIR": str(blocker)}), patch("laya.system_one.urlopen") as call:
            with self.assertRaisesRegex(LayaUnavailable, "Neuron"):
                self.backend().predict({}, QUESTION)
        call.assert_not_called()


class CapTests(CloudflareCase):
    def test_reaching_the_cap_sends_no_request(self):
        self.budget().reserve(DEFAULT_DAILY_CAP - 0.01)
        with patch("laya.system_one.urlopen") as call:
            with self.assertRaisesRegex(LayaUnavailable, r"daily free Neuron cap reached: used 8,999\.99 of 9,000; resets 00:00 UTC in 4\.0h"):
                self.backend().predict({}, QUESTION)
        call.assert_not_called()

    def test_a_cap_outside_the_free_allocation_is_an_unavailable_tier(self):
        for value in ("10001", "0", "-5", "lots"):
            with self.subTest(value=value), patch.dict(os.environ, {"VISTACK_LAYA_CLOUDFLARE_DAILY_NEURONS": value}):
                with patch("laya.system_one.urlopen") as call:
                    engine = DecisionEngine(backend="auto", cloudflare=True)
                    result = engine.decide(SPLIT_FORK)
                call.assert_not_called()
                name, tier = engine.ladder()[0]
                self.assertEqual(name, "cloudflare:clef-flash")
                self.assertIsInstance(tier, _Unavailable)
                self.assertIn("10,000", tier.reason)
                self.assertEqual(result.backend, "deterministic-fallback")

    def test_the_default_cap_leaves_a_margin_below_the_free_allocation(self):
        self.assertEqual((daily_cap(), FREE_NEURONS_PER_DAY), (9000, 10000))
        with patch.dict(os.environ, {"VISTACK_LAYA_CLOUDFLARE_DAILY_NEURONS": "2500"}):
            self.assertEqual(daily_cap(), 2500)
        with patch.dict(os.environ, {"VISTACK_LAYA_CLOUDFLARE_DAILY_NEURONS": "10000"}):
            self.assertEqual(daily_cap(), 10000)


class RefusalTests(CloudflareCase):
    def test_daily_allocation_exceeded_stops_requests_until_utc_midnight(self):
        exceeded = cloudflare_error(429, 3036, "Daily free allocation of 10,000 neurons exceeded")
        reason = self.fail_and_skip(exceeded, "3036")
        self.assertIn("00:00 UTC", reason)
        self.assertEqual(self.used(), 0)
        self.now = datetime(2026, 10, 5, 23, 59, 59, tzinfo=timezone.utc)
        with patch("laya.system_one.urlopen") as call:
            self.assertRaises(LayaUnavailable, self.backend().predict, {}, QUESTION)
        call.assert_not_called()
        self.now = datetime(2026, 10, 6, 0, 0, 1, tzinfo=timezone.utc)
        self.assertEqual(self.sends(), 1)

    def test_auth_and_paid_plan_refusals_cool_down_without_requests(self):
        refusals = (
            (raw_error(401, LIVE_AUTH_FAILURE), "10000.*Authentication error"),
            (cloudflare_error(403, 5035, "This model requires a Workers Paid plan"), "5035.*Workers Paid.*costs money"),
            (cloudflare_error(403, 1234, "Forbidden"), "1234"),
        )
        for error, pattern in refusals:
            with self.subTest(pattern=pattern):
                before = self.used()
                reason = self.fail_and_skip(error, pattern)
                self.assertIn("refused", reason)
                self.assertEqual(self.used(), before)
                self.now += timedelta(seconds=3601)
                self.assertEqual(self.sends(), 1)

    def test_capacity_and_unmarked_rate_limits_do_not_block_the_next_call(self):
        for error in (cloudflare_error(429, 3040, "Capacity temporarily exceeded, please try again"), raw_error(429, "")):
            before = self.used()
            with self.subTest(code=error.code), patch("laya.system_one.urlopen", side_effect=error):
                with self.assertRaises(LayaUnavailable):
                    self.backend().predict({}, QUESTION)
            self.assertEqual(self.used(), before)
            self.assertEqual(self.sends(), 1)


class ReservationTests(CloudflareCase):
    def test_a_call_that_may_have_run_keeps_its_reservation(self):
        for error in (cloudflare_error(500, 9999, "internal"), URLError(TimeoutError("timed out"))):
            with self.subTest(error=type(error).__name__), patch("laya.system_one.urlopen", side_effect=error):
                before = self.used()
                with self.assertRaises(LayaUnavailable):
                    self.backend().predict({}, QUESTION)
                self.assertGreater(self.used(), before)

    def test_an_inference_timeout_keeps_its_reservation(self):
        with patch("laya.system_one.urlopen", side_effect=InferenceTimeout("inference exceeded 5000 ms")):
            with self.assertRaises(InferenceTimeout):
                self.backend().predict({}, QUESTION)
        snapshot = self.budget().snapshot()
        self.assertGreater(snapshot["used"], 0)
        self.assertEqual(snapshot["calls"], 1)

    def test_a_client_error_releases_its_reservation(self):
        with patch("laya.system_one.urlopen", side_effect=cloudflare_error(400, 5007, "No such model")):
            with self.assertRaisesRegex(LayaUnavailable, "5007"):
                self.backend().predict({}, QUESTION)
        snapshot = self.budget().snapshot()
        self.assertEqual((snapshot["used"], snapshot["calls"]), (0, 0))


class EngineTests(CloudflareCase):
    def names(self, **options):
        return [name for name, _ in DecisionEngine(**options).ladder()]

    def test_opted_in_cloudflare_under_the_cap_settles_a_split_fork(self):
        with patch("laya.system_one.urlopen", return_value=response(tier_answer())) as call:
            result = DecisionEngine(backend="auto", cloudflare=True).decide(SPLIT_FORK)
        self.assertEqual((result.backend, result.action, result.fork), ("cloudflare:clef-flash", "mechanical", "sharp"))
        self.assertEqual(call.call_args.args[0].full_url, RUN_URL)
        self.assertLessEqual(len(json.dumps(json.loads(call.call_args.args[0].data)["state"])), 6000)

    def test_the_cap_hands_the_fork_to_ollama_without_a_cloudflare_request(self):
        self.budget().reserve(DEFAULT_DAILY_CAP)
        seen = []

        def route(request, timeout=None):
            seen.append(request.full_url)
            routes = {f"{OLLAMA}/api/ps": {"models": [{"name": "clef-flash:latest"}]}, f"{OLLAMA}/v1/systemone": tier_answer()["result"]}
            return response(routes[request.full_url])

        engine = DecisionEngine(backend="auto", cloudflare=True, ollama_model="clef-flash")
        with patch("laya.system_one.urlopen", side_effect=route):
            result = engine.decide(SPLIT_FORK)
        self.assertEqual([name for name, _ in engine.ladder()], ["cloudflare:clef-flash", "ollama:clef-flash"])
        self.assertEqual((result.backend, result.action, result.fork), ("ollama:clef-flash", "mechanical", "sharp"))
        self.assertIn("daily free Neuron cap reached", result.fallback_reason)
        self.assertFalse([url for url in seen if "cloudflare" in url])

    def test_credentials_alone_do_not_opt_in(self):
        self.assertEqual(self.names(backend="auto"), [])
        self.assertEqual(self.names(backend="auto", ollama_model="clef-flash"), ["ollama:clef-flash"])

    def test_each_opt_in_joins_the_tier(self):
        self.assertEqual(self.names(backend="cloudflare"), ["cloudflare:clef-flash"])
        self.assertEqual(self.names(backend="auto", fallback="cloudflare"), ["cloudflare:clef-flash"])
        with patch.dict(os.environ, {"VISTACK_LAYA_CLOUDFLARE": "1"}):
            self.assertEqual(self.names(backend="auto"), ["cloudflare:clef-flash"])
            self.assertEqual(self.names(backend="auto", cloudflare=False), [])

    def test_cloudflare_sits_between_jev_and_ollama(self):
        self.assertEqual(
            self.names(backend="auto", jev=True, cloudflare=True, ollama_model="clef-flash"), ["jev", "cloudflare:clef-flash", "ollama:clef-flash"]
        )
        self.assertEqual(self.names(backend="ollama", cloudflare=True, ollama_model="clef-flash"), ["ollama:clef-flash", "cloudflare:clef-flash"])

    def test_missing_credentials_name_the_variables(self):
        with patch.dict(os.environ, {"CLOUDFLARE_API_TOKEN": ""}), patch("laya.system_one.urlopen") as call:
            result = DecisionEngine(backend="auto", cloudflare=True).decide(SPLIT_FORK)
        call.assert_not_called()
        self.assertEqual(result.backend, "deterministic-fallback")
        self.assertIn("CLOUDFLARE_API_TOKEN", result.fallback_reason)
        self.assertIn("CLOUDFLARE_ACCOUNT_ID", result.fallback_reason)

    def test_the_tier_declares_its_floor_state_budget_and_timeout(self):
        tier = DecisionEngine(backend="cloudflare").ladder()[0][1]
        self.assertEqual((tier.min_confidence, tier.max_state_chars, tier.timeout_ms), (0.85, 6000, 5000))
        with patch.dict(os.environ, {"VISTACK_LAYA_CLOUDFLARE_TIMEOUT_MS": "7000"}):
            self.assertEqual(DecisionEngine(backend="cloudflare").ladder()[0][1].timeout_ms, 7000)
        with patch.dict(os.environ, {"VISTACK_LAYA_CLOUDFLARE_TIMEOUT_MS": "soon"}):
            self.assertIsInstance(DecisionEngine(backend="cloudflare").ladder()[0][1], _Unavailable)

    def test_the_floor_holds_over_the_global_threshold(self):
        with patch("laya.system_one.urlopen", return_value=response(tier_answer(0.84))):
            result = DecisionEngine(backend="cloudflare", min_confidence=0.65).decide(SPLIT_FORK)
        self.assertEqual((result.action, result.fork), ("complex", "split"))
        self.assertIn("below 0.850", result.fallback_reason)


class CommandTests(CloudflareCase):
    def setUp(self):
        super().setUp()
        self.previous = os.getcwd()
        os.chdir(self.directory.name)
        self.config = str(Path(self.directory.name) / "laya.json")
        self.unreachable = patch("laya.system_one.urlopen", side_effect=URLError(ConnectionRefusedError(61, "refused")))
        self.unreachable.start()

    def tearDown(self):
        self.unreachable.stop()
        os.chdir(self.previous)
        super().tearDown()

    def run_cli(self, *argv):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            cli.main(list(argv))
        self.assertNotIn(TOKEN, output.getvalue())
        self.assertNotIn(ACCOUNT, output.getvalue())
        return json.loads(output.getvalue())

    def test_decisions_on_writes_the_opt_in_and_status_shows_the_budget(self):
        report = self.run_cli("decisions", "on", "--cloudflare", "--ollama-model", "none", "--config", self.config)
        self.assertIs(json.loads(Path(self.config).read_text())["cloudflare"], True)
        self.assertEqual(report["ladder"], ["deterministic", "cloudflare:clef-flash"])
        self.assertEqual(report["obsolete"], {"fields": [], "env": []})
        block = report["cloudflare"]
        self.assertEqual(
            {key: block[key] for key in ("enabled", "token", "account", "model", "min_confidence")},
            {"enabled": True, "token": True, "account": True, "model": "@cf/cloudflare/clef-flash", "min_confidence": 0.85},
        )
        self.assertEqual(
            set(block["budget"]), {"day", "used", "cap", "free_allocation", "remaining", "calls", "resets_at", "exhausted", "refused"}
        )
        self.assertEqual((block["budget"]["cap"], block["budget"]["free_allocation"], block["budget"]["remaining"]), (9000, 10000, 9000))
        self.assertNotIn("hint", block)

    def test_status_hints_at_missing_credentials(self):
        write_enabled(self.config, True, cloudflare=True)
        with patch.dict(os.environ, {"CLOUDFLARE_ACCOUNT_ID": ""}):
            block = self.run_cli("decisions", "status", "--config", self.config)["cloudflare"]
        self.assertEqual((block["token"], block["account"], block["budget"]), (True, False, None))
        self.assertIn("CLOUDFLARE_ACCOUNT_ID", block["hint"])

    def test_status_reports_a_cap_outside_the_free_allocation(self):
        with patch.dict(os.environ, {"VISTACK_LAYA_CLOUDFLARE_DAILY_NEURONS": "20000"}):
            block = self.run_cli("decisions", "status", "--config", self.config)["cloudflare"]
        self.assertIn("10,000", block["hint"])

    def test_probe_calls_cloudflare_only_when_it_is_opted_in(self):
        with patch("laya.system_one.probe_cloudflare", return_value={"ok": True, "latency_ms": 1.0}) as probe:
            report = self.run_cli("decisions", "status", "--probe", "--config", self.config)
            probe.assert_not_called()
            self.assertNotIn("probe", report["cloudflare"])
            write_enabled(self.config, True, cloudflare=True)
            report = self.run_cli("decisions", "status", "--probe", "--config", self.config)
        probe.assert_called_once_with()
        self.assertEqual(report["cloudflare"]["probe"], {"ok": True, "latency_ms": 1.0})

    def test_runtime_option_reaches_the_engine(self):
        args = cli.build_parser().parse_args(["decision", "tier-selection", "--cloudflare", "--config", self.config])
        self.assertEqual([name for name, _ in cli._engine(args).ladder()], ["cloudflare:clef-flash"])
        write_enabled(self.config, True, cloudflare=True)
        args = cli.build_parser().parse_args(["decision", "tier-selection", "--no-cloudflare", "--config", self.config])
        self.assertEqual(cli._engine(args).ladder(), [])

    def test_the_switch_file_keeps_the_choice_and_validates_it(self):
        write_enabled(self.config, True, cloudflare=True)
        write_enabled(self.config, False)
        settings = read_settings(self.config)
        self.assertEqual((settings.enabled, settings.cloudflare, settings.obsolete_fields), (False, True, ()))
        Path(self.config).write_text('{"cloudflare": "yes"}')
        with self.assertRaisesRegex(ValueError, "cloudflare must be boolean"):
            read_settings(self.config)
        Path(self.config).unlink()
        with patch.dict(os.environ, {"VISTACK_LAYA_CLOUDFLARE": "1"}):
            self.assertIs(read_settings(self.config).cloudflare, True)


class ProbeTests(CloudflareCase):
    def test_probe_goes_through_the_budget(self):
        with patch("laya.system_one.urlopen", return_value=response(LIVE_SUCCESS)):
            result = probe_cloudflare()
        self.assertTrue(result["ok"])
        self.assertIn("latency_ms", result)
        self.assertAlmostEqual(self.used(), LIVE_NEURONS, places=4)
        self.budget().reserve(DEFAULT_DAILY_CAP - 1.8)
        with patch("laya.system_one.urlopen") as call:
            result = probe_cloudflare()
        call.assert_not_called()
        self.assertFalse(result["ok"])
        self.assertIn("cap reached", result["reason"])

    def test_probe_without_credentials_names_them(self):
        with patch.dict(os.environ, {"CLOUDFLARE_API_TOKEN": "", "CLOUDFLARE_ACCOUNT_ID": ""}):
            result = probe_cloudflare()
        self.assertFalse(result["ok"])
        self.assertIn("CLOUDFLARE_API_TOKEN", result["reason"])


class EvaluatorTests(CloudflareCase):
    def test_the_evaluator_runs_the_cloudflare_backend(self):
        spec = importlib.util.spec_from_file_location("evaluate_laya", ROOT / "scripts" / "evaluate-laya.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        scenarios = Path(self.directory.name) / "scenarios.jsonl"
        scenarios.write_text(json.dumps({"id": "split", "decision_type": "tier-selection", "context": SPLIT_FORK, "human_action": "mechanical"}))
        output = io.StringIO()
        for argv in (["--backend", "cloudflare"], ["--backend", "auto", "--cloudflare"]):
            with self.subTest(argv=argv), patch("laya.system_one.urlopen", return_value=response(tier_answer())):
                output.seek(0)
                output.truncate()
                with contextlib.redirect_stdout(output):
                    module.main([str(scenarios), *argv])
                self.assertEqual(json.loads(output.getvalue())["scenarios"][0]["assisted_backend"], "cloudflare:clef-flash")


if __name__ == "__main__":
    unittest.main()
