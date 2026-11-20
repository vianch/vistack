"""Command output leaves the machine for a model and a history file, so secrets in it are scrubbed first."""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from laya.engine import DecisionEngine
from laya.schema import OUTPUT_MAX_CHARS, Evidence, scrub_secrets, trim_output

REDACTED = "[REDACTED]"
GITHUB_TOKEN = "ghp_" + "a1B2c3D4e5" * 4
AWS_KEY = "AKIAIOSFODNN7EXAMPLE"
JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV"
PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAxyz\nabcdefg\n-----END RSA PRIVATE KEY-----"
STRIPE_KEY = "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc"
OPENAI_KEY = "sk-" + "proj1234567890abcdefghij"
SLACK_KEY = "xoxb-123456789012-abcdefghijkl"


class SecretShapeTests(unittest.TestCase):
    def assertScrubbed(self, text, secret):
        scrubbed = scrub_secrets(text)
        self.assertNotIn(secret, scrubbed)
        self.assertIn(REDACTED, scrubbed)
        return scrubbed

    def test_a_sensitive_key_blanks_its_value_in_every_spelling(self):
        for text, secret in (
            ("password=hunter2", "hunter2"),
            ("DB_PASSWORD: hunter2", "hunter2"),
            ('{"api_key": "abc123def"}', "abc123def"),
            ("apiKey = abc123def", "abc123def"),
            ("x-api-key: abc123def", "abc123def"),
            ("client_secret='abc123def'", "abc123def"),
            ("GET /v1/items?token=abc123def&page=2", "abc123def"),
            ("auth: abc123def", "abc123def"),
            ("cookie=session-abc123", "session-abc123"),
            ("PRIVATE_KEY=abc123def", "abc123def"),
            ("secret=" + "0123456789abcdef" * 4, "0123456789abcdef"),
        ):
            with self.subTest(text):
                self.assertScrubbed(text, secret)

    def test_the_key_stays_so_the_reader_sees_what_was_blanked(self):
        self.assertEqual(scrub_secrets("password=hunter2 ok"), f"password={REDACTED} ok")
        self.assertEqual(scrub_secrets("page=2&token=abc123def&x=1"), f"page=2&token={REDACTED}&x=1")

    def test_an_authorization_header_blanks_the_scheme_and_the_credential(self):
        for text, secret in (
            ("Authorization: Bearer abcdefghijklmnop1234", "abcdefghijklmnop1234"),
            ("authorization: Basic dXNlcjpwYXNz", "dXNlcjpwYXNz"),
            ("Authorization: Token abc123def", "abc123def"),
            ("curl -H 'Bearer abcdefghijklmnop1234'", "abcdefghijklmnop1234"),
            ("sent Basic dXNlcjpwYXNzd29yZDEyMw==", "dXNlcjpwYXNzd29yZDEyMw"),
        ):
            with self.subTest(text):
                scrubbed = self.assertScrubbed(text, secret)
                self.assertNotIn("Bearer abc", scrubbed)

    def test_provider_token_shapes(self):
        for name, secret in (
            ("aws", AWS_KEY),
            ("github", GITHUB_TOKEN),
            ("github-pat", "github_pat_" + "11ABCDEFG0abcdefghij_klmnop"),
            ("stripe-live", STRIPE_KEY),
            ("stripe-publishable", "pk_live_" + "4eC39HqLyjWDarjtT1zdp7dc"),
            ("openai", OPENAI_KEY),
            ("slack", SLACK_KEY),
            ("jwt", JWT),
        ):
            with self.subTest(name):
                scrubbed = self.assertScrubbed(f"in the log: {secret} was sent", secret)
                self.assertEqual(scrubbed, f"in the log: {REDACTED} was sent")

    def test_a_pem_private_key_block_goes_whole(self):
        scrubbed = scrub_secrets(f"before\n{PEM}\nafter")
        self.assertEqual(scrubbed, f"before\n{REDACTED}\nafter")

    def test_a_pem_block_cut_off_by_the_end_of_the_text_still_goes(self):
        scrubbed = scrub_secrets("start\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC")
        self.assertEqual(scrubbed, f"start\n{REDACTED}")

    def test_url_credentials_go_and_the_host_stays(self):
        scrubbed = scrub_secrets("clone postgres://admin:s3cr3t@db.internal:5432/orders failed")
        self.assertEqual(scrubbed, f"clone postgres://{REDACTED}@db.internal:5432/orders failed")

    def test_scrubbing_twice_changes_nothing(self):
        once = scrub_secrets(f"password=hunter2 {AWS_KEY} Authorization: Bearer abcdefghijklmnop1234")
        self.assertEqual(scrub_secrets(once), once)


class OrdinaryOutputTests(unittest.TestCase):
    def test_ordinary_test_output_is_untouched(self):
        for text in (
            "AssertionError: expected 3 got 4",
            "E       AssertionError: assert 2 == 1",
            "tests/auth.test.ts:41: Error",
            "tests/test_auth.py::test_login FAILED",
            "FAIL src/auth/session.test.ts",
            "token-guard check passed",
            "author: Victor",
            "Authentication failed for user",
            "Basic Authentication is documented in the guide",
            "a bearer of bad news",
            "Error: expected token to be valid",
            "https://example.com/docs/auth?page=2",
            "http://localhost:8080/health",
            "git@github.com:org/repo.git",
            "task-2025-11-20-checkout-flow-redesign",
            "risk-assessment-for-the-checkout-flow-redesign",
            "Tests:       1 failed, 3 passed, 4 total",
        ):
            with self.subTest(text):
                self.assertEqual(scrub_secrets(text), text)

    def test_a_long_hex_string_with_no_sensitive_key_stays(self):
        for text in (
            "at Object.<anonymous> (src/cart.ts:12) commit 0123456789abcdef0123456789abcdef01234567",
            "sha256: " + "0123456789abcdef" * 4,
            "checksum=" + "0123456789abcdef" * 4,
        ):
            with self.subTest(text):
                self.assertEqual(scrub_secrets(text), text)

    def test_a_key_word_without_an_assignment_stays(self):
        self.assertEqual(scrub_secrets("test_password_is_hashed PASSED"), "test_password_is_hashed PASSED")
        self.assertEqual(scrub_secrets("password:\nnext line"), "password:\nnext line")


