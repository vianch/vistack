import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseLedger, render } from "./run-report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "run-report.mjs");
const baseHtml = readFileSync(resolve(here, "../assets/base.html"), "utf8");
const stateDirectory = resolve(here, "../../../.claude/state");
const scratch = mkdtempSync(join(tmpdir(), "run-report-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const now = "2026-10-01T12:00:00Z";

const inlineState = JSON.stringify({
  slug: "inline-fixture",
  playbook: "feature",
  host: "claude-code",
  finish_condition: "suite green",
  unchanged: "public API",
  slices: {
    api: { agent: "senior-implementer", phase: "pr-open", pr: "https://example.com/pull/7", blockers: [] },
    docs: { role: "implementer", status: "planned" },
  },
});
const inlineLedger = [
  "2026-09-02T14:22:01Z\tplanned\t—\tplaybook-matched\tticket groomed\thttps://example.com/issues/1\tok",
  "2026-09-02T14:25:02Z\tdispatched\tapi\tdispatched\twave 1\t.claude/worktrees/x-api\tok",
  "",
  "2026-09-02T15:03:44Z\timplementing\tapi\tattempt\tvalue not forwarded\tProgressBar.tsx:34\tfailed",
].join("\n");

const write = (name, content) => {
  const path = join(scratch, name);
  writeFileSync(path, content);
  return path;
};

const fixturePairs = () => {
  const names = ["decisions-ollama", "laya-optimize"];
  const real = names
    .map((name) => ({ name, state: join(stateDirectory, `${name}.json`), ledger: join(stateDirectory, `${name}.tsv`) }))
    .filter((pair) => existsSync(pair.state) && existsSync(pair.ledger));
  if (real.length > 0) {
    return real;
  }
  return [{ name: "inline-fixture", state: write("inline.json", inlineState), ledger: write("inline.tsv", inlineLedger) }];
};

const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

const externalLoads = [
  /<script\b[^>]*\bsrc\s*=/i,
  /<link\b/i,
  /<(?:img|iframe|object|embed|audio|video|source)\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//i,
  /url\(\s*["']?(?:https?:)?\/\//i,
  /@import/i,
];

describe("run-report", () => {
  for (const pair of fixturePairs()) {
    test(`renders the ${pair.name} run pair`, () => {
      const result = run(["--state", pair.state, "--ledger", pair.ledger, "--now", now]);
      assert.equal(result.status, 0, result.stderr);
      const state = JSON.parse(readFileSync(pair.state, "utf8"));
      assert.match(result.stdout, new RegExp(state.slug));
      for (const name of Object.keys(state.slices ?? {})) {
        assert.ok(result.stdout.includes(name), `slice ${name} is missing`);
      }
      const rows = parseLedger(readFileSync(pair.ledger, "utf8"));
      assert.equal((result.stdout.match(/<li data-filter-item/g) ?? []).length, rows.length);
      for (const pattern of externalLoads) {
        assert.doesNotMatch(result.stdout, pattern);
      }
    });
  }

  test("the template is a full local document with its title in the first 8 KB", () => {
    const [doctype, charset, viewport] = baseHtml.split("\n");
    assert.equal(doctype, "<!doctype html>");
    assert.equal(charset, '<meta charset="utf-8">');
    assert.equal(viewport, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
    const title = baseHtml.indexOf("<title>");
    assert.ok(title > 0 && title < 8192);
  });

  test("the run report takes only the template's style and script, so the head is not doubled", () => {
    const output = render({ stateText: inlineState, ledgerText: inlineLedger, baseHtml, now });
    assert.equal((output.match(/<!doctype/gi) ?? []).length, 1);
    assert.equal((output.match(/<meta charset/gi) ?? []).length, 1);
    assert.equal((output.match(/<title>/g) ?? []).length, 1);
  });

  test("the shared stylesheet and script make no external loads", () => {
    for (const pattern of externalLoads) {
      assert.doesNotMatch(baseHtml, pattern);
    }
  });

  test("escapes markup inside ledger cells and state values", () => {
    const hostile = '<script>alert("x")</script>';
    const output = render({
      stateText: JSON.stringify({ slug: "esc", objective: hostile, slices: { [hostile]: { phase: hostile } } }),
      ledgerText: `2026-09-02T14:22:01Z\tplanned\t—\tnote\t${hostile}\t${hostile}\tok`,
      baseHtml,
      now,
    });
    assert.ok(!output.includes(hostile));
    assert.ok(output.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
    assert.equal((output.match(/<script\b/gi) ?? []).length, 1);
  });

  test("renders evidence URLs as links and paths as code", () => {
    const output = render({ stateText: inlineState, ledgerText: inlineLedger, baseHtml, now });
    assert.match(output, /<a href="https:\/\/example\.com\/issues\/1" rel="noopener" target="_blank">/);
    assert.match(output, /<code>ProgressBar\.tsx:34<\/code>/);
  });

  test("artifact output is a fragment that starts with its title", () => {
    const pair = fixturePairs()[0];
    const result = run(["--state", pair.state, "--ledger", pair.ledger, "--now", now, "--artifact"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.startsWith("<title>"));
    assert.doesNotMatch(result.stdout, /<!doctype|<(?:html|head|body)[\s>]/i);
  });

  test("local output is a full document with charset and viewport-fit", () => {
    const output = render({ stateText: inlineState, ledgerText: inlineLedger, baseHtml, now });
    assert.match(output, /^<!doctype html>/i);
    assert.match(output, /<meta charset="utf-8">/);
    assert.match(output, /<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*">/);
  });

  test("tolerates empty or missing slices, blank lines, and short or long rows", () => {
    const ledgerText = "\n2026-09-02T14:22:01Z\tplanned\n\n2026-09-02T14:23:01Z\tqa\ts\tx\ty\tz\tok\textra\n";
    for (const stateText of ['{"slug":"empty","slices":{}}', '{"slug":"none"}', '{"slices":[]}']) {
      const output = render({ stateText, ledgerText, baseHtml, now });
      assert.match(output, /No slices recorded/);
    }
    const rows = parseLedger(ledgerText);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].decision, "—");
    assert.equal(rows[0].result, "—");
    assert.equal(rows[1].result, "ok extra");
  });

  test("the same inputs and --now give byte-identical output", () => {
    const pair = fixturePairs()[0];
    const args = ["--state", pair.state, "--ledger", pair.ledger, "--now", now];
    const first = execFileSync(process.execPath, [script, ...args]);
    const second = execFileSync(process.execPath, [script, ...args]);
    assert.ok(first.equals(second));
  });

  test("writes to --out, creating the directory", () => {
    const pair = fixturePairs()[0];
    const out = join(scratch, "reports", "nested", "run.html");
    const result = run(["--state", pair.state, "--ledger", pair.ledger, "--now", now, "--out", out]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(readFileSync(out, "utf8").startsWith("<!doctype html>"));
  });

  test("unreadable input exits non-zero with one line", () => {
    const missing = run(["--state", join(scratch, "absent.json"), "--ledger", join(scratch, "absent.tsv")]);
    assert.notEqual(missing.status, 0);
    assert.equal(missing.stderr.trim().split("\n").length, 1);
    const invalid = run(["--state", write("bad.json", "{nope"), "--ledger", write("ok.tsv", inlineLedger)]);
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stderr.trim().split("\n").length, 1);
    const badNow = run(["--state", write("ok.json", inlineState), "--ledger", write("ok2.tsv", inlineLedger), "--now", "yesterday"]);
    assert.notEqual(badNow.status, 0);
  });
});
