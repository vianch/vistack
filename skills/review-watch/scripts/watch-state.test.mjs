import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  beginPass,
  claimWork,
  normalizeRealm,
  passLockPath,
  readState,
  recordResults,
  statePath,
  statusOf,
  switchOff,
  switchOn,
  unlockPass,
  updateState,
  watchDir,
  WatchStateError,
} from "./watch-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "watch-state.mjs");
const scratch = mkdtempSync(join(tmpdir(), "watch-state-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

let dirCount = 0;
const freshDir = () => join(scratch, `watch-${(dirCount += 1)}`);
const cli = (dir, ...args) =>
  spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, VISTACK_REVIEW_WATCH_DIR: dir } });
const load = (dir) => JSON.parse(readFileSync(statePath(dir), "utf8"));
const save = (dir, state) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(dir), JSON.stringify(state));
};
const minutes = 60_000;
const ago = (ms) => new Date(Date.now() - ms);
const backdate = (path, ms) => utimesSync(path, ago(ms), ago(ms));
const realm = "github.com/acme";
const reviewKey = `github.com/acme/web#42@${"a".repeat(40)}`;
const history = {
  reviewed: { [reviewKey]: { state: "done", outcome: "posted", at: "2026-10-01T00:00:00.000Z", attempts: 1, url: "https://github.com/acme/web/pull/42#r1" } },
  answered: { "github.com/acme/web#42/review/7": { state: "done", outcome: "needs-you", at: "2026-10-01T00:00:00.000Z", attempts: 1, reason: "asks for an approval" } },
  needsYou: [{ key: "github.com/acme/web#42/review/7", pr: "acme/web#42", url: "https://github.com/acme/web/pull/42#c7", reason: "asks for an approval", at: "2026-10-01T00:00:00.000Z" }],
  clean: [{ key: `github.com/acme/web#43@${"b".repeat(40)}`, pr: "acme/web#43", url: "https://github.com/acme/web/pull/43", title: "t", at: "2026-10-01T00:00:00.000Z" }],
  posted: [{ key: reviewKey, kind: "review", pr: "acme/web#42", url: "https://github.com/acme/web/pull/42#r1", summary: "3 comments", at: "2026-10-01T00:00:00.000Z" }],
};
const watchOn = (extra = {}) => ({ version: 1, enabled: true, realm, enabledAt: "2026-10-01T00:00:00.000Z", ...history, ...extra });

describe("paths and realms", () => {
  test("the watch dir comes from the override, else the home directory", () => {
    assert.equal(watchDir({ VISTACK_REVIEW_WATCH_DIR: "/somewhere" }), "/somewhere");
    assert.equal(watchDir({}), join(homedir(), ".vistack", "review-watch"));
  });

  test("a realm is stored as a lowercase host/owner, and a bare owner gets github.com", () => {
    assert.equal(normalizeRealm("Acme"), "github.com/acme");
    assert.equal(normalizeRealm("GHE.example.com:8443/Team"), "ghe.example.com:8443/team");
    for (const bad of ["", "a/b/c", "github.com/-acme", "has space", "github.com/acme;rm"]) {
      assert.throws(() => normalizeRealm(bad), (error) => error instanceof WatchStateError && error.code === 1, bad);
    }
  });
});

