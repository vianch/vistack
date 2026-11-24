import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import * as collector from "./collect.mjs";
import { normalizeRemote } from "./collect-github.mjs";
import { emailPattern } from "./collect-lib.mjs";
import { fakeRunner, listWorld, loadWorld, rawField } from "./fixtures/fake-runner.mjs";

const now = "2026-11-24T12:00:00Z";
const london = ["--realm", "github.com/example-org", "--now", now, "--time-zone", "Europe/London"];
const folder = [...london, "--scope", "folder", "--dir", "/work", "--author-email", "sample-dev@users.noreply.example.com"];

const collectWith = (argv, runner = {}, world = loadWorld(), deps = {}) => {
  const { run, calls } = fakeRunner(world, runner);
  const result = collector.main(argv, { run, now: () => Date.parse(now), listCheckouts: () => listWorld(world), writeFile: () => {}, cwd: "/work", defaultTimeZone: "UTC", ...deps });
  return { ...result, calls, activity: result.code === 0 && result.stdout.startsWith("{") ? JSON.parse(result.stdout) : null };
};
const queries = (calls) => calls.filter((call) => call.includes("graphql")).map((call) => rawField(call.slice(1), "searchQuery"));
const source = (activity, name) => activity.sources.find((entry) => entry.name === name);

test("a symlinked child in folder scope is listed as skipped and never followed", () => {
  const world = loadWorld();
  world.checkouts.linked = { symlink: true, origin: "git@github.com:example-org/storefront.git" };
  const { activity, calls } = collectWith(folder, {}, world);
  assert.deepEqual(activity.scope.skipped.find((entry) => entry.repository === "linked"), { repository: "linked", reason: "symlink" });
  assert.equal(calls.filter((call) => call.includes("/work/linked")).length, 0);
  const scratch = mkdtempSync(join(tmpdir(), "collect-list-"));
  after(() => rmSync(scratch, { recursive: true, force: true }));
  mkdirSync(join(scratch, "app", ".git"), { recursive: true });
  mkdirSync(join(scratch, "notes"));
  symlinkSync(join(scratch, "app"), join(scratch, "app-link"));
  assert.deepEqual(collector.listGitCheckouts?.(scratch), [{ name: "app", symlink: false }, { name: "app-link", symlink: true }]);
});

const baseline = () => collectWith(folder).activity;

test("git log matches author emails ignoring case, so a commit recorded as Sample-Dev@Example.com counts", () => {
  const { activity, calls } = collectWith(folder);
  const log = calls.find((call) => call.includes("log"));
  assert.ok(log.includes("-i") && log.includes("-F"));
  assert.equal(activity.metrics.commits, 4);
});

test("two checkouts whose origins differ only in owner case are searched once and counted once", () => {
  const world = loadWorld();
  world.checkouts["storefront-https"] = { ...world.checkouts.storefront, origin: "https://github.com/Example-Org/storefront.git" };
  const { activity, calls } = collectWith(folder, {}, world);
  assert.deepEqual(activity.scope.repositories, ["example-org/billing", "example-org/storefront"]);
  assert.equal(new Set(queries(calls).filter((query) => /^is:pr author:\S+ created:.* repo:example-org\/storefront$/i.test(query))).size, 1);
  assert.deepEqual(activity.metrics, baseline().metrics);
});

test("records from overlapping search scopes count once by lowercased repository and number", async () => {
  const { uniqueRecords } = await import("./collect-github.mjs");
  const pull = { repository: "example-org/storefront", number: 101 };
  assert.equal(uniqueRecords?.("pullRequests", [pull, { ...pull, repository: "Example-Org/storefront" }]).length, 1);
  const review = { repository: "example-org/storefront", number: 200, submitted_at: "2026-11-18T10:00:00Z" };
  const reviews = [review, { ...review, repository: "EXAMPLE-ORG/storefront" }, { ...review, submitted_at: "2026-11-19T11:00:00Z" }];
  assert.equal(uniqueRecords?.("reviews", reviews).length, 2);
});

