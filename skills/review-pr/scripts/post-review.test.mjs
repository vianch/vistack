import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildReview,
  checkRealm,
  findExistingReview,
  firstSentence,
  matchCommentUrls,
  parsePrRef,
  parseRemote,
  postReview,
  PostReviewError,
  rightSideLines,
  validateFindings,
} from "./post-review.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "post-review.mjs");
const scratch = mkdtempSync(join(tmpdir(), "post-review-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const head = "a".repeat(40);
const movedHead = "b".repeat(40);
const prUrl = "https://github.com/acme/web/pull/42";
const meta = { url: prUrl, headRefOid: head, author: { login: "someone" }, number: 42 };

const diff = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -10,4 +10,5 @@ export const start = () => {",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " const d = 5;",
  "",
  "@@ -40,2 +41,2 @@",
  " keep();",
  "-drop();",
  "+++ b/not-a-header",
  "diff --git a/new.md b/new.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/new.md",
  "@@ -0,0 +1,2 @@",
  "+# Title",
  "+body",
  "\\ No newline at end of file",
  "diff --git a/gone.ts b/gone.ts",
  "deleted file mode 100644",
  "--- a/gone.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-one",
  "-two",
  "diff --git a/docs/with space.md b/docs/with space.md",
  "--- a/docs/with space.md\t",
  "+++ b/docs/with space.md\t",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
  '--- "a/caf\\303\\251.txt"',
  '+++ "b/caf\\303\\251.txt"',
  "@@ -3 +3 @@",
  "-x",
  "+y",
  "diff --git a/logo.png b/logo.png",
  "Binary files a/logo.png and b/logo.png differ",
  "",
].join("\n");

const comment = (overrides = {}) => ({
  path: "src/app.ts",
  line: 11,
  severity: "bug",
  evidence: "start() passes b to save(), which rejects 3",
  body: "this breaks save() when b is 3. Let's keep 2 here?",
  ...overrides,
});

const findings = (overrides = {}) => ({
  body: "Left a couple of notes on the save path.",
  comments: [comment()],
  ...overrides,
});

const refusal = (code, pattern) => (error) => {
  assert.ok(error instanceof PostReviewError, `expected PostReviewError, got ${error}`);
  assert.equal(error.code, code);
  assert.match(error.message, pattern);
  return true;
};

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
    const key = rest.join(" ");
    const method = args.includes("POST") ? "POST " : "";
    const response = responses[`${method}${key}`];
    if (response === undefined) return { status: 1, stdout: "", stderr: `no fake for ${method}${key}` };
    if (response instanceof Error) return { status: 1, stdout: "", stderr: response.message };
    return { status: 0, stdout: JSON.stringify(response), stderr: "" };
  };
  return { gh, calls };
};

const happyResponses = (extra = {}) => ({
  user: { login: "operator" },
  "repos/acme/web/pulls/42": { head: { sha: head }, user: { login: "someone" }, state: "open" },
  "repos/acme/web/pulls/42/reviews?per_page=100": [],
  "POST repos/acme/web/pulls/42/reviews": {
    id: 7,
    state: "COMMENTED",
    html_url: "https://github.com/acme/web/pull/42#pullrequestreview-7",
  },
  "repos/acme/web/pulls/42/reviews/7/comments?per_page=100": [
    { path: "src/app.ts", line: 11, body: comment().body, html_url: "https://github.com/acme/web/pull/42#discussion_r1" },
  ],
  ...extra,
});

describe("event boundary", () => {
  test("the payload is always a COMMENT review pinned to the head", () => {
    const { payload } = buildReview({ findings: validateFindings(findings()), diffLines: rightSideLines(diff), headSha: head });
    assert.equal(payload.event, "COMMENT");
    assert.equal(payload.commit_id, head);
  });

  for (const event of ["APPROVE", "REQUEST_CHANGES", "approve", "PENDING", ""]) {
    test(`a findings file asking for event ${JSON.stringify(event)} is refused, not rewritten`, () => {
      assert.throws(() => validateFindings(findings({ event })), refusal(2, /COMMENT/));
    });
  }

  test("event COMMENT in the findings file is accepted in any case", () => {
    assert.equal(validateFindings(findings({ event: "comment" })).comments.length, 1);
  });
});

