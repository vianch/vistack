import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { commentsCut } from "./collect-github.mjs";
import { computePeriods, formatZoned, parseGitLog, renamedPath } from "./collect-lib.mjs";
import { main, unknownLogin } from "./collect.mjs";
import { fakeRunner, listWorld, loadWorld, rawField } from "./fixtures/fake-runner.mjs";

const now = "2026-11-24T12:00:00Z";
const london = ["--realm", "github.com/example-org", "--now", now, "--time-zone", "Europe/London"];
const folder = [...london, "--scope", "folder", "--dir", "/work", "--author-email", "sample-dev@users.noreply.example.com"];
const metricKeys = "commits lines_added lines_removed files_changed active_days prs_opened prs_merged prs_closed_unmerged prs_open pr_cycle_time_median_hours prs_reviewed review_comments comments issues_created tasks_created sub_issues_created issues_solved".split(" ");
const zero = Object.fromEntries(metricKeys.map((key) => [key, key === "pr_cycle_time_median_hours" ? null : 0]));

const collectWith = (argv, runner = {}, { world = loadWorld(), deps = {} } = {}) => {
  const { run, calls } = fakeRunner(world, runner);
  const result = main(argv, { run, now: () => Date.parse(now), listCheckouts: () => listWorld(world), writeFile: () => {}, cwd: "/work/storefront", defaultTimeZone: "UTC", ...deps });
  const activity = result.code === 0 && result.stdout.startsWith("{") ? JSON.parse(result.stdout) : null;
  return { ...result, calls, activity, searches: calls.filter((call) => call.includes("graphql")) };
};
const source = (activity, name) => activity.sources.find((entry) => entry.name === name);
const searchesFor = (searches, pattern) => searches.filter((call) => pattern.test(rawField(call.slice(1), "searchQuery")));