describe("the state file", () => {
  test("a missing file reads as off, and status and begin create nothing", () => {
    const dir = freshDir();
    assert.equal(statusOf({ dir }).enabled, false);
    const status = cli(dir, "status");
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /^off/);
    assert.equal(cli(dir, "begin", "--realm", realm).status, 4);
    assert.equal(existsSync(dir), false);
  });

  test("on and off are idempotent, and a second on keeps enabledAt", () => {
    const dir = freshDir();
    assert.equal(cli(dir, "on", "--realm", "Acme").status, 0);
    const first = readFileSync(statePath(dir), "utf8");
    assert.equal(load(dir).realm, realm);
    switchOn({ dir, realm, now: new Date(Date.now() + 5 * minutes) });
    assert.equal(readFileSync(statePath(dir), "utf8"), first);
    assert.equal(cli(dir, "off").status, 0);
    const offText = readFileSync(statePath(dir), "utf8");
    assert.equal(cli(dir, "off").status, 0);
    assert.equal(readFileSync(statePath(dir), "utf8"), offText);
    assert.equal(load(dir).enabled, false);
    const later = new Date(Date.now() + 10 * minutes);
    switchOn({ dir, realm, now: later });
    assert.equal(load(dir).enabledAt, later.toISOString());
  });

  test("on with another realm while on starts the mention window again", () => {
    const dir = freshDir();
    save(dir, watchOn());
    const now = new Date();
    switchOn({ dir, realm: "github.com/other", now });
    assert.deepEqual([load(dir).realm, load(dir).enabledAt], ["github.com/other", now.toISOString()]);
  });

  test("off keeps the history", () => {
    const dir = freshDir();
    save(dir, watchOn());
    switchOff({ dir });
    const state = load(dir);
    assert.equal(state.enabled, false);
    for (const key of Object.keys(history)) assert.deepEqual(state[key], history[key], key);
  });

  test("a write leaves no temp file, the file mode is 0600, and the dir mode is 0700", () => {
    const dir = freshDir();
    switchOn({ dir, realm });
    switchOff({ dir });
    assert.deepEqual(readdirSync(dir), ["state.json"]);
    assert.equal(statSync(statePath(dir)).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  });

  test("an unreadable file stops begin and status, and off recovers it after keeping a copy", () => {
    const dir = freshDir();
    save(dir, watchOn());
    writeFileSync(statePath(dir), "{not json");
    assert.equal(cli(dir, "begin", "--realm", realm).status, 1);
    assert.equal(cli(dir, "status", "--json").status, 1);
    assert.equal(readFileSync(statePath(dir), "utf8"), "{not json");
    assert.equal(cli(dir, "off").status, 0);
    const copies = readdirSync(dir).filter((name) => name.startsWith("state.json.corrupt-"));
    assert.equal(copies.length, 1);
    assert.equal(readFileSync(join(dir, copies[0]), "utf8"), "{not json");
    assert.deepEqual([load(dir).version, load(dir).enabled], [1, false]);
  });

  test("a wrong version or a mistyped collection is unreadable, and missing collections default", () => {
    const dir = freshDir();
    save(dir, { version: 2 });
    assert.equal(readState(dir).status, "unreadable");
    save(dir, { version: 1, reviewed: [] });
    assert.equal(readState(dir).status, "unreadable");
    save(dir, { version: 1 });
    const { status, state } = readState(dir);
    assert.equal(status, "ok");
    assert.deepEqual([state.reviewed, state.answered, state.needsYou, state.clean, state.posted], [{}, {}, [], [], []]);
  });

  test("unknown fields survive a write", () => {
    const dir = freshDir();
    save(dir, watchOn({ enabled: false, futureField: { kept: true }, reviewed: { [reviewKey]: { ...history.reviewed[reviewKey], note: "kept" } } }));
    switchOn({ dir, realm });
    assert.deepEqual(load(dir).futureField, { kept: true });
    assert.equal(load(dir).reviewed[reviewKey].note, "kept");
  });

  test("status --json is a summary: data.md's top-level fields, the pass lock, counts, needsYou and clean", () => {
    const dir = freshDir();
    save(dir, watchOn({ lastPassStartedAt: "2026-10-01T01:00:00.000Z" }));
    const result = cli(dir, "status", "--json");
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(status), ["enabled", "realm", "enabledAt", "lastPassStartedAt", "lastPassAt", "lastScanAt", "mentionBacklogSince", "passLock", "counts", "needsYou", "clean"]);
    assert.deepEqual(status.counts, { reviewed: 1, answered: 1, posted: 1, needsYou: 1, clean: 1 });
    assert.deepEqual([status.realm, status.lastPassAt, status.passLock], [realm, null, null]);
    assert.deepEqual(status.clean, history.clean);
    save(dir, watchOn({ realm: "github.com/acme; rm -rf ~" }));
    assert.equal(statusOf({ dir }).realm, null);
  });
});