class HealthCheckScrubTests(unittest.TestCase):
    def test_a_value_on_the_line_after_its_key_is_blanked(self):
        for text in ("password:\nhunter2-long-secret-value", "DB_PASSWORD=\n  hunter2-long-secret-value\nnext line"):
            with self.subTest(text):
                scrubbed = scrub_secrets(text)
                self.assertNotIn("hunter2", scrubbed)
                self.assertIn(REDACTED, scrubbed)

    def test_json_with_escaped_quotes_leaves_no_secret_and_no_tail(self):
        for text in (
            '{"token\\": \\"abcdef0123456789xyz\\"}',
            '{\\"token\\": \\"abcdef0123456789xyz\\"}',
            '{"token": "abc\\"def0123456789xyz"}',
            "{'token': 'abc\\'def0123456789xyz'}",
            '{\\"token\\": \\"abcdef0123456789xyz\nnext line',
            '{\\"token\\": \\"abc\\\\\\"def0123456789xyz\\"}',
        ):
            with self.subTest(text):
                scrubbed = scrub_secrets(text)
                self.assertNotIn("0123456789xyz", scrubbed)
                self.assertNotIn("abc", scrubbed)
                self.assertIn(REDACTED, scrubbed)
                self.assertEqual(scrub_secrets(scrubbed), scrubbed)

    def test_a_count_or_a_plain_phrase_after_a_key_stays(self):
        for text in (
            "tokens: 0 failures, 12 passed",
            "auth: 0 failed; 14 passed",
            "secret: 2 checks failed",
            "password: required field missing (3 fields)",
        ):
            with self.subTest(text):
                self.assertEqual(scrub_secrets(text), text)

    def test_a_secret_shaped_value_beside_a_phrase_still_goes(self):
        for text, secret in (("password: hunter2 was rejected", "hunter2"), ("token: 12345678 checks", "12345678")):
            with self.subTest(text):
                self.assertNotIn(secret, scrub_secrets(text))


class TrimmedOutputTests(unittest.TestCase):
    def test_the_scrub_runs_before_the_trim(self):
        text = "noise\n" * 600 + f"token={'z' * 40}\n" + "tail line\n" * 3
        output = trim_output(text)
        self.assertNotIn("zzzz", output)
        self.assertLessEqual(len(output), OUTPUT_MAX_CHARS)

    def test_a_secret_straddling_the_trim_boundary_leaves_no_fragment(self):
        secret = GITHUB_TOKEN
        tail = "y" * (OUTPUT_MAX_CHARS - 40 - len("...[earlier output trimmed]\n"))
        text = "head " + secret + " " + tail
        cut = len(text) - (OUTPUT_MAX_CHARS - len("...[earlier output trimmed]\n"))
        self.assertTrue(text.index(secret) < cut < text.index(secret) + len(secret), "the cut must fall inside the secret")
        output = trim_output(text)
        self.assertNotIn(secret[-12:], output)
        self.assertNotIn("a1B2c3D4e5", output)

    def test_a_pem_block_longer_than_the_limit_is_scrubbed_before_any_slice(self):
        body = "\n".join("MIIEowIBAAKCAQEA" + str(index) * 20 for index in range(200))
        text = f"-----BEGIN PRIVATE KEY-----\n{body}\n-----END PRIVATE KEY-----\n3 passed"
        self.assertEqual(trim_output(text), f"{REDACTED}\n3 passed")

    def test_every_parse_path_scrubs_through_evidence(self):
        item = Evidence.from_value({"kind": "command", "ref": "npm test", "output": f"password=hunter2\n{AWS_KEY}\n1 passed"})
        self.assertEqual(item.output, f"password={REDACTED}\n{REDACTED}\n1 passed")


class HistoryTests(unittest.TestCase):
    def test_history_rows_written_through_the_engine_carry_no_planted_secret(self):
        planted = (GITHUB_TOKEN, AWS_KEY, JWT, STRIPE_KEY, "hunter2", "s3cr3t", "MIIEowIBAAKCAQEAxyz")
        output = (
            f"Authorization: Bearer {JWT}\npassword=hunter2\n{GITHUB_TOKEN}\n{AWS_KEY}\n{STRIPE_KEY}\n"
            f"connect postgres://admin:s3cr3t@db:5432/x\n{PEM}\nE   AssertionError: assert 2 == 1\n1 failed in 0.2s"
        )
        context = {
            "decision_type": "verification",
            "task": {"request": "Verify the change", "acceptance_criteria": ["a refund writes one ledger row"]},
            "evidence": [{"kind": "command", "ref": "pytest -q", "criterion": "1", "output": output}],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "decisions.jsonl"
            DecisionEngine(backend="deterministic", history_path=str(path)).decide(context)
            rows = path.read_text(encoding="utf-8")
        self.assertTrue(rows.strip())
        for secret in planted:
            self.assertNotIn(secret, rows)
        stored = json.loads(rows.splitlines()[0])["context"]["evidence"][0]["output"]
        self.assertIn("AssertionError: assert 2 == 1", stored)
        self.assertIn(REDACTED, stored)


if __name__ == "__main__":
    unittest.main()
