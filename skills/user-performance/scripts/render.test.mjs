import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { barGeometry, comparisonOf, foldSlices, lineGeometry, pieGeometry, sentenceOf, trendOf, unitOf } from "./trend-charts.mjs";
import { render } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "render.mjs");
const fixture = join(here, "fixtures", "activity.sample.json");
const baseHtml = readFileSync(resolve(here, "../../html-report/assets/base.html"), "utf8");
const themeCss = readFileSync(resolve(here, "../assets/monitoring.css"), "utf8");
const sample = readFileSync(fixture, "utf8");
const scratch = mkdtempSync(join(tmpdir(), "user-performance-render-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const now = "2026-11-24T12:00:00Z";
const week = { since: "2026-11-10T00:00:00+00:00", until: "2026-11-17T00:00:00+00:00" };
const weeks = unitOf(week);
const earlier = (...values) => values.map((value) => ({ ...week, metrics: { prs_merged: value, pr_cycle_time_median_hours: value, commits: value } }));
const activityWith = (change) => {
  const activity = JSON.parse(sample);
  change(activity);
  return activity;
};
const page = (change = () => {}) => render({ dataText: JSON.stringify(activityWith(change)), baseHtml, themeCss, now });
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
const write = (name, content) => {
  const path = join(scratch, name);
  writeFileSync(path, content);
  return path;
};
const tilesOf = (output) => output.match(/<div class="tiles">([\s\S]*?)<\/div>\n<div class="table">/)[1];

describe("trend rule", () => {
  test("each direction class colours its verdict, and inputs stay uncoloured", () => {
    assert.deepEqual([trendOf("prs_merged", 6, earlier(4, 4)).change, trendOf("prs_merged", 6, earlier(4, 4)).tone], ["up", "ok"]);
    assert.equal(trendOf("prs_merged", 6, earlier(4, 4)).percent, 50);
    assert.deepEqual([trendOf("prs_merged", 2, earlier(4)).change, trendOf("prs_merged", 2, earlier(4)).tone], ["down", "bad"]);
    assert.equal(trendOf("pr_cycle_time_median_hours", 60, earlier(40)).tone, "bad");
    assert.equal(trendOf("pr_cycle_time_median_hours", 30, earlier(40)).tone, "ok");
    const input = trendOf("commits", 20, earlier(10));
    assert.equal(input.change, "up");
    assert.equal(input.tone, null);
  });

  test("a change under 5% is flat and exactly 5% is not", () => {
    assert.equal(trendOf("prs_merged", 104.9, earlier(100)).state, "flat");
    assert.equal(trendOf("prs_merged", 95.1, earlier(100)).state, "flat");
    assert.deepEqual([trendOf("prs_merged", 105, earlier(100)).state, trendOf("prs_merged", 105, earlier(100)).change], ["changed", "up"]);
    assert.equal(trendOf("prs_merged", 95, earlier(100)).change, "down");
    assert.equal(trendOf("prs_merged", 7, earlier(6, 7, 7)).state, "changed");
    assert.equal(trendOf("prs_merged", 7, earlier(6, 7, 7)).tone, "ok");
  });

  test("empty baseline, zero mean, and nulls in history", () => {
    const empty = trendOf("prs_merged", 3, []);
    assert.equal(empty.state, "no-baseline");
    assert.equal(sentenceOf(empty, weeks), "Merged pull requests: 3; no earlier period to compare.");
    const fromNone = trendOf("prs_merged", 3, earlier(0, 0));
    assert.equal(fromNone.tone, "ok");
    assert.equal(sentenceOf(fromNone, weeks), "Merged pull requests: 3, up from none over the previous 2 weeks.");
    assert.equal(sentenceOf(trendOf("prs_merged", 0, earlier(0)), weeks), "Merged pull requests: none in either this period or the previous 1 week.");
    assert.equal(trendOf("prs_merged", 0, earlier(0)).tone, null);
    const gap = trendOf("prs_merged", 4, earlier(null, 2));
    assert.deepEqual([gap.count, gap.mean], [1, 2]);
    assert.equal(sentenceOf(trendOf("prs_merged", null, earlier(2)), weeks), "Merged pull requests: not recorded.");
  });

  test("sentences state both numbers, and a week across a clock change is still a week", () => {
    assert.equal(sentenceOf(trendOf("prs_merged", 5, earlier(3, 4, 3, 4)), weeks), "Merged pull requests: 5, up from an average of 3.5 over the previous 4 weeks.");
    assert.equal(unitOf({ since: "2026-10-20T00:00:00+01:00", until: "2026-10-27T00:00:00+00:00" })(2), "2 weeks");
  });

  test("a partial period is compared through the last complete one and never averaged", () => {
    const partial = activityWith((activity) => (activity.period.partial = true));
    const { current, earlier: before } = comparisonOf(partial);
    assert.equal(current.since, partial.history[3].since);
    assert.equal(before.length, 3);
    const output = page((activity) => (activity.period.partial = true));
    assert.ok(output.includes("Merged pull requests: 3, up from an average of 2.3 over the previous 3 weeks."));
    const tiles = tilesOf(output);
    assert.equal((tiles.match(/<span class="pill">partial, so far<\/span>/g) ?? []).length, 8);
    assert.doesNotMatch(tiles, /data-tone="(ok|bad)"/);
    const skipped = page((activity) => (activity.history[1].partial = true));
    assert.ok(skipped.includes("Merged pull requests: 3, up from an average of 2.3 over the previous 3 weeks."));
  });
});

describe("chart geometry", () => {
  test("a pie folds everything past 5 named slices into Other and keeps the fixed order", () => {
    const entries = [3, 9, 2, 8, 7, 4, 6, 5].map((value, index) => ({ key: `k${index}`, label: "ABCDEFGH"[index], slot: index + 1, value }));
    const { slices, total } = foldSlices(entries);
    assert.deepEqual(slices.map((slice) => slice.label), ["B", "D", "E", "G", "H", "Other"]);
    assert.deepEqual(slices.at(-1).members, ["A", "C", "F"]);
    assert.equal(slices.at(-1).value, 9);
    assert.equal(total, 44);
    assert.equal(foldSlices(entries.slice(0, 6)).slices.length, 6);
    assert.deepEqual(foldSlices([{ label: "A", value: null }, { label: "B", value: 2 }]).missing.map((entry) => entry.label), ["A"]);
  });

  test("pie arcs start at 12 o'clock and run clockwise", () => {
    const halves = pieGeometry(foldSlices([{ label: "A", slot: 1, value: 1 }, { label: "B", slot: 2, value: 1 }]).slices);
    assert.deepEqual(halves.arcs.map((arc) => arc.d), ["M84 84L84 4A80 80 0 0 1 84 164Z", "M84 84L84 164A80 80 0 0 1 84 4Z"]);
    const large = pieGeometry([{ label: "A", value: 3 }, { label: "B", value: 1 }]);
    assert.equal(large.arcs[0].d, "M84 84L84 4A80 80 0 1 1 4 84Z");
    assert.equal(pieGeometry([{ label: "A", value: 5 }, { label: "B", value: 0 }]).arcs[0].circle, true);
  });

  test("stacked bars share one scale from the baseline", () => {
    const kinds = [{ key: "a", label: "A", slot: 1 }, { key: "b", label: "B", slot: 2 }];
    const bars = barGeometry([{ date: "2026-11-17", a: 2, b: 1 }, { date: "2026-11-18", a: 4, b: null }], kinds);
    assert.deepEqual([bars.scaleTop, bars.step, bars.unit, bars.width], [4, 1, 46, 680]);
    assert.deepEqual(bars.ticks.map((tick) => tick.y), [200, 154, 108, 62, 16]);
    assert.deepEqual(bars.columns[0].segments.map(({ y, height }) => [y, height]), [[108, 92], [62, 46]]);
    assert.deepEqual([bars.columns[0].x, bars.columns[1].x, bars.columns[1].top], [183, 501, 16]);
    assert.equal(bars.columns[1].segments.length, 1);
  });

  test("line points, the dashed mean, and a gap where a value is missing", () => {
    const periods = [{ label: "10-20", values: { m: 2 } }, { label: "10-27", values: { m: null } }, { label: "11-03", partial: true, values: { m: 4 } }];
    const lines = lineGeometry(periods, [{ key: "m", slot: 1, label: "M", mean: 3 }]);
    assert.deepEqual(lines.xs, [52, 354, 656]);
    assert.deepEqual(lines.lines[0].paths, ["M52 108", "M656 16"]);
    assert.equal(lines.lines[0].meanY, 62);
    assert.equal(lines.lines[0].points.at(-1).partial, true);
    assert.equal(lines.width, 680);
    assert.deepEqual(lines.labels, ["10-20", "10-27", "11-03"]);
  });
});

describe("command line", () => {
  test("the same input and --now give byte-identical output", () => {
    const args = [script, "--data", fixture, "--now", now];
    assert.ok(execFileSync(process.execPath, args).equals(execFileSync(process.execPath, args)));
  });

  test("--artifact drops the doctype and meta lines and starts with the title", () => {
    const result = run(["--data", fixture, "--now", now, "--artifact"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.startsWith("<title>"));
    assert.ok(result.stdout.startsWith('<title>Sample activity, Last 7 days</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'));
    assert.equal((result.stdout.match(/<meta\b/g) ?? []).length, 1);
    assert.doesNotMatch(result.stdout, /<!doctype|<(?:html|head|body)[\s>]/i);
  });

  test("writes a full document to --out, creating the directory", () => {
    const out = join(scratch, "nested", "page.html");
    const result = run(["--data", fixture, "--now", now, "--out", out]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(out, "utf8"), /^<!doctype html>\n<html lang="en">\n<meta charset="utf-8">/);
    assert.doesNotMatch(readFileSync(out, "utf8"), /claude:viewport/);
  });

  test("bad input exits non-zero with one line", () => {
    for (const args of [["--data", write("v2.json", '{"schema":2}')], ["--data", join(scratch, "absent.json")], ["--data", fixture, "--now", "yesterday"], ["--nope"], []]) {
      const result = run(args);
      assert.equal(result.status, 1);
      assert.equal(result.stderr.trim().split("\n").length, 1);
      assert.match(result.stderr, /^render: /);
    }
  });
});
