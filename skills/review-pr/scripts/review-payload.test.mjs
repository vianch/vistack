import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { rightSideLines } from "./diff-lines.mjs";
import { postReview, PostReviewError } from "./post-review.mjs";
import { buildReview, fence, validateFindings } from "./review-payload.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "post-review.mjs");
const scratch = mkdtempSync(join(tmpdir(), "review-payload-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const head = "c".repeat(40);
const prUrl = "https://github.com/acme/web/pull/42";
const meta = { url: prUrl, headRefOid: head, number: 42 };
const reviewUrl = `${prUrl}#pullrequestreview-9`;

const diff = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -10,4 +10,5 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " const d = 5;",
  "@@ -40,2 +41,2 @@",
  " keep();",
  "-drop();",
  "+add();",
  "",
].join("\n");

const comment = (overrides = {}) => ({
  path: "src/app.ts",
  line: 11,
  severity: "bug",
  evidence: "save() rejects 3 at store.ts:20",
  body: "this breaks save() when b is 3.",
  ...overrides,
});

const findings = (comments) => ({ body: "A couple of notes.", comments });

const build = (comments, options = {}) =>
  buildReview({ findings: validateFindings(findings(comments)), diffLines: rightSideLines(diff), headSha: head, ...options });

const invalid = (pattern) => (error) => {
  assert.ok(error instanceof PostReviewError);
  assert.equal(error.code, 1);
  assert.match(error.message, pattern);
  return true;
};

describe("start_line and suggestion validation", () => {
  for (const startLine of [0, "10", 11, 12, 1.5]) {
    test(`start_line ${JSON.stringify(startLine)} on line 11 is rejected`, () => {
      assert.throws(() => validateFindings(findings([comment({ start_line: startLine })])), invalid(/start_line/));
    });
  }

  test("a start_side other than RIGHT and a non-string suggestion are rejected", () => {
    assert.throws(() => validateFindings(findings([comment({ start_line: 10, start_side: "LEFT" })])), invalid(/start_side/));
    assert.throws(() => validateFindings(findings([comment({ suggestion: 3 })])), invalid(/suggestion/));
  });

  test("a range below line and an empty suggestion are accepted", () => {
    assert.equal(validateFindings(findings([comment({ start_line: 10, suggestion: "" })])).comments.length, 1);
  });
});

describe("ranges", () => {
  test("a range fully inside the diff posts inline with start_line and start_side", () => {
    const { payload, folded } = build([comment({ start_line: 11, line: 13 })]);
    assert.equal(folded.length, 0);
    assert.deepEqual(payload.comments, [
      { path: "src/app.ts", start_line: 11, start_side: "RIGHT", line: 13, side: "RIGHT", body: comment().body },
    ]);
  });

  test("a range touching a line outside the diff folds into the body with its range label", () => {
    const { payload, inline } = build([comment({ start_line: 12, line: 41 })]);
    assert.equal(inline.length, 0);
    assert.equal(payload.comments.length, 0);
    assert.match(payload.body, /Outside the diff:\n- `src\/app\.ts:12-41`: this breaks save\(\)/);
  });
});

describe("suggestions", () => {
  test("an inline suggestion follows the body in a suggestion fence", () => {
    const { payload } = build([comment({ suggestion: "const b = 2;" })]);
    assert.equal(payload.comments[0].body, "this breaks save() when b is 3.\n\n```suggestion\nconst b = 2;\n```");
  });

  test("the fence outgrows the longest backtick run in the suggestion", () => {
    assert.equal(fence("suggestion", "const s = ```x```;"), "````suggestion\nconst s = ```x```;\n````");
    assert.equal(fence("suggestion", "a `````b"), "``````suggestion\na `````b\n``````");
    assert.equal(fence("suggestion", "keep\n"), "```suggestion\nkeep\n```");
  });

  test("an empty suggestion is an empty fence, which deletes the anchored lines", () => {
    const { payload } = build([comment({ start_line: 11, line: 12, suggestion: "" })]);
    assert.equal(payload.comments[0].body, "this breaks save() when b is 3.\n\n```suggestion\n```");
  });

  test("a folded suggestion is a plain fence indented under its item", () => {
    const { payload } = build([comment({ path: "src/other.ts", line: 3, suggestion: "const z = 1;\nconst y = 2;" })]);
    assert.match(payload.body, /- `src\/other\.ts:3`: this breaks save\(\) when b is 3\.\n\n {2}```\n {2}const z = 1;\n {2}const y = 2;\n {2}```$/);
    assert.doesNotMatch(payload.body, /suggestion/);
  });
});

const fakeGh = (responses) => {
  const calls = [];
  const gh = (args, input) => {
    calls.push({ args, input });
    const valued = new Set(["--hostname", "--method", "--input"]);
    const rest = [];
    for (let index = 1; index < args.length; index += 1) {
      if (valued.has(args[index])) index += 1;
      else rest.push(args[index]);
    }
    const key = `${args.includes("POST") ? "POST " : ""}${rest.join(" ")}`;
    const response = responses[key];
    if (response === undefined) return { status: 1, stdout: "", stderr: `no fake for ${key}` };
    return { status: 0, stdout: JSON.stringify(response), stderr: "" };
  };
  return { gh, calls };
};

const suggested = comment({ suggestion: "const b = 2;" });
const postedBody = "this breaks save() when b is 3.\n\n```suggestion\nconst b = 2;\n```";

const responses = ({ reviews = [], state = "PENDING" } = {}) => ({
  user: { login: "operator" },
  "repos/acme/web/pulls/42": { head: { sha: head }, user: { login: "someone" }, state: "open" },
  "repos/acme/web/pulls/42/reviews?per_page=100": reviews,
  "POST repos/acme/web/pulls/42/reviews": { id: 9, state, html_url: reviewUrl },
  "repos/acme/web/pulls/42/reviews/9/comments?per_page=100": [
    { path: "src/app.ts", line: 11, body: postedBody, html_url: `${prUrl}#discussion_r9` },
  ],
});

const pendingPost = (answers) => {
  const fake = fakeGh(answers);
  const run = () =>
    postReview({ meta, diffText: diff, findings: findings([suggested]), realms: ["github.com/acme"], dryRun: false, pending: true, gh: fake.gh });
  return { fake, run };
};

describe("pending reviews", () => {
  test("the pending payload carries no event and the report says how to submit it", () => {
    const { fake, run } = pendingPost(responses());
    const result = run();
    const sent = JSON.parse(fake.calls.find((call) => call.args.includes("POST")).input);
    assert.equal("event" in sent, false);
    assert.equal(result.posted, true);
    assert.equal(result.lines[0], `review: ${reviewUrl} (pending: submit it from the PR's Files changed tab)`);
    assert.equal(result.lines[1], `src/app.ts:11 — this breaks save() when b is 3. — ${prUrl}#discussion_r9`);
  });

  test("a pending review the operator already holds is refused and nothing posts", () => {
    const open = { id: 4, user: { login: "Operator" }, commit_id: head, state: "PENDING", body: "", html_url: `${prUrl}#pullrequestreview-4` };
    const { fake, run } = pendingPost(responses({ reviews: [open] }));
    assert.throws(run, (error) => {
      assert.equal(error.code, 2);
      assert.match(error.message, /pullrequestreview-4; submit or discard it first/);
      return true;
    });
    assert.equal(fake.calls.some((call) => call.args.includes("POST")), false);
  });

  test("a state other than PENDING is noted", () => {
    const { run } = pendingPost(responses({ state: "COMMENTED" }));
    assert.match(run().lines[0], /\(state is COMMENTED, expected PENDING\)$/);
  });
});

describe("command line", () => {
  const write = (name, content) => {
    const path = join(scratch, name);
    writeFileSync(path, JSON.stringify(content));
    return path;
  };
  const bin = mkdtempSync(join(scratch, "bin-"));
  const marker = join(scratch, "gh-was-called");
  writeFileSync(join(bin, "gh"), `#!/bin/sh\n: > "${marker}"\nexit 1\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const cli = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, PATH: bin } });

  test("post --pending --dry-run prints a payload with no event, labels the range, and calls no gh", () => {
    const diffPath = join(scratch, "pr.diff");
    writeFileSync(diffPath, diff);
    const ranged = findings([comment({ start_line: 11, line: 13, suggestion: "const b = 2;" })]);
    const args = ["post", "--meta", write("meta.json", meta), "--diff", diffPath, "--findings", write("findings.json", ranged)];
    const result = cli([...args, "--realm", "github.com/acme", "--pending", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
    assert.doesNotMatch(result.stdout, /"event"/);
    assert.match(result.stdout, /"start_line": 11/);
    assert.match(result.stdout, /src\/app\.ts:11-13 — this breaks save\(\) when b is 3\. — inline/);
  });

  test("--pending on reply is bad input", () => {
    const result = cli(["reply", "--pr", prUrl, "--comment", "1", "--kind", "review", "--body-file", "x", "--realm", "github.com/acme", "--pending"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--pending applies to post only/);
  });
});