test("refuses with no realm before running any command", () => {
  const result = collectWith(["--dir", "/work"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^collect: refused: no realm given/);
  assert.equal(result.stderr.trim().split("\n").length, 1);
  assert.deepEqual(result.calls, []);
});

test("refuses an org outside the realm, including a lookalike owner, before running any command", () => {
  const result = collectWith([...london, "--scope", "org", "--org", "example-org-evil"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /org example-org-evil is outside the realm \(github.com\/example-org\)/);
  assert.deepEqual(result.calls, []);
});

test("skips checkouts outside the realm and runs nothing on them after reading the origin", () => {
  const { activity, calls } = collectWith(folder);
  assert.deepEqual(activity.scope.skipped, [
    { repository: "example-org-evil/storefront", reason: "outside realm" },
    { repository: "scratch", reason: "no origin remote" },
    { repository: "other-org/tool", reason: "outside realm" },
  ]);
  assert.deepEqual(activity.scope.repositories, ["example-org/billing", "example-org/storefront"]);
  for (const dir of ["/work/lookalike", "/work/scratch", "/work/tool"]) {
    assert.deepEqual(calls.filter((call) => call.includes(dir)), [["git", "-C", dir, "remote", "get-url", "origin"]]);
  }
  assert.equal(calls.filter((call) => call.join(" ").match(/other-org|example-org-evil/)).length, 0);
});

const windowOf = (window, zone = "Europe/London") => [formatZoned(window.since, zone), formatZoned(window.until, zone)];
const periodsAt = (period, at = now, timeZone = "Europe/London") => computePeriods({ period, now: Date.parse(at), timeZone, history: 4 });

test("period math for each kind, weeks starting Monday in local time", () => {
  const last7 = periodsAt("last-7-days");
  assert.deepEqual(windowOf(last7.selected), ["2026-11-17T00:00:00+00:00", "2026-11-24T00:00:00+00:00"]);
  assert.equal(last7.selected.partial, false);
  assert.deepEqual(windowOf(last7.history[3]), ["2026-11-10T00:00:00+00:00", "2026-11-17T00:00:00+00:00"]);

  const current = periodsAt("current-week");
  assert.deepEqual(windowOf(current.selected), ["2026-11-23T00:00:00+00:00", "2026-11-24T12:00:00+00:00"]);
  assert.equal(current.selected.partial, true);
  assert.deepEqual(current.selected.dates, ["2026-11-23", "2026-11-24"]);
  assert.deepEqual(windowOf(current.history[3]), ["2026-11-16T00:00:00+00:00", "2026-11-23T00:00:00+00:00"]);

  assert.deepEqual(windowOf(periodsAt("last-week").selected), ["2026-11-16T00:00:00+00:00", "2026-11-23T00:00:00+00:00"]);
  const last30 = periodsAt("last-30-days");
  assert.deepEqual(windowOf(last30.selected), ["2026-10-25T00:00:00+01:00", "2026-11-24T00:00:00+00:00"]);
  assert.equal(last30.selected.dates.length, 30);

  const custom = periodsAt("2026-11-01..2026-11-07");
  assert.deepEqual(windowOf(custom.selected), ["2026-11-01T00:00:00+00:00", "2026-11-08T00:00:00+00:00"]);
  assert.equal(custom.selected.label, "2026-11-01 to 2026-11-07");
  assert.deepEqual(windowOf(custom.history[3]), ["2026-10-25T00:00:00+01:00", "2026-11-01T00:00:00+00:00"]);
  const open = periodsAt("2026-11-20..2026-11-30");
  assert.deepEqual([open.selected.partial, formatZoned(open.selected.until, "Europe/London")], [true, "2026-11-24T12:00:00+00:00"]);

  const tokyo = periodsAt("current-week", "2026-11-22T20:00:00Z", "Asia/Tokyo");
  assert.deepEqual(windowOf(tokyo.selected, "Asia/Tokyo"), ["2026-11-23T00:00:00+09:00", "2026-11-23T05:00:00+09:00"]);
});

test("DST: a period is whole local days, so a week holds 169 hours in autumn and 167 in spring", () => {
  const autumn = periodsAt("last-7-days", "2026-10-27T12:00:00Z");
  assert.deepEqual(windowOf(autumn.selected), ["2026-10-20T00:00:00+01:00", "2026-10-27T00:00:00+00:00"]);
  assert.equal((autumn.selected.until - autumn.selected.since) / 3_600_000, 169);
  assert.equal((autumn.history[3].until - autumn.history[3].since) / 3_600_000, 168);
  const spring = periodsAt("last-7-days", "2026-04-01T12:00:00Z");
  assert.deepEqual(windowOf(spring.selected), ["2026-03-25T00:00:00+00:00", "2026-04-01T00:00:00+01:00"]);
  assert.equal((spring.selected.until - spring.selected.since) / 3_600_000, 167);
});

test("git log parsing: binary rows, renames, no numstat, optional blank line, quoted odd paths, email filter", () => {
  const emails = new Set(["sample-dev@example.com", "sample-dev@users.noreply.example.com"]);
  const commits = parseGitLog(loadWorld().checkouts.storefront.log, { repository: "example-org/storefront", emails });
  assert.deepEqual(commits.map((commit) => commit.sha), ["c6", "c5", "c2", "c1", "c4"]);
  const bySha = Object.fromEntries(commits.map((commit) => [commit.sha, commit]));
  assert.deepEqual([bySha.c1.added, bySha.c1.removed], [17, 7]);
  assert.deepEqual(bySha.c1.paths, ["src/cart.ts", "assets/logo.png", "src/new/price.ts", '"docs/odd\\036name | {x}.md"']);
  assert.deepEqual([bySha.c2.added, bySha.c2.paths, bySha.c2.at], [1, ["src/cart.ts"], Date.parse("2026-11-19T04:30:00Z")]);
  assert.deepEqual([bySha.c5.added, bySha.c5.paths], [0, []]);
  assert.doesNotMatch(JSON.stringify(commits), /@/);
  assert.equal(renamedPath("lib/{ => tax}/rate.rb"), "lib/tax/rate.rb");
  assert.equal(renamedPath("old name.txt => new name.txt"), "new name.txt");
});

test("every metric on the hand-checked fixture world", () => {
  const { activity } = collectWith(folder);
  assert.deepEqual(activity.metrics, {
    ...{ commits: 4, lines_added: 31, lines_removed: 9, files_changed: 6, active_days: 3 },
    ...{ prs_opened: 4, prs_merged: 3, prs_closed_unmerged: 2, prs_open: 2, pr_cycle_time_median_hours: 24.5 },
    ...{ prs_reviewed: 2, review_comments: 5, comments: 2, issues_created: 3, tasks_created: 1, sub_issues_created: 1, issues_solved: 3 },
  });
  assert.deepEqual(activity.history.map((entry) => entry.metrics), [
    { ...zero, prs_open: 3 },
    { ...zero, prs_open: 3, comments: 1 },
    { ...zero, prs_open: 3, prs_opened: 1, prs_merged: 1, pr_cycle_time_median_hours: 24 },
    { ...zero, prs_open: 3, commits: 1, lines_added: 2, lines_removed: 1, files_changed: 1, prs_reviewed: 1, review_comments: 1, issues_created: 1, issues_solved: 1, active_days: 1 },
  ]);
  assert.deepEqual(activity.history[0], { since: "2026-10-20T00:00:00+01:00", until: "2026-10-27T00:00:00+00:00", partial: false, metrics: { ...zero, prs_open: 3 } });
  const columns = ["date", "commits", "prs_opened", "prs_merged", "reviews", "comments", "issues_created", "issues_solved"];
  assert.deepEqual(activity.daily.map((row) => columns.map((column) => row[column])), [
    ["2026-11-17", 0, 1, 1, 0, 0, 0, 0],
    ["2026-11-18", 1, 1, 1, 1, 1, 1, 0],
    ["2026-11-19", 2, 1, 1, 1, 0, 1, 0],
    ["2026-11-20", 0, 1, 0, 1, 0, 1, 1],
    ["2026-11-21", 1, 0, 0, 0, 1, 0, 2],
    ["2026-11-22", 0, 0, 0, 0, 0, 0, 0],
    ["2026-11-23", 0, 0, 0, 0, 0, 0, 0],
  ]);
  assert.deepEqual(activity.breakdowns, {
    activity_mix: { commits: 4, pull_requests: 4, reviews: 2, comments: 2, issues: 3 },
    issues_by_type: { Bug: 1, Other: 1, Task: 1 },
    pr_outcomes: { merged: 3, open: 2, closed: 2 },
  });
  assert.deepEqual(activity.items.pull_requests.map((pull) => pull.number), [80, 90, 101, 7, 102, 103]);
  assert.deepEqual(activity.items.reviews.map((review) => [review.number, review.state]), [[200, "COMMENTED"], [200, "APPROVED"], [202, "CHANGES_REQUESTED"]]);
  assert.deepEqual(activity.items.issues.map((issue) => `${issue.role} ${issue.number}`), ["created 60", "created 61", "created 62", "solved 61", "solved 70", "solved 71"]);
  assert.deepEqual([activity.subject, activity.period.label, activity.period.partial], [{ login: "sample-dev" }, "Last 7 days", false]);
});

test("one qualifier per search, type ISSUE, __typename requested, and two pages followed by cursor", () => {
  const { searches } = collectWith(folder);
  for (const call of searches) {
    const query = rawField(call.slice(1), "query");
    assert.equal(rawField(call.slice(1), "searchQuery").match(/\b(?:repo|org):/g).length, 1);
    assert.match(query, /type: ISSUE,/);
    assert.match(query, /nodes \{ __typename /);
  }
  const created = searchesFor(searches, /^is:pr author:sample-dev created:.* repo:example-org\/storefront$/);
  assert.deepEqual(created.map((call) => rawField(call.slice(1), "endCursor")), [undefined, "cursor-1"]);
  const enterprise = collectWith([...london, "--realm", "git.example.test/example-org"], {}, { world: { ...loadWorld(), checkouts: { storefront: { ...loadWorld().checkouts.storefront, origin: "git@git.example.test:example-org/storefront.git" } } } });
  assert.ok(enterprise.calls.filter((call) => call[0] === "gh").every((call) => call[1] === "api" && call[2] === "--hostname" && call[3] === "git.example.test"));
});

for (const mode of ["exit", "errors"]) {
  test(`an issueType rejection (${mode}) retries without issueType and parent: type Other, sub-issue unknown`, () => {
    const { activity, searches } = collectWith(folder, { rejectIssueFields: mode });
    assert.ok(searchesFor(searches, /^is:issue/).some((call) => !/issueType|parent/.test(rawField(call.slice(1), "query"))));
    assert.deepEqual([source(activity, "GitHub search: issues created").ok, source(activity, "GitHub search: issue fields").ok], [true, false]);
    assert.deepEqual([activity.metrics.issues_created, activity.metrics.tasks_created, activity.metrics.sub_issues_created, activity.metrics.issues_solved], [3, null, null, 3]);
    assert.equal(activity.breakdowns.issues_by_type, null);
    assert.ok(activity.items.issues.every((issue) => issue.type === "Other" && issue.sub_issue === null));
  });
}

test("truncation: a search over 1,000 results, the page limit, and comments beyond the fetched 100", () => {
  const world = loadWorld();
  world.searches["storefront commented"][0].issueCount = 1500;
  const capped = collectWith(folder, {}, { world, deps: { pageLimit: 1 } }).activity;
  assert.equal(source(capped, "GitHub search: comments").truncated, true);
  assert.equal(source(capped, "GitHub search: pull requests").truncated, true);
  assert.equal(source(capped, "GitHub search: reviews").truncated, false);
  const since = Date.parse("2026-11-01T00:00:00Z");
  const node = (first) => ({ comments: { totalCount: 150, nodes: [{ createdAt: first }] } });
  assert.equal(commentsCut(node("2026-11-05T00:00:00Z"), since), true);
  assert.equal(commentsCut(node("2026-10-05T00:00:00Z"), since), false);
});

test("a failed gh search nulls only the metrics it feeds; a failed gh api user fails every GitHub source", () => {
  const rateLimited = (command, args) => (command === "gh" && /reviewed-by/.test(rawField(args.slice(1), "searchQuery") ?? "") ? "gh: API rate limit exceeded\nretry later" : undefined);
  const { activity, code } = collectWith(folder, { fail: rateLimited });
  assert.equal(code, 0);
  assert.deepEqual(source(activity, "GitHub search: reviews"), { name: "GitHub search: reviews", ok: false, detail: "gh: API rate limit exceeded", truncated: false, metrics: ["prs_reviewed", "review_comments"] });
  assert.deepEqual([activity.metrics.prs_reviewed, activity.metrics.review_comments, activity.metrics.active_days], [null, null, 3]);
  assert.deepEqual([activity.metrics.commits, activity.metrics.prs_merged, activity.breakdowns.activity_mix.reviews], [4, 3, null]);
  assert.ok(activity.daily.every((row) => row.reviews === null && row.commits !== null));
  const signedOut = collectWith(folder, { fail: (command, args) => (command === "gh" && args.includes("user") ? "gh: To get started with GitHub CLI, please run:  gh auth login" : undefined) }).activity;
  assert.equal(signedOut.subject.login, unknownLogin);
  assert.ok(signedOut.sources.slice(1).every((entry) => !entry.ok && entry.detail.startsWith("gh: To get started")));
  assert.deepEqual([signedOut.metrics.commits, signedOut.metrics.prs_opened, signedOut.breakdowns.pr_outcomes], [4, null, null]);
});

const planShape = {
  "": "schema generated_at subject scope period sources metrics daily history breakdowns items",
  scope: "kind label repositories skipped",
  period: "label since until partial time_zone",
  "sources.0": "name ok detail truncated metrics",
  "daily.0": "date commits prs_opened prs_merged reviews comments issues_created issues_solved",
  "history.0": "since until partial metrics",
  "breakdowns": "activity_mix issues_by_type pr_outcomes",
  "breakdowns.activity_mix": "commits pull_requests reviews comments issues",
  "breakdowns.pr_outcomes": "merged open closed",
  items: "pull_requests reviews issues",
  "items.pull_requests.0": "repository number title url state created_at merged_at additions deletions",
  "items.reviews.0": "repository number title url submitted_at state comments",
  "items.issues.0": "repository number title url type sub_issue role state created_at closed_at",
};
const at = (object, path) => path.split(".").filter(Boolean).reduce((value, key) => value?.[key], object);
const keysAt = (object, path) => Object.keys(at(object, path) ?? {}).sort();

test("the output carries exactly the plan's schema 1 keys, and the sample's when it exists", () => {
  const { activity } = collectWith(folder);
  for (const [path, keys] of Object.entries(planShape)) assert.deepEqual(keysAt(activity, path), keys.split(" ").sort(), path);
  assert.deepEqual(Object.keys(activity.metrics), metricKeys);
  assert.ok(activity.history.every((entry) => Object.keys(entry.metrics).join() === metricKeys.join()));
  const samplePath = new URL("./fixtures/activity.sample.json", import.meta.url);
  if (!existsSync(samplePath)) return;
  const sample = JSON.parse(readFileSync(samplePath, "utf8"));
  for (const path of [...Object.keys(planShape), "metrics", "history.0.metrics"]) assert.deepEqual(keysAt(activity, path), keysAt(sample, path), `sample ${path}`);
});