describe("begin", () => {
  test("off exits 4, another realm exits 6, an invalid realm exits 1, and nothing is locked", () => {
    const dir = freshDir();
    save(dir, watchOn({ enabled: false }));
    assert.equal(cli(dir, "begin", "--realm", realm).status, 4);
    save(dir, watchOn());
    assert.equal(cli(dir, "begin", "--realm", "github.com/other").status, 6);
    assert.equal(cli(dir, "begin", "--realm", "a/b/c").status, 1);
    assert.equal(cli(dir, "begin").status, 1);
    assert.equal(existsSync(passLockPath(dir)), false);
  });

  test("0 prints realm, since and startedAt, takes the lock, and a second begin exits 5", () => {
    const dir = freshDir();
    save(dir, watchOn());
    const result = cli(dir, "begin", "--realm", "Acme");
    assert.equal(result.status, 0, result.stderr);
    const begun = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(begun), ["realm", "since", "startedAt"]);
    assert.deepEqual([begun.realm, begun.since], [realm, "2026-10-01T00:00:00.000Z"]);
    assert.equal(load(dir).lastPassStartedAt, begun.startedAt);
    assert.equal(existsSync(passLockPath(dir)), true);
    assert.equal(cli(dir, "begin", "--realm", realm).status, 5);
  });

  test("a pass started less than 20 minutes ago exits 5 unless --force", () => {
    const dir = freshDir();
    const started = ago(10 * minutes).toISOString();
    save(dir, watchOn({ lastPassStartedAt: started }));
    assert.equal(cli(dir, "begin", "--realm", realm).status, 5);
    assert.equal(load(dir).lastPassStartedAt, started);
    assert.equal(cli(dir, "begin", "--realm", realm, "--force").status, 0);
  });

  test("a fresh lock held by another pass exits 5 even with --force, and stays", () => {
    const dir = freshDir();
    save(dir, watchOn({ lastPassStartedAt: ago(25 * minutes).toISOString() }));
    mkdirSync(passLockPath(dir));
    backdate(passLockPath(dir), 5 * minutes);
    const before = statSync(passLockPath(dir)).mtimeMs;
    assert.equal(cli(dir, "begin", "--realm", realm, "--force").status, 5);
    assert.equal(statSync(passLockPath(dir)).mtimeMs, before);
  });

  test("a pass lock older than 20 minutes is broken", () => {
    const dir = freshDir();
    save(dir, watchOn({ lastPassStartedAt: ago(25 * minutes).toISOString() }));
    mkdirSync(passLockPath(dir));
    backdate(passLockPath(dir), 21 * minutes);
    const begun = beginPass({ dir, realm });
    assert.ok(Date.now() - statSync(passLockPath(dir)).mtimeMs < minutes);
    assert.equal(load(dir).lastPassStartedAt, begun.startedAt);
  });

  test("unlock releases the pass lock, and is idempotent", () => {
    const dir = freshDir();
    save(dir, watchOn());
    assert.equal(cli(dir, "begin", "--realm", realm).status, 0);
    assert.equal(cli(dir, "unlock").status, 0);
    assert.equal(existsSync(passLockPath(dir)), false);
    assert.equal(cli(dir, "unlock").status, 0);
    assert.equal(cli(dir, "begin", "--realm", realm, "--force").status, 0);
  });
});