test("rejected issue fields fail their own source, so tasks, sub-issues, and types read not recorded", () => {
  const { activity } = collectWith(folder, { rejectIssueFields: "exit" });
  const fields = source(activity, "GitHub search: issue fields");
  assert.deepEqual([fields?.ok, fields?.metrics], [false, ["tasks_created", "sub_issues_created"]]);
  assert.match(fields.detail, /does not support the issue type and parent fields/);
  assert.equal(source(activity, "GitHub search: issues created").ok, true);
  const { metrics, breakdowns } = activity;
  assert.deepEqual([metrics.issues_created, metrics.tasks_created, metrics.sub_issues_created, breakdowns.issues_by_type], [3, null, null, null]);
  assert.equal(source(baseline(), "GitHub search: issue fields")?.ok, true);
});

test("email redaction runs per string value, so an escape before an address keeps the JSON valid", () => {
  const world = loadWorld();
  world.searches["billing created"][0].nodes[0].title = "Notify\tops@example-shop.test";
  const { stdout } = collectWith(folder, {}, world);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.items.pull_requests.find((pull) => pull.number === 7).title, "Notify\t[email hidden]");
});

test("tokens and URL credentials in a failed command's first line never reach a source detail", () => {
  const searchOf = (args) => rawField(args.slice(1), "searchQuery") ?? "";
  const fail = (command, args) => {
    if (command === "git") return args.includes("log") ? "fatal: unable to access 'https://sample-dev:s3cret@git.example.test/x.git/'" : undefined;
    if (/reviewed-by/.test(searchOf(args))) return "gh: HTTP 401 for token ghp_abcdefghijklmnopqrstuvwxyz0123";
    return /^commenter:/.test(searchOf(args)) ? "gh: bad credentials github_pat_11ABCDEFG_abcdefXYZ0123" : undefined;
  };
  const { stdout, activity } = collectWith(folder, { fail });
  assert.doesNotMatch(stdout, /ghp_|github_pat_|s3cret/);
  assert.equal(source(activity, "GitHub search: reviews").detail, "gh: HTTP 401 for token [token hidden]");
  assert.equal(source(activity, "GitHub search: comments").detail, "gh: bad credentials [token hidden]");
  assert.equal(source(activity, "git log").detail, "example-org/billing: fatal: unable to access 'https://[credentials hidden]@git.example.test/x.git/'");
});

test("the email pattern hides Unicode and dotless addresses but leaves package versions", async () => {
  const { redactEmails } = await import("./collect-lib.mjs");
  assert.equal(redactEmails("josé@example.com, ops@exämple.de, ops@localhost"), "[email hidden], [email hidden], [email hidden]");
  assert.equal(redactEmails("bump pkg@1.2.3, lodash@4.17.21, @org/pkg@2.0.0, pkg@1.0.0-beta"), "bump pkg@1.2.3, lodash@4.17.21, @org/pkg@2.0.0, pkg@1.0.0-beta");
});

test("--org must be an ASCII owner name, and the qualifier and label use the realm's own spelling", () => {
  const kelvin = collectWith([...london, "--realm", "github.com/kelvin-org", "--scope", "org", "--org", "Kelvin-org"]);
  assert.deepEqual([kelvin.code, kelvin.calls.length], [1, 0]);
  const { activity, calls } = collectWith(["--realm", "github.com/Example-Org", "--now", now, "--scope", "org", "--org", "example-org"]);
  assert.equal(activity.scope.label, "Example-Org");
  assert.ok(queries(calls).every((query) => query.endsWith(" org:Example-Org")));
});

