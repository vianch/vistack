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
  postReply,
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

  describe("--once-per-head", () => {
    const review = (overrides) => ({
      id: 5,
      user: { login: "Operator" },
      commit_id: head,
      state: "COMMENTED",
      body: "an earlier wording",
      html_url: "https://github.com/acme/web/pull/42#pullrequestreview-5",
      ...overrides,
    });
    const withReviews = (reviews) => happyResponses({ "repos/acme/web/pulls/42/reviews?per_page=100": reviews });

    test("any operator review on this head, whatever its body, is reported and nothing is posted", () => {
      const { fake, run: post } = run(withReviews([review()]), { oncePerHead: true });
      const result = post();
      assert.equal(fake.calls.filter((call) => call.args.includes("POST")).length, 0);
      assert.equal(result.posted, false);
      assert.deepEqual(result.lines, ["review: https://github.com/acme/web/pull/42#pullrequestreview-5 (already reviewed this head; nothing new posted)"]);
    });

    test("an operator review on an older commit, or another person's review on this head, does not count", () => {
      const others = [review({ commit_id: movedHead }), review({ user: { login: "someone" } })];
      const { fake, run: post } = run(withReviews(others), { oncePerHead: true });
      assert.equal(post().posted, true);
      assert.equal(fake.calls.filter((call) => call.args.includes("POST")).length, 1);
    });

    test("without the flag, a different body on the same head still posts, as before", () => {
      const { fake, run: post } = run(withReviews([review()]));
      assert.equal(post().posted, true);
      assert.equal(fake.calls.filter((call) => call.args.includes("POST")).length, 1);
    });
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
  writeFileSync(join(stubDir, "gh"), `#!/bin/sh\n: > "${marker}"\nexit 1\n`);
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

  test("post --once-per-head exits 0 and prints the review already on this head", () => {
    const answers = {
      "api user": { login: "operator" },
      "api repos/acme/web/pulls/42": { head: { sha: head }, user: { login: "someone" }, state: "open" },
      "api repos/acme/web/pulls/42/reviews?per_page=100": [
        { id: 5, user: { login: "operator" }, commit_id: head, state: "COMMENTED", body: "earlier", html_url: `${prUrl}#pullrequestreview-5` },
      ],
    };
    const cases = Object.entries(answers).map(([args, value]) => `  "${args}") printf '%s' '${JSON.stringify(value)}' ;;`);
    const bin = mkdtempSync(join(scratch, "bin-"));
    writeFileSync(join(bin, "gh"), `#!/bin/sh\ncase "$*" in\n${cases.join("\n")}\n  *) echo "unexpected gh $*" >&2; exit 1 ;;\nesac\n`);
    chmodSync(join(bin, "gh"), 0o755);
    const result = spawnSync(process.execPath, [script, ...postArgs, "--once-per-head"], { encoding: "utf8", env: { ...process.env, PATH: bin } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `review: ${prUrl}#pullrequestreview-5 (already reviewed this head; nothing new posted)\n`);
  });
});

const targetAt = "2026-10-06T12:00:00Z";
const since = "since=2026-10-06T12:00:00.000Z&per_page=100";
const person = { login: "someone", type: "User" };
const reviewComment = {
  id: 123456,
  in_reply_to_id: 123400,
  user: person,
  pull_request_url: "https://api.github.com/repos/acme/web/pulls/42",
  html_url: `${prUrl}#discussion_r123456`,
  created_at: targetAt,
};
const issueComment = {
  id: 98765,
  user: person,
  issue_url: "https://api.github.com/repos/acme/web/issues/42",
  html_url: `${prUrl}#issuecomment-98765`,
  created_at: targetAt,
};
const reviewBody = {
  id: 555,
  user: person,
  pull_request_url: "https://api.github.com/repos/acme/web/pulls/42",
  html_url: `${prUrl}#pullrequestreview-555`,
  submitted_at: targetAt,
};
const openPr = { head: { sha: head }, user: { login: "someone" }, state: "open" };

const replyResponses = (extra = {}) => ({
  user: { login: "operator" },
  "repos/acme/web/pulls/42": openPr,
  "repos/acme/web/pulls/comments/123456": reviewComment,
  "repos/acme/web/issues/comments/98765": issueComment,
  "repos/acme/web/pulls/42/reviews/555": reviewBody,
  [`repos/acme/web/pulls/42/comments?${since}`]: [],
  [`repos/acme/web/issues/42/comments?${since}`]: [],
  "POST repos/acme/web/pulls/42/comments/123400/replies": { id: 2, html_url: `${prUrl}#discussion_r2` },
  "POST repos/acme/web/issues/42/comments": { id: 3, html_url: `${prUrl}#issuecomment-3` },
  ...extra,
});

describe("reply", () => {
  const ids = { review: "123456", issue: "98765", "review-body": "555" };
  const answer = "it retries 3 times (`src/jobs/retry.ts:41`).";
  const reply = (responses, overrides = {}) => {
    const fake = fakeGh(responses);
    const kind = overrides.kind ?? "review";
    const options = {
      prUrl,
      commentId: ids[kind],
      kind,
      body: `${answer}\n`,
      realms: ["github.com/acme"],
      headSha: head,
      dryRun: false,
      gh: fake.gh,
      ...overrides,
    };
    return { fake, run: () => postReply(options) };
  };
  const posts = (fake) => fake.calls.filter((call) => call.args.includes("POST"));

  test("a reply to a reply in a review thread posts once to the thread root, with no review event", () => {
    const { fake, run } = reply(replyResponses());
    assert.deepEqual(run().lines, [`reply: ${prUrl}#discussion_r2`]);
    assert.equal(posts(fake).length, 1);
    assert.ok(posts(fake)[0].args.includes("repos/acme/web/pulls/42/comments/123400/replies"));
    assert.deepEqual(JSON.parse(posts(fake)[0].input), { body: answer });
  });

  for (const [kind, anchor] of [["issue", "issuecomment-98765"], ["review-body", "pullrequestreview-555"]]) {
    test(`a ${kind} reply links the target in a one-line quote header and posts to /issues/{n}/comments`, () => {
      const { fake, run } = reply(replyResponses(), { kind });
      assert.deepEqual(run().lines, [`reply: ${prUrl}#issuecomment-3`]);
      assert.equal(posts(fake).length, 1);
      assert.ok(posts(fake)[0].args.includes("repos/acme/web/issues/42/comments"));
      assert.deepEqual(JSON.parse(posts(fake)[0].input), { body: `> In reply to ${prUrl}#${anchor}\n\n${answer}` });
    });
  }

  test("the realm is checked before any gh call", () => {
    const { fake, run } = reply(replyResponses(), { realms: ["github.com/other"] });
    assert.throws(run, refusal(2, /outside the realm/));
    assert.equal(fake.calls.length, 0);
  });

  test("a dry run makes no gh call and returns the request", () => {
    const { fake, run } = reply(replyResponses(), { kind: "issue", dryRun: true });
    const result = run();
    assert.equal(fake.calls.length, 0);
    assert.equal(result.posted, false);
    assert.equal(result.request.path, "repos/acme/web/issues/42/comments");
    assert.match(result.request.body, /^> In reply to .+\n\nit retries 3 times/);
  });

  for (const [name, overrides, pattern] of [
    ["an unknown kind", { kind: "commit", commentId: "1" }, /kind/],
    ["a comment id that is not a number", { commentId: "12ab" }, /--comment/],
    ["an empty body", { body: " \n" }, /empty/],
    ["a body over GitHub's 65,536-character limit", { body: "x".repeat(65537) }, /65,536/],
    ["a head that is not a full SHA", { headSha: "abc123" }, /--head/],
  ]) {
    test(`${name} is bad input, exit 1, before any gh call`, () => {
      const { fake, run } = reply(replyResponses(), overrides);
      assert.throws(run, refusal(1, pattern));
      assert.equal(fake.calls.length, 0);
    });
  }

  for (const [name, extra, overrides, pattern] of [
    ["the operator's own PR", { "repos/acme/web/pulls/42": { ...openPr, user: { login: "OPERATOR" } } }, {}, /own PR/],
    ["a closed PR", { "repos/acme/web/pulls/42": { ...openPr, state: "closed" } }, {}, /closed, not open/],
    ["a head that moved", { "repos/acme/web/pulls/42": { ...openPr, head: { sha: movedHead } } }, {}, /head moved/],
    [
      "a review comment on another PR",
      { "repos/acme/web/pulls/comments/123456": { ...reviewComment, pull_request_url: "https://api.github.com/repos/acme/web/pulls/41" } },
      {},
      /not on acme\/web#42/,
    ],
    [
      "an issue comment on another PR",
      { "repos/acme/web/issues/comments/98765": { ...issueComment, issue_url: "https://api.github.com/repos/acme/web/issues/420" } },
      { kind: "issue" },
      /not on acme\/web#42/,
    ],
    [
      "the operator's own comment",
      { "repos/acme/web/pulls/comments/123456": { ...reviewComment, user: { login: "Operator", type: "User" } } },
      {},
      /operator's own/,
    ],
    [
      "a bot's comment",
      { "repos/acme/web/pulls/comments/123456": { ...reviewComment, user: { login: "ci-helper", type: "Bot" } } },
      {},
      /bot/,
    ],
  ]) {
    test(`${name} is refused with nothing posted`, () => {
      const { fake, run } = reply(replyResponses(extra), overrides);
      assert.throws(run, refusal(2, pattern));
      assert.equal(posts(fake).length, 0);
    });
  }

  for (const [kind, path] of [["review-body", "repos/acme/web/pulls/42/reviews/555"], ["issue", "repos/acme/web/issues/comments/98765"]]) {
    test(`a missing ${kind} target is refused, exit 2, because a retry never finds it`, () => {
      const { fake, run } = reply(replyResponses({ [path]: new Error("gh: Not Found (HTTP 404)") }), { kind });
      assert.throws(run, refusal(2, /target not found on this PR/));
      assert.equal(posts(fake).length, 0);
    });
  }

  test("any other failure reading the target stays exit 3, so it is retried", () => {
    const { run } = reply(replyResponses({ "repos/acme/web/pulls/comments/123456": new Error("gh: Bad Gateway (HTTP 502)") }));
    assert.throws(run, refusal(3, /HTTP 502/));
  });

  describe("duplicate guard", () => {
    const threadReply = (overrides) => ({ in_reply_to_id: 123400, user: { login: "operator" }, body: "earlier", ...overrides });
    const before = threadReply({ id: 9, created_at: "2026-10-06T11:00:00Z", html_url: `${prUrl}#discussion_r9` });
    const elsewhere = threadReply({ id: 11, in_reply_to_id: 999, created_at: "2026-10-06T12:06:00Z", html_url: `${prUrl}#discussion_r11` });

    test("an operator reply in the thread after the target is reported, and nothing new is posted", () => {
      const after = threadReply({ id: 10, user: { login: "Operator" }, created_at: "2026-10-06T12:05:00Z", html_url: `${prUrl}#discussion_r10` });
      const { fake, run } = reply(replyResponses({ [`repos/acme/web/pulls/42/comments?${since}`]: [before, elsewhere, after] }));
      assert.deepEqual(run().lines, [`reply: ${prUrl}#discussion_r10 (already replied; nothing new posted)`]);
      assert.equal(posts(fake).length, 0);
    });

    test("an operator reply from before the target, or in another thread, does not count", () => {
      const { fake, run } = reply(replyResponses({ [`repos/acme/web/pulls/42/comments?${since}`]: [before, elsewhere] }));
      assert.deepEqual(run().lines, [`reply: ${prUrl}#discussion_r2`]);
      assert.equal(posts(fake).length, 1);
    });

    const header = `> In reply to ${prUrl}#issuecomment-98765`;
    const issueReply = (overrides) => ({ user: { login: "operator" }, created_at: "2026-10-06T12:02:00Z", ...overrides });
    const longerId = issueReply({ id: 20, body: `${header}0\r\n\r\nanother thread`, html_url: `${prUrl}#issuecomment-20` });

    test("an issue reply carrying the same header line is reported, and nothing new is posted", () => {
      const same = issueReply({ id: 21, body: `${header}\r\n\r\nreworded answer`, html_url: `${prUrl}#issuecomment-21` });
      const { fake, run } = reply(replyResponses({ [`repos/acme/web/issues/42/comments?${since}`]: [longerId, same] }), { kind: "issue" });
      assert.deepEqual(run().lines, [`reply: ${prUrl}#issuecomment-21 (already replied; nothing new posted)`]);
      assert.equal(posts(fake).length, 0);
    });

    test("a header that links a longer comment id does not count", () => {
      const { fake, run } = reply(replyResponses({ [`repos/acme/web/issues/42/comments?${since}`]: [longerId] }), { kind: "issue" });
      assert.deepEqual(run().lines, [`reply: ${prUrl}#issuecomment-3`]);
      assert.equal(posts(fake).length, 1);
    });
  });

  test("a failed post exits 3 and carries the drafted request", () => {
    const { run } = reply(replyResponses({ "POST repos/acme/web/pulls/42/comments/123400/replies": new Error("HTTP 502") }));
    assert.throws(run, (error) => {
      assert.equal(error.code, 3);
      assert.match(error.message, /502/);
      assert.deepEqual(error.payload, { method: "POST", path: "repos/acme/web/pulls/42/comments/123400/replies", body: answer });
      return true;
    });
  });

  test("a non-github.com host is passed to gh as --hostname", () => {
    const { fake, run } = reply(replyResponses(), { prUrl: "https://ghe.example.com/acme/web/pull/42", realms: ["ghe.example.com/acme"] });
    run();
    assert.ok(fake.calls.length > 0);
    for (const call of fake.calls) assert.deepEqual(call.args.slice(0, 3), ["api", "--hostname", "ghe.example.com"]);
  });
});

describe("reply command line", () => {
  const directory = mkdtempSync(join(scratch, "reply-"));
  const bodyFile = join(directory, "body.md");
  writeFileSync(bodyFile, "it retries 3 times.\n");
  const marker = join(directory, "gh-was-called");
  const ghStub = (body) => {
    const bin = mkdtempSync(join(directory, "bin-"));
    writeFileSync(join(bin, "gh"), `#!/bin/sh\n: > "${marker}"\n${body}\n`);
    chmodSync(join(bin, "gh"), 0o755);
    return bin;
  };
  const cli = (args, bin = ghStub("exit 1")) =>
    spawnSync(process.execPath, [script, "reply", ...args], { encoding: "utf8", env: { ...process.env, PATH: bin } });
  const replyArgs = ["--pr", prUrl, "--comment", "98765", "--kind", "issue", "--body-file", bodyFile, "--realm", "github.com/acme"];

  test("--dry-run prints the request and calls no gh", () => {
    rmSync(marker, { force: true });
    const result = cli([...replyArgs, "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
    assert.match(result.stdout, /"path": "repos\/acme\/web\/issues\/42\/comments"/);
  });

  test("--body is rejected with exit 1, because the body travels only in a file", () => {
    const result = cli([...replyArgs, "--body", "hi"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unexpected argument --body/);
  });

  test("--event COMMENT is refused with exit 2, because a reply carries no review event", () => {
    const result = cli([...replyArgs, "--event", "COMMENT", "--dry-run"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no review event/);
  });

  test("a missing --body-file is bad input, exit 1", () => {
    const result = cli(replyArgs.filter((_, index) => index !== 6 && index !== 7));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--body-file/);
  });

  test("a failed post exits 3 and prints the drafted reply", () => {
    const answers = {
      "api user": { login: "operator" },
      "api repos/acme/web/pulls/42": openPr,
      "api repos/acme/web/issues/comments/98765": issueComment,
      [`api repos/acme/web/issues/42/comments?${since}`]: [],
    };
    const cases = Object.entries(answers).map(([args, value]) => `  "${args}") printf '%s' '${JSON.stringify(value)}' ;;`);
    const bin = ghStub(`case "$*" in\n${cases.join("\n")}\n  *) echo "HTTP 502: Bad Gateway" >&2; exit 1 ;;\nesac`);
    const result = cli(replyArgs, bin);
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, /502/);
    assert.match(result.stdout, /^drafted reply, not posted:\n/);
    assert.match(result.stdout, /In reply to https:\/\/github\.com\/acme\/web\/pull\/42#issuecomment-98765/);
  });
});