describe("the write lock", () => {
  test("a write lock older than 30 seconds is broken", () => {
    const dir = freshDir();
    save(dir, watchOn({ enabled: false }));
    mkdirSync(`${statePath(dir)}.lock`);
    backdate(`${statePath(dir)}.lock`, 31_000);
    switchOn({ dir, realm });
    assert.equal(load(dir).enabled, true);
    assert.equal(existsSync(`${statePath(dir)}.lock`), false);
  });

  test("a fresh write lock makes a writer give up with code 1 and leaves both files alone", () => {
    const dir = freshDir();
    save(dir, watchOn({ enabled: false }));
    mkdirSync(`${statePath(dir)}.lock`);
    assert.throws(
      () => updateState(dir, (read) => ({ ...read.state, enabled: true }), { waitMs: 200 }),
      (error) => error instanceof WatchStateError && error.code === 1,
    );
    assert.equal(existsSync(`${statePath(dir)}.lock`), true);
    assert.equal(load(dir).enabled, false);
  });

  test("two writer processes at once both land every change", async () => {
    const dir = freshDir();
    switchOn({ dir, realm });
    const code = `import { updateState } from ${JSON.stringify(pathToFileURL(script).href)};
for (let index = 0; index < 50; index += 1) {
  updateState(process.env.WATCH_DIR, (read) => ({ ...read.state, [process.env.PREFIX + index]: index }));
}`;
    const writer = (prefix) =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
          env: { ...process.env, WATCH_DIR: dir, PREFIX: prefix },
          stdio: ["ignore", "ignore", "inherit"],
        });
        child.on("error", reject);
        child.on("exit", (exitCode) => (exitCode === 0 ? resolve() : reject(new Error(`writer ${prefix} exited ${exitCode}`))));
      });
    await Promise.all([writer("a"), writer("b")]);
    const state = load(dir);
    const missing = ["a", "b"].flatMap((prefix) => Array.from({ length: 50 }, (_, index) => `${prefix}${index}`)).filter((key) => !(key in state));
    assert.deepEqual(missing, []);
    assert.deepEqual(readdirSync(dir), ["state.json"]);
  });
});

describe("the command line", () => {
  test("bad arguments exit 1 and write nothing", () => {
    const dir = freshDir();
    for (const args of [[], ["nope"], ["on"], ["on", "--realm", "a/b/c"], ["status", "--force"], ["off", "--realm", realm]]) {
      assert.equal(cli(dir, ...args).status, 1, args.join(" "));
    }
    assert.equal(existsSync(statePath(dir)), false);
  });
});

const hours = 60 * minutes;
const days = 24 * hours;
const iso = (ms) => ago(ms).toISOString();
const rkey = (number, head = "c") => `github.com/acme/web#${number}@${head.repeat(40)}`;
const mkey = (id) => `github.com/acme/web#42/issue/${id}`;
const review = (number, head = "c") => ({ key: rkey(number, head), owner: "acme", repo: "web", number, url: `https://github.com/acme/web/pull/${number}`, headSha: head.repeat(40), title: `PR ${number}` });
const mention = (id, body = "can you look?", createdAt = iso(10 * minutes)) => ({ key: mkey(id), number: 42, kind: "issue", commentId: id, commentUrl: `https://github.com/acme/web/pull/42#issuecomment-${id}`, author: "someone", createdAt, body });
const workList = (extra) => ({ login: "operator", teams: [], reviews: [], mentions: [], mentionedPrs: [], skipped: [], ...extra });
const entry = (state, at, extra = {}) => ({ state, at: iso(at), attempts: 1, ...extra });
const listed = (key, at) => ({ key, pr: "acme/web#1", url: "https://github.com/acme/web/pull/1", at: iso(at) });
const empty = { reviewed: {}, answered: {}, needsYou: [], clean: [], posted: [] };
const passing = (extra = {}) => {
  const dir = freshDir();
  save(dir, watchOn({ ...empty, lastPassStartedAt: iso(25 * minutes), ...extra }));
  return { dir, startedAt: beginPass({ dir, realm }).startedAt };
};
const nextPass = (dir) => beginPass({ dir, realm, force: true }).startedAt;