test("results from a repository whose owner is outside the realm are dropped and counted", () => {
  const world = loadWorld();
  const [first] = world.searches["storefront created"][0].nodes;
  world.searches["storefront created"][0].nodes.push({ ...first, number: 900, repository: { nameWithOwner: "other-org/storefront" } });
  const { activity } = collectWith(folder, {}, world);
  assert.deepEqual(activity.metrics, baseline().metrics);
  assert.match(source(activity, "GitHub search: pull requests").detail, /; 1 result outside the realm dropped$/);
  assert.ok(activity.items.pull_requests.every((pull) => pull.repository.startsWith("example-org/")));
});

test("no email address reaches the output, from git, titles, or a failed command", () => {
  const { stdout } = collectWith(folder);
  assert.doesNotMatch(stdout, emailPattern);
  assert.match(stdout, /Checkout copy for \[email hidden\]/);
  const failing = collectWith(folder, { fail: (command, args) => (command === "git" && args.includes("log") ? "fatal: bad author sample-dev@example.com" : undefined) });
  assert.equal(source(failing.activity, "git log").ok, false);
  assert.doesNotMatch(failing.stdout, emailPattern);
  const argv = failing.calls.find((call) => call.includes("log"));
  assert.ok(argv.includes("--author=sample-dev@example.com") && argv.includes("-F") && argv.includes("--format=%x1e%H%x1f%ae%x1f%aI"));
});

test("CLI: --help prints usage, bad arguments exit 1, an unwritable --out exits 1", () => {
  const help = collectWith(["--help"]);
  assert.deepEqual([help.code, help.stdout.startsWith("usage: node collect.mjs --realm"), help.calls.length], [0, true, 0]);
  assert.equal(collectWith([...london, "--period", "fortnight"]).code, 1);
  assert.equal(collectWith([...london, "--realm", "not a realm"]).code, 1);
  const missingDir = collectWith(folder, {}, loadWorld(), { listCheckouts: () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); } });
  assert.deepEqual([missingDir.code, missingDir.stderr, missingDir.calls.length], [1, "collect: cannot read --dir /work: ENOENT\n", 0]);
  const unwritable = collectWith([...folder, "--out", "/missing/activity.json"], {}, loadWorld(), { writeFile: () => { throw Object.assign(new Error("no such directory"), { code: "ENOENT" }); } });
  assert.deepEqual([unwritable.code, unwritable.stderr], [1, "collect: cannot write /missing/activity.json: ENOENT\n"]);
});

test("--out creates missing parent folders, and a path that still cannot be written exits 1", () => {
  const scratch = mkdtempSync(join(tmpdir(), "collect-out-"));
  after(() => rmSync(scratch, { recursive: true, force: true }));
  const nested = join(scratch, "reports", "2026-11", "activity.json");
  const written = collectWith([...folder, "--out", nested], {}, loadWorld(), { writeFile: collector.writeOutput });
  assert.deepEqual([written.code, written.stdout, JSON.parse(readFileSync(nested, "utf8")).schema], [0, `wrote ${nested}\n`, 1]);
  writeFileSync(join(scratch, "blocker"), "a file where a folder is expected");
  const blocked = join(scratch, "blocker", "activity.json");
  const refused = collectWith([...folder, "--out", blocked], {}, loadWorld(), { writeFile: collector.writeOutput });
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, new RegExp(`^collect: cannot write ${blocked}: (ENOTDIR|EEXIST)\n$`));
});

test("a repo scope outside the realm reads only the origin and records every metric as null", () => {
  const { activity, calls } = collectWith([...london, "--dir", "/work/tool"]);
  assert.equal(calls.length, 1);
  assert.equal(activity.subject.login, collector.unknownLogin);
  assert.ok(Object.values(activity.metrics).every((value) => value === null));
  assert.equal(normalizeRemote("git@github.com:example-org/storefront org:other-org.git"), null);
  assert.deepEqual(normalizeRemote("https://github.com/Example-Org/billing.git/"), { host: "github.com", owner: "Example-Org", name: "Example-Org/billing" });
  assert.ok(activity.sources.every((entry) => !entry.ok && entry.detail === "no repository inside the realm"));
});
