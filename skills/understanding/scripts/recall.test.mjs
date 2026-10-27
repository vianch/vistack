import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildHome, project } from "./recall.fixture.mjs";
import { collapse, parseArgs, redact, REDACTIONS, snippet, UsageError, usage } from "./recall.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "recall.mjs");
let home;

before(async () => {
  ({ home } = await buildHome());
});
after(() => rmSync(home, { recursive: true, force: true }));

const run = (...args) => spawnSync(process.execPath, [script, ...args, "--home", home, "--project", project], { encoding: "utf8" });

describe("redact", () => {
  const samples = {
    "private-key": "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----",
    "anthropic-key": "sk-ant-api03-abcdefgh12345",
    "api-key": "sk-proj-abcdefghijklmnop1234",
    "github-token": "ghp_abcdefghijklmnopqrstuvwxyz0123",
    "slack-token": "xoxb-1234567890-abcdef",
    "aws-key": "AKIAABCDEFGHIJKLMNOP",
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
    email: "ops@example.com",
  };

  test("every pattern kind has a sample", () => {
    const covered = new Set([...Object.keys(samples), "credential"]);
    assert.deepEqual(REDACTIONS.map(([kind]) => kind).filter((kind) => !covered.has(kind)), []);
  });

  for (const [kind, secret] of Object.entries(samples)) {
    test(`replaces ${kind}`, () => {
      const result = redact(`before ${secret} after`);
      assert.match(result, new RegExp(`\\[REDACTED:${kind}\\]`));
      assert.ok(!result.includes(secret));
    });
  }

  test("keeps a credential's key and redacts its value, Bearer included", () => {
    assert.equal(redact("password=hunter2 next"), "password=[REDACTED:credential] next");
    assert.equal(redact('api_key: "abc123"'), 'api_key: "[REDACTED:credential]"');
    assert.equal(redact("token: Bearer abc.def"), "token: [REDACTED:credential]");
    assert.equal(redact("max_tokens: 100"), "max_tokens: 100");
  });

  test("leaves the other github token prefixes no way through", () => {
    for (const prefix of ["gho_", "ghs_", "github_pat_"]) {
      assert.match(redact(`${prefix}abcdefghijklmnopqrstuvwxyz0123`), /\[REDACTED:github-token\]/);
    }
  });
});

describe("snippet", () => {
  test("collapses whitespace and keeps short text whole", () => {
    assert.equal(collapse(" a \n\n b\t c "), "a b c");
    assert.equal(snippet("short\n text", ["text"]), "short text");
  });

  test("centres a long text on the first match and marks both cuts", () => {
    const text = `${"x ".repeat(400)}needle here ${"y ".repeat(400)}`;
    const result = snippet(text, ["needle"]);
    assert.ok(result.startsWith("…") && result.endsWith("…"));
    assert.ok(result.includes("needle here"));
    assert.ok(result.length <= 302);
  });

  test("redacts before cutting, so a secret is never half shown", () => {
    const text = `${"a ".repeat(140)}ghp_abcdefghijklmnopqrstuvwxyz0123 ${"b ".repeat(300)}`;
    assert.ok(!snippet(text, ["ghp_"]).includes("ghp_abc"));
  });
});

describe("parseArgs", () => {
  test("defaults", () => {
    const options = parseArgs(["search", "Postgres"], "/work/app");
    assert.deepEqual(
      { ...options, home: undefined },
      { command: "search", terms: ["Postgres"], project: "/work/app", allProjects: false, hosts: ["claude", "codex", "grok", "opencode"], since: null, limit: 20, json: false, home: undefined },
    );
  });

  test("reads every flag", () => {
    const options = parseArgs(["sessions", "--project", "sub", "--all-projects", "--host", "codex", "--since", "2026-01-03", "--limit", "5", "--json", "--home", "/h"], "/work");
    assert.equal(options.project, "/work/sub");
    assert.deepEqual(options.hosts, ["codex"]);
    assert.equal(options.since.toISOString(), "2026-01-03T00:00:00.000Z");
    assert.deepEqual([options.allProjects, options.limit, options.json, options.home], [true, 5, true, "/h"]);
  });

  for (const argv of [[], ["find"], ["search"], ["sessions", "extra"], ["search", "x", "--host", "vim"], ["search", "x", "--since", "01/02/2026"], ["search", "x", "--limit", "0"], ["search", "x", "--limit"], ["search", "x", "--bogus"]]) {
    test(`rejects ${JSON.stringify(argv)}`, () => {
      assert.throws(() => parseArgs(argv, "/work"), UsageError);
    });
  }
});

describe("command line", () => {
  test("exit 0 with one line and a file line per result", () => {
    const result = run("search", "postgres", "--host", "codex");
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trimEnd().split("\n");
    assert.match(lines[0], /^2026-01-02T09:02:00\.000Z codex codex-se assistant: Because postgres handles concurrent writers\. Ask \[REDACTED:email\]$/);
    assert.match(lines[1], /^ {2}\/.*rollout-2026-01-02T09-00-00-codex-1\.jsonl$/);
  });

  test("--json prints the result objects", () => {
    const result = run("search", "ledger", "--json", "--host", "claude");
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed[0]), ["timestamp", "host", "session", "role", "snippet", "file"]);
    assert.match(parsed[0].snippet, /token=\[REDACTED:credential\]/);
  });

  test("exit 1 when nothing matched", () => {
    const result = run("search", "zzz-no-such-term");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /nothing matched/);
  });

  test("exit 2 with the usage on a usage error", () => {
    const result = run("search");
    assert.equal(result.status, 2);
    assert.ok(result.stderr.includes(usage));
  });

  test("--help prints the usage with the exit codes", () => {
    const result = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /exit: 0 printed at least one result; 1 nothing matched; 2 usage error/);
  });
});