describe("claim", () => {
  test("claim needs the pass lock, writes its claims before printing them, and caps each kind in input order", () => {
    const { dir } = passing();
    const file = join(dir, "work.json");
    writeFileSync(file, JSON.stringify(workList({ reviews: [1, 2, 3, 4].map((number) => review(number)), mentions: [mention(1), mention(2)] })));
    const result = cli(dir, "claim", "--work", file, "--max-reviews", "2", "--max-replies", "1");
    assert.equal(result.status, 0, result.stderr);
    const claimed = JSON.parse(result.stdout);
    assert.deepEqual([claimed.reviews.map((item) => item.number), claimed.mentions.map((item) => item.commentId)], [[1, 2], [1]]);
    const state = load(dir);
    assert.deepEqual([Object.keys(state.reviewed), Object.keys(state.answered)], [[rkey(1), rkey(2)], [mkey(1)]]);
    assert.deepEqual([state.reviewed[rkey(1)].state, state.reviewed[rkey(1)].attempts], ["claimed", 1]);
    unlockPass({ dir });
    assert.equal(cli(dir, "claim", "--work", file).status, 1);
    assert.deepEqual(load(dir), state);
  });

  test("a finished key is never claimed again", () => {
    const { dir } = passing({
      reviewed: {
        [rkey(1)]: entry("done", minutes, { outcome: "posted", url: "u" }),
        [rkey(2)]: entry("done", minutes, { outcome: "clean" }),
        [rkey(3)]: entry("failed", minutes, { attempts: 3, reason: "gave up" }),
      },
      answered: { [mkey(1)]: entry("done", minutes, { outcome: "needs-you", reason: "r" }) },
    });
    const claimed = claimWork({ dir, work: workList({ reviews: [review(1), review(2), review(3)], mentions: [mention(1)] }) });
    assert.deepEqual([claimed.reviews, claimed.mentions], [[], []]);
  });

  test("a transient failure is claimed again until the third gives up, and a refusal recorded as skipped is final", () => {
    const { dir } = passing();
    let startedAt = load(dir).lastPassStartedAt;
    const work = workList({ reviews: [review(1), review(2)] });
    for (const attempt of [1, 2, 3]) {
      if (attempt > 1) startedAt = nextPass(dir);
      assert.deepEqual(claimWork({ dir, work }).reviews.map((item) => item.number), attempt === 1 ? [1, 2] : [1]);
      const refusal = attempt === 1 ? [{ key: rkey(2), outcome: "skipped", reason: "the head moved" }] : [];
      recordResults({ dir, results: { startedAt, reviews: [{ key: rkey(1), outcome: "failed", reason: "gh 502" }, ...refusal] } });
      assert.deepEqual([load(dir).reviewed[rkey(1)].state, load(dir).reviewed[rkey(1)].attempts], ["failed", attempt]);
    }
    assert.equal(load(dir).reviewed[rkey(1)].reason, "gave up");
    nextPass(dir);
    assert.deepEqual(claimWork({ dir, work }).reviews, []);
  });

  test("an abandoned claim is claimed again, at 3 attempts it fails as abandoned, and a fresh claim is left alone", () => {
    const { dir } = passing({
      reviewed: {
        [rkey(1)]: entry("claimed", 61 * minutes, { attempts: 2, item: { url: "u" } }),
        [rkey(2)]: entry("claimed", 61 * minutes, { attempts: 3, item: { url: "u" } }),
        [rkey(3)]: entry("claimed", 5 * minutes),
      },
    });
    const claimed = claimWork({ dir, work: workList({ reviews: [review(1), review(2), review(3)] }) });
    assert.deepEqual(claimed.reviews.map((item) => item.number), [1]);
    const { reviewed } = load(dir);
    assert.deepEqual([reviewed[rkey(1)].state, reviewed[rkey(1)].attempts], ["claimed", 3]);
    assert.deepEqual([reviewed[rkey(2)].state, reviewed[rkey(2)].reason, "item" in reviewed[rkey(2)]], ["failed", "abandoned", false]);
    assert.deepEqual([reviewed[rkey(3)].state, reviewed[rkey(3)].attempts], ["claimed", 1]);
  });

  test("answered and stale needs-you items go; a clean head goes on a newer head or when a complete scan drops its PR", () => {
    for (const complete of [true, false]) {
      const { dir } = passing({
        reviewed: Object.fromEntries([1, 2, 3].map((number) => [rkey(number, "a"), entry("done", hours, { outcome: "clean" })])),
        needsYou: [listed(mkey(1), minutes), listed(mkey(2), 2 * minutes), listed(mkey(3), 15 * days)],
        clean: [listed(rkey(1, "a"), minutes), listed(rkey(2, "a"), 2 * minutes), listed(rkey(3, "a"), 3 * minutes)],
      });
      const skipped = [{ target: "acme/web#42", key: mkey(2), reason: "answered" }, ...(complete ? [] : [{ target: "acme", reason: "search page cap" }])];
      claimWork({ dir, work: workList({ reviews: [review(1, "b"), review(2, "a")], skipped }) });
      assert.deepEqual(load(dir).needsYou.map((item) => item.key), [mkey(1)]);
      assert.deepEqual(load(dir).clean.map((item) => item.key), complete ? [rkey(2, "a")] : [rkey(2, "a"), rkey(3, "a")]);
    }
  });

  test("finished or failed reviews after 30 days and answers before the mention window are pruned, never a key the scan lists", () => {
    for (const complete of [true, false]) {
      const { dir } = passing({
        lastScanAt: iso(3 * hours),
        reviewed: {
          [rkey(1)]: entry("done", 31 * days, { outcome: "posted", url: "u" }),
          [rkey(2)]: entry("done", 31 * days, { outcome: "clean" }),
          [rkey(3)]: entry("failed", 31 * days, { attempts: 3, reason: "gave up" }),
          [rkey(4)]: entry("done", 29 * days, { outcome: "posted", url: "u" }),
          [rkey(5)]: entry("failed", 31 * days, { reason: "abandoned" }),
          [rkey(6)]: entry("claimed", 31 * days),
        },
        answered: { [mkey(1)]: entry("done", 6 * hours, { outcome: "posted" }), [mkey(2)]: entry("done", 6 * hours, { outcome: "posted" }), [mkey(3)]: entry("done", 4 * hours, { outcome: "posted" }) },
      });
      const skipped = complete ? [] : [{ target: "acme", reason: "team budget" }];
      claimWork({ dir, work: workList({ reviews: [review(2)], mentions: [mention(2)], skipped }) });
      const state = load(dir);
      assert.deepEqual(Object.keys(state.reviewed), complete ? [rkey(2), rkey(4), rkey(6)] : [1, 2, 3, 4, 5, 6].map((number) => rkey(number)));
      assert.equal(state.reviewed[rkey(6)].reason, "abandoned");
      assert.deepEqual(Object.keys(state.answered), [mkey(2), mkey(3)]);
    }
  });

  test("a claim while the watch is off claims nothing and writes nothing", () => {
    const { dir } = passing();
    switchOff({ dir });
    const before = readFileSync(statePath(dir), "utf8");
    assert.deepEqual(claimWork({ dir, work: workList({ reviews: [review(1)] }) }).reviews, []);
    assert.equal(readFileSync(statePath(dir), "utf8"), before);
  });
});