describe("realm", () => {
  const pr = parsePrRef(prUrl);

  test("an owner outside the realm is refused", () => {
    assert.throws(() => checkRealm(pr, ["github.com/other"]), refusal(2, /outside the realm/));
  });

  test("a matching owner on another host is refused", () => {
    assert.throws(() => checkRealm(pr, ["ghe.example.com/acme"]), refusal(2, /outside the realm/));
  });

  test("no realm at all is refused", () => {
    assert.throws(() => checkRealm(pr, []), refusal(2, /realm/));
  });

  test("owner and host compare case-insensitively, a bare owner means github.com, and any listed realm passes", () => {
    assert.equal(checkRealm(pr, ["GitHub.com/ACME"]), true);
    assert.equal(checkRealm(pr, ["acme"]), true);
    assert.equal(checkRealm(pr, ["github.com/other", "github.com/acme"]), true);
  });
});

describe("parsePrRef", () => {
  test("reads URLs, bare hosts, extra path segments, and owner/repo#n", () => {
    assert.deepEqual(parsePrRef(prUrl), { host: "github.com", owner: "acme", repo: "web", number: 42 });
    assert.deepEqual(parsePrRef("github.com/acme/web/pull/42/files?w=1#diff"), {
      host: "github.com",
      owner: "acme",
      repo: "web",
      number: 42,
    });
    assert.deepEqual(parsePrRef("acme/web.js#7"), { host: "github.com", owner: "acme", repo: "web.js", number: 7 });
    assert.equal(parsePrRef("https://ghe.example.com/acme/web/pull/3").host, "ghe.example.com");
  });

  for (const bad of ["https://github.com/acme/web/issues/42", "acme/web", "acme/../web#1", "https://github.com/acme/web/pull/0", "acme/web#x"]) {
    test(`rejects ${bad}`, () => {
      assert.throws(() => parsePrRef(bad), refusal(1, /PR reference/));
    });
  }
});

describe("parseRemote", () => {
  for (const [remote, expected] of [
    ["git@github.com:acme/web.git", "github.com/acme"],
    ["https://github.com/acme/web.git", "github.com/acme"],
    ["https://token@github.com/acme/web", "github.com/acme"],
    ["ssh://git@GitHub.com:22/acme/web.git", "github.com/acme"],
    ["git@ghe.example.com:Acme/web.git", "ghe.example.com/Acme"],
  ]) {
    test(`reads ${remote}`, () => {
      const { host, owner } = parseRemote(remote);
      assert.equal(`${host}/${owner}`, expected);
    });
  }

  test("an unreadable remote is an error", () => {
    assert.throws(() => parseRemote("/srv/repos/web.git"), refusal(1, /remote/));
  });
});

describe("rightSideLines", () => {
  const lines = rightSideLines(diff);

  test("context and added lines are on the right side; removed lines are not", () => {
    assert.deepEqual([...lines.get("src/app.ts")].sort((a, b) => a - b), [10, 11, 12, 13, 14, 41, 42]);
  });

  test("a hunk line that looks like a file header stays a hunk line", () => {
    assert.equal(lines.has("not-a-header"), false);
  });

  test("a new file, a path with a space, and a quoted path are mapped", () => {
    assert.deepEqual([...lines.get("new.md")], [1, 2]);
    assert.deepEqual([...lines.get("docs/with space.md")], [1]);
    assert.deepEqual([...lines.get("café.txt")], [3]);
  });

  test("a deleted file and a binary file have no right-side lines", () => {
    assert.equal(lines.has("gone.ts"), false);
    assert.equal(lines.has("logo.png"), false);
  });
});

describe("validateFindings", () => {
  test("a comment without evidence, a bad severity, a bad line, or a non-RIGHT side is rejected with every problem named", () => {
    const bad = findings({
      comments: [
        comment({ evidence: " " }),
        comment({ severity: "blocker" }),
        comment({ line: 0 }),
        comment({ line: "12" }),
        comment({ side: "LEFT" }),
        comment({ path: "/abs/path.ts" }),
      ],
    });
    assert.throws(
      () => validateFindings(bad),
      (error) => {
        assert.equal(error.code, 1);
        for (const index of [1, 2, 3, 4, 5, 6]) assert.match(error.message, new RegExp(`comment ${index}`));
        return true;
      },
    );
  });

  test("an empty review body is rejected, because GitHub requires one for COMMENT", () => {
    assert.throws(() => validateFindings(findings({ body: "  " })), refusal(1, /body/));
  });
});