describe("record", () => {
  test("record settles each claim, adds posts, clean heads and needs-you items, caps the lists, and releases its own lock", () => {
    const old = Array.from({ length: 50 }, (_, index) => ({ key: `old-${index}`, kind: "review", pr: "acme/web#1", url: "u", summary: "s", at: iso((index + 1) * minutes) }));
    const { dir, startedAt } = passing({ posted: old });
    claimWork({ dir, work: workList({ reviews: [review(1), review(2)], mentions: [mention(1, "x\n".repeat(100))] }) });
    const results = {
      startedAt,
      reviews: [{ key: rkey(1), outcome: "posted", url: "https://github.com/acme/web/pull/1#pullrequestreview-1", summary: "2 comments" }, { key: rkey(2), outcome: "clean" }, { key: rkey(9), outcome: "clean" }],
      mentions: [{ key: mkey(1), outcome: "needs-you", reason: "asks for an approval" }],
    };
    const file = join(dir, "results.json");
    writeFileSync(file, JSON.stringify(results));
    const result = cli(dir, "record", "--results", file);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /web#9@c+: not claimed/);
    const state = load(dir);
    assert.deepEqual(state.reviewed[rkey(1)], { state: "done", at: state.lastPassAt, attempts: 1, outcome: "posted", url: results.reviews[0].url });
    assert.deepEqual([state.posted.length, state.posted[0].kind, state.posted[0].pr, state.posted[0].summary], [50, "review", "acme/web#1", "2 comments"]);
    assert.deepEqual([state.clean[0].key, state.clean[0].title, state.clean[0].url], [rkey(2), "PR 2", "https://github.com/acme/web/pull/2"]);
    assert.deepEqual([state.needsYou[0].author, state.needsYou[0].reason, state.needsYou[0].url], ["someone", "asks for an approval", mention(1).commentUrl]);
    assert.equal(state.needsYou[0].excerpt, "x ".repeat(60));
    assert.ok(Date.now() - Date.parse(state.lastPassAt) < minutes);
    assert.equal(existsSync(passLockPath(dir)), false);
  });

  test("results without startedAt, with an unknown outcome, or a post without a url exit 1 and write nothing", () => {
    const { dir, startedAt } = passing();
    claimWork({ dir, work: workList({ reviews: [review(1)] }) });
    const before = readFileSync(statePath(dir), "utf8");
    for (const results of [{ reviews: [] }, { startedAt, reviews: [{ key: rkey(1), outcome: "approved" }] }, { startedAt, reviews: [{ key: rkey(1), outcome: "posted" }] }]) {
      assert.throws(() => recordResults({ dir, results }), (error) => error instanceof WatchStateError && error.code === 1);
    }
    assert.equal(readFileSync(statePath(dir), "utf8"), before);
    assert.equal(existsSync(passLockPath(dir)), true);
  });

  test("an off written during a pass survives its record, and a pass whose lock was unlocked still records", () => {
    const { dir, startedAt } = passing();
    claimWork({ dir, work: workList({ reviews: [review(1)] }) });
    switchOff({ dir });
    unlockPass({ dir });
    recordResults({ dir, results: { startedAt, reviews: [{ key: rkey(1), outcome: "clean" }] } });
    assert.deepEqual([load(dir).enabled, load(dir).reviewed[rkey(1)].outcome], [false, "clean"]);
  });

  test("a pass whose stale lock a newer pass broke records its results but leaves the newer pass's lock", () => {
    const dir = freshDir();
    save(dir, watchOn({ ...empty, lastPassStartedAt: iso(60 * minutes) }));
    const first = beginPass({ dir, realm, now: ago(25 * minutes) });
    claimWork({ dir, work: workList({ reviews: [review(1)] }), now: ago(24 * minutes) });
    backdate(passLockPath(dir), 21 * minutes);
    const second = beginPass({ dir, realm });
    recordResults({ dir, results: { startedAt: first.startedAt, reviews: [{ key: rkey(1), outcome: "posted", url: "u" }] } });
    assert.equal(load(dir).reviewed[rkey(1)].outcome, "posted");
    assert.equal(existsSync(passLockPath(dir)), true, "the first pass released the second pass's lock");
    recordResults({ dir, results: { startedAt: second.startedAt } });
    assert.equal(existsSync(passLockPath(dir)), false);
  });
});

describe("begin's window and the watch dir", () => {
  test("begin without --realm exits 4 while the watch is off or was never on, and 1 while it is on", () => {
    const dir = freshDir();
    assert.equal(cli(dir, "begin").status, 4);
    save(dir, { version: 1, enabled: false, realm: null });
    assert.equal(cli(dir, "begin").status, 4);
    save(dir, watchOn());
    assert.equal(cli(dir, "begin").status, 1);
  });

  test("begin's since is the mention window: two hours before the last scan, or enabledAt when later", () => {
    const lastScanAt = iso(3 * hours);
    const dir = freshDir();
    save(dir, watchOn({ lastScanAt }));
    assert.equal(beginPass({ dir, realm }).since, new Date(Date.parse(lastScanAt) - 2 * hours).toISOString());
    const enabledAt = iso(2 * hours);
    unlockPass({ dir });
    save(dir, watchOn({ lastScanAt, enabledAt }));
    assert.equal(beginPass({ dir, realm, force: true }).since, enabledAt);
  });

  test("the window does not move across failed scans, and moves after a scan that claim saw", () => {
    const lastScanAt = iso(3 * hours);
    const { dir, startedAt } = passing({ lastScanAt });
    const held = new Date(Date.parse(lastScanAt) - 2 * hours).toISOString();
    recordResults({ dir, results: { startedAt, reviews: [], mentions: [] } });
    const next = beginPass({ dir, realm, force: true });
    assert.deepEqual([next.since, load(dir).lastScanAt], [held, lastScanAt]);
    claimWork({ dir, work: workList() });
    recordResults({ dir, results: { startedAt: next.startedAt } });
    const moved = beginPass({ dir, realm, force: true }).since;
    assert.equal(moved, new Date(Date.parse(load(dir).lastScanAt) - 2 * hours).toISOString());
    assert.ok(Date.parse(moved) > Date.parse(held));
  });

  test("a backlog the reply cap leaves holds the window open until it drains, and answers inside it are kept", () => {
    const created = [9, 8, 7].map((age) => iso(age * hours));
    const { dir } = passing({
      enabledAt: iso(10 * hours),
      lastScanAt: iso(30 * minutes),
      mentionBacklogSince: created[0],
      answered: { [mkey(9)]: entry("done", 3 * hours, { outcome: "posted" }) },
    });
    const queue = [1, 2, 3].map((id, index) => mention(id, "look", created[index]));
    let startedAt = load(dir).lastPassStartedAt;
    for (const round of [0, 1, 2]) {
      const claimed = claimWork({ dir, work: workList({ mentions: queue.slice(round) }), maxReplies: 1 });
      assert.deepEqual(claimed.mentions.map((item) => item.commentId), [round + 1]);
      assert.equal(load(dir).mentionBacklogSince, created[round + 1]);
      assert.equal(mkey(9) in load(dir).answered, true);
      recordResults({ dir, results: { startedAt, mentions: [{ key: mkey(round + 1), outcome: "posted", url: "u" }] } });
      const begun = beginPass({ dir, realm, force: true });
      startedAt = begun.startedAt;
      const drained = new Date(Date.parse(load(dir).lastScanAt) - 2 * hours).toISOString();
      assert.equal(begun.since, created[round + 1] ?? drained, `round ${round}`);
    }
  });

  test("a backlog never moves the window behind where it was", () => {
    const lastScanAt = iso(30 * minutes);
    const { dir } = passing({ lastScanAt });
    claimWork({ dir, work: workList({ mentions: [mention(1, "look", iso(hours)), mention(2, "look", iso(5 * hours))] }), maxReplies: 1 });
    assert.equal(load(dir).mentionBacklogSince, new Date(Date.parse(lastScanAt) - 2 * hours).toISOString());
  });

  test("a write narrows a wider watch dir to 0700", () => {
    const dir = freshDir();
    mkdirSync(dir);
    chmodSync(dir, 0o755);
    switchOn({ dir, realm });
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  });
});