describe("buildReview", () => {
  const build = (comments) =>
    buildReview({ findings: validateFindings(findings({ comments })), diffLines: rightSideLines(diff), headSha: head });

  test("inline comments carry only path, line, side, and body", () => {
    const { payload } = build([comment()]);
    assert.deepEqual(payload.comments, [{ path: "src/app.ts", line: 11, side: "RIGHT", body: comment().body }]);
  });

  test("a comment off the diff is folded into the body, never dropped", () => {
    const offFile = comment({ path: "src/caller.ts", line: 3, body: "callers still pass b" });
    const removedLine = comment({ line: 15, body: "why removing\ndrop()?" });
    const { payload, inline, folded } = build([comment(), offFile, removedLine]);
    assert.equal(inline.length, 1);
    assert.equal(folded.length, 2);
    assert.equal(payload.comments.length, 1);
    assert.match(payload.body, /^Left a couple of notes on the save path\.\n\nOutside the diff:\n/);
    assert.match(payload.body, /- `src\/caller\.ts:3`: callers still pass b/);
    assert.match(payload.body, /- `src\/app\.ts:15`: why removing\n {2}drop\(\)\?/);
  });

  test("a head that is not a full SHA is refused", () => {
    assert.throws(
      () => buildReview({ findings: validateFindings(findings()), diffLines: rightSideLines(diff), headSha: "abc123" }),
      refusal(1, /head/),
    );
  });
});

describe("helpers", () => {
  test("firstSentence keeps the first sentence on one line", () => {
    assert.equal(firstSentence("prob a race here. The lock is released\nbefore the write."), "prob a race here.");
    assert.equal(firstSentence("why removing this?\nIt guards nulls."), "why removing this?");
    assert.equal(firstSentence("x".repeat(200)).length, 120);
  });

  test("matchCommentUrls pairs by path, line, and body, and marks a missing one", () => {
    const sent = [comment(), comment({ line: 12, body: "second" })];
    const returned = [
      { path: "src/app.ts", line: 12, body: "second", html_url: "u2" },
      { path: "src/app.ts", line: 11, body: comment().body, html_url: "u1" },
    ];
    assert.deepEqual(matchCommentUrls(sent, returned), ["u1", "u2"]);
    assert.deepEqual(matchCommentUrls(sent, returned.slice(0, 1)), [null, "u2"]);
  });

  test("findExistingReview finds the operator's identical review on the same head only", () => {
    const review = { user: { login: "Operator" }, commit_id: head, state: "COMMENTED", body: "same", html_url: "r" };
    assert.equal(findExistingReview([review], { viewer: "operator", headSha: head, body: "same" }), review);
    assert.equal(findExistingReview([review], { viewer: "operator", headSha: movedHead, body: "same" }), undefined);
    assert.equal(findExistingReview([review], { viewer: "other", headSha: head, body: "same" }), undefined);
  });
});

describe("postReview", () => {
  const run = (responses, overrides = {}) => {
    const fake = fakeGh(responses);
    const options = {
      meta,
      diffText: diff,
      findings: findings(),
      realms: ["github.com/acme"],
      dryRun: false,
      gh: fake.gh,
      ...overrides,
    };
    return { fake, run: () => postReview(options) };
  };

  test("posts exactly one COMMENT review and reports the review and each comment URL", () => {
    const { fake, run: post } = run(happyResponses());
    const result = post();
    const posts = fake.calls.filter((call) => call.args.includes("POST"));
    assert.equal(posts.length, 1);
    assert.equal(JSON.parse(posts[0].input).event, "COMMENT");
    assert.deepEqual(result.lines, [
      "review: https://github.com/acme/web/pull/42#pullrequestreview-7",
      "src/app.ts:11 — this breaks save() when b is 3. — https://github.com/acme/web/pull/42#discussion_r1",
    ]);
  });

  test("a folded comment is reported as in the review body", () => {
    const off = comment({ path: "src/caller.ts", line: 3, body: "callers still pass b." });
    const { run: post } = run(happyResponses(), { findings: findings({ comments: [comment(), off] }) });
    assert.equal(post().lines.at(-1), "src/caller.ts:3 — callers still pass b. — in the review body");
  });

  test("the realm is checked before any gh call", () => {
    const { fake, run: post } = run(happyResponses(), { realms: ["github.com/other"] });
    assert.throws(post, refusal(2, /outside the realm/));
    assert.equal(fake.calls.length, 0);
  });

  test("a dry run makes no gh call and returns the payload", () => {
    const { fake, run: post } = run(happyResponses(), { dryRun: true });
    const result = post();
    assert.equal(fake.calls.length, 0);
    assert.equal(result.payload.event, "COMMENT");
    assert.equal(result.posted, false);
  });

  test("the operator's own PR is refused before posting", () => {
    const responses = happyResponses({
      "repos/acme/web/pulls/42": { head: { sha: head }, user: { login: "OPERATOR" }, state: "open" },
    });
    const { fake, run: post } = run(responses);
    assert.throws(post, refusal(2, /own PR/));
    assert.equal(fake.calls.filter((call) => call.args.includes("POST")).length, 0);
  });

  test("a head that moved since the diff was saved is refused before posting", () => {
    const responses = happyResponses({
      "repos/acme/web/pulls/42": { head: { sha: movedHead }, user: { login: "someone" }, state: "open" },
    });
    const { fake, run: post } = run(responses);
    assert.throws(post, refusal(2, /head moved/));
    assert.equal(fake.calls.filter((call) => call.args.includes("POST")).length, 0);
  });

  test("an identical review already on this head is reported, not posted twice", () => {
    const existing = {
      id: 7,
      user: { login: "operator" },
      commit_id: head,
      state: "COMMENTED",
      body: findings().body,
      html_url: "https://github.com/acme/web/pull/42#pullrequestreview-7",
    };
    const { fake, run: post } = run(happyResponses({ "repos/acme/web/pulls/42/reviews?per_page=100": [existing] }));
    const result = post();
    assert.equal(fake.calls.filter((call) => call.args.includes("POST")).length, 0);
    assert.match(result.lines[0], /already posted/);
  });

  test("a failed post carries the drafted payload so nothing is lost", () => {
    const { run: post } = run(happyResponses({ "POST repos/acme/web/pulls/42/reviews": new Error("HTTP 422") }));
    assert.throws(post, (error) => {
      assert.equal(error.code, 3);
      assert.equal(error.payload.event, "COMMENT");
      assert.match(error.message, /422/);
      return true;
    });
  });

  test("a non-github.com host is passed to gh as --hostname", () => {
    const responses = happyResponses();
    const { fake, run: post } = run(responses, {
      meta: { ...meta, url: "https://ghe.example.com/acme/web/pull/42" },
      realms: ["ghe.example.com/acme"],
    });
    post();
    for (const call of fake.calls) assert.deepEqual(call.args.slice(0, 3), ["api", "--hostname", "ghe.example.com"]);
  });
});

describe("command line", () => {
  const write = (name, content) => {
    const path = join(scratch, name);
    writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
    return path;
  };
  const stubDir = mkdtempSync(join(scratch, "bin-"));
  const marker = join(scratch, "gh-was-called");
  writeFileSync(join(stubDir, "gh"), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`);
  chmodSync(join(stubDir, "gh"), 0o755);
  const cli = (args) =>
    spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, PATH: stubDir } });
  const postArgs = [
    "post",
    "--meta",
    write("meta.json", meta),
    "--diff",
    write("pr.diff", diff),
    "--findings",
    write("findings.json", findings()),
    "--realm",
    "github.com/acme",
  ];

  test("--dry-run prints the COMMENT payload and calls no gh", () => {
    const result = cli([...postArgs, "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
    assert.match(result.stdout, /"event": "COMMENT"/);
    assert.match(result.stdout, /src\/app\.ts:11 — this breaks save\(\) when b is 3\. — inline/);
  });

  test("--event APPROVE is refused with exit 2", () => {
    const result = cli([...postArgs, "--dry-run", "--event", "APPROVE"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /COMMENT/);
  });

  test("a missing --realm is refused with exit 2", () => {
    const result = cli(postArgs.slice(0, -2).concat("--dry-run"));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /realm/);
  });

  const gitStub = (body) => {
    const directory = mkdtempSync(join(scratch, "git-"));
    writeFileSync(join(directory, "git"), `#!/bin/sh\n${body}\n`);
    chmodSync(join(directory, "git"), 0o755);
    return directory;
  };

  test("realm prints the host and owner of the origin remote", () => {
    const path = gitStub('echo "git@github.com:acme/web.git"');
    const result = spawnSync(process.execPath, [script, "realm"], { encoding: "utf8", env: { ...process.env, PATH: path } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "github.com/acme\n");
  });

  test("realm with no origin is refused with exit 2", () => {
    const path = gitStub("exit 2");
    const result = spawnSync(process.execPath, [script, "realm"], { encoding: "utf8", env: { ...process.env, PATH: path } });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no origin/);
  });
});
