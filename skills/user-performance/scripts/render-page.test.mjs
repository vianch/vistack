import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseActivity, render } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const baseHtml = readFileSync(resolve(here, "../../html-report/assets/base.html"), "utf8");
const themeCss = readFileSync(resolve(here, "../assets/monitoring.css"), "utf8");
const sample = readFileSync(join(here, "fixtures", "activity.sample.json"), "utf8");
const now = "2026-11-24T12:00:00Z";
const activityWith = (change) => {
  const activity = JSON.parse(sample);
  change(activity);
  return activity;
};
const page = (change = () => {}) => render({ dataText: JSON.stringify(activityWith(change)), baseHtml, themeCss, now });
const tilesOf = (output) => output.match(/<div class="tiles">([\s\S]*?)<\/div>\n<div class="table">/)[1];
const tileFor = (output, label) => tilesOf(output).split('<div class="tile"').find((tile) => tile.includes(`</span>${label}`));
const selfContained = /(src|href)="https?:|url\(["']?(https?:|\/\/)|@import|<link/;

describe("page", () => {
  const output = page();

  test("draws two pies, a bar chart, and a line chart as sized, labelled SVG", () => {
    assert.equal((output.match(/^<svg/gm) ?? []).length, 4);
    for (const id of ["mix-pie", "types-pie", "daily-bars", "trend-lines"]) assert.match(output, new RegExp(`<svg class="chart[^"]*" id="${id}"`));
    for (const [, width, height, boxWidth, boxHeight] of output.matchAll(/<svg[^>]* width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)" role="img" aria-label="[^"]+"><title>/g)) {
      assert.deepEqual([width, height], [boxWidth, boxHeight]);
    }
    assert.equal((output.match(/role="img" aria-label="[^"]+"><title>/g) ?? []).length, 4);
    assert.equal((page((activity) => (activity.breakdowns.issues_by_type = {})).match(/^<svg/gm) ?? []).length, 3);
  });

  test("wide charts stop shrinking at 30rem and scroll sideways inside their wrapper", () => {
    assert.match(themeCss, /^\.chart\.wide\{min-width:30rem\}$/m);
    assert.equal((output.match(/<div class="scroll">\n<svg class="chart wide" id="(daily-bars|trend-lines)"/g) ?? []).length, 2);
    assert.equal((output.match(/<svg class="chart wide"/g) ?? []).length, 2);
  });

  test("labels the legends with values and shares, the peak day, and each period", () => {
    assert.match(output, /<span class="key k1"><\/span>Commits: 14 \(50%\)<\/li>/);
    assert.match(output, /<span class="key k5"><\/span>Pull requests opened: 4 \(14%\)<\/li>/);
    const bars = output.match(/<svg class="chart wide" id="daily-bars"[\s\S]*?<\/svg>/)[0];
    assert.equal((bars.match(/<text class="value"[^>]*>8<\/text>/g) ?? []).length, 2);
    assert.match(bars, /<text x="81" y="216">11-17<\/text>/);
    assert.match(output, /Scale: baseline y=200, 0 to 8 in steps of 2, 23 px per item; bars 24 px wide, 66 px apart/);
    assert.match(output, /<svg class="chart wide" id="daily-bars" width="674" height="224" viewBox="0 0 674 224"/);
    assert.match(output, /<svg class="chart wide" id="trend-lines" width="680" height="224" viewBox="0 0 680 224"/);
    assert.match(output, /periods 151 px apart/);
  });

  test("a pie with every value null reads not recorded, and one with only zeros reads none", () => {
    const nulls = page((activity) => (activity.breakdowns.activity_mix = { commits: null, reviews: null }));
    assert.match(nulls, /Activity mix: not recorded\./);
    const zeros = page((activity) => (activity.breakdowns.activity_mix = { commits: 0, reviews: null }));
    assert.match(zeros, /Activity mix: none in this period\. Not recorded: Reviews\./);
  });

  test("names the page without a colon, and labels sample data only for the sample login", () => {
    assert.match(output, /<title>Sample activity, Last 7 days<\/title>\n/);
    assert.match(output, /<h1>Sample activity, Last 7 days<\/h1>/);
    assert.match(output, /<p class="lede">Sample data\. Activity by sample-dev/);
    const real = page((activity) => (activity.subject.login = "someone"));
    assert.match(real, /<title>example-org checkouts activity, Last 7 days<\/title>/);
    assert.doesNotMatch(real, /Sample (data|activity)/i);
  });

  test("a null metric reads not recorded, never 0", () => {
    assert.match(output, /<tr><td>Comments<\/td><td class="num"><span class="missing">not recorded<\/span><\/td>/);
    assert.match(output, /Not recorded: Comments\./);
    const missing = page((activity) => {
      activity.metrics.prs_merged = null;
      activity.sources[1].ok = false;
    });
    assert.match(tileFor(missing, "Merged pull requests"), /<span class="value missing">not recorded<\/span>/);
    assert.ok(missing.includes("<li>Merged pull requests: not recorded."));
  });

  test("a truncated source is named next to the numbers it feeds, or above the tiles when unmapped", () => {
    assert.match(tileFor(output, "Pull requests reviewed"), /data-tone="warn">truncated<\/span><span class="hint">GitHub search: reviews: may be low<\/span>/);
    assert.match(output, /<tr><td>Pull requests reviewed<\/td>.*truncated<\/span><span class="hint">GitHub search: reviews: may be low/);
    assert.match(output, /<li>Pull requests reviewed: .*GitHub search: reviews truncated, so this may be low/);
    assert.doesNotMatch(tileFor(output, "Commits"), /truncated/);
    const unmapped = page((activity) => delete activity.sources[2].metrics);
    assert.match(unmapped, /<strong>Counts may be low\.<\/strong> GitHub search: reviews hit a result cap/);
    assert.doesNotMatch(tileFor(unmapped, "Pull requests reviewed"), /truncated/);
  });

  test("escapes every data string and links only http(s) URLs", () => {
    const hostile = '<script>alert("x")</script> & \'q\'';
    const escaped = page((activity) => {
      activity.items.pull_requests[0].title = hostile;
      activity.items.pull_requests[0].url = "javascript:alert(1)";
      activity.scope.label = "<img src=x onerror=alert(1)>";
      activity.breakdowns.issues_by_type = { "<b>Bug</b>": 2 };
      activity.sources[0].name = '"><script>';
    });
    assert.ok(!escaped.includes(hostile));
    assert.ok(escaped.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;"));
    assert.doesNotMatch(escaped, /href="javascript:|<img|<b>Bug/);
    assert.equal((escaped.match(/<script\b/gi) ?? []).length, 1);
  });

  test("a split header carries a snapshot status panel with one row per source", () => {
    const status = output.match(/<aside class="status"[\s\S]*?<\/aside>/)[0];
    assert.match(status, /<p class="label">Snapshot, not live<\/p>/);
    assert.match(status, /The page does not refresh\./);
    assert.doesNotMatch(output, /auto-refresh|live update|refreshes every/i);
    assert.deepEqual([...status.matchAll(/<span class="dot" data-tone="(\w+)"><\/span>[^<]*<span class="state">(\w+)<\/span>/g)].map((match) => `${match[1]} ${match[2]}`), ["ok ok", "ok ok", "warn truncated", "bad failed", "ok ok", "warn skipped"]);
  });

  test("the alert strip lists failed and truncated sources and dropped higher-is-better metrics, only when warranted", () => {
    const alerts = output.match(/<\/div>\n(<section class="alerts"[\s\S]*?<\/section>)<aside class="status"/)[1];
    assert.match(alerts, /<li data-tone="bad"><span class="dot pulse" data-tone="bad"><\/span>GitHub search: comments failed: HTTP 502/);
    assert.match(alerts, /<li data-tone="warn"><span class="dot" data-tone="warn"><\/span>GitHub search: reviews was truncated/);
    assert.match(alerts, /<li data-tone="bad"><span class="dot" data-tone="bad"><\/span>Issues solved: 3, down from an average of 4/);
    assert.equal((alerts.match(/<li /g) ?? []).length, 3);
    const calm = page((activity) => {
      activity.sources.forEach((source) => Object.assign(source, { ok: true, truncated: false }));
      activity.history.forEach((entry) => (entry.metrics.issues_solved = 3));
    });
    assert.doesNotMatch(calm, /class="alerts"/);
  });

  test("tiles carry a status dot and a stagger index, and charts sit in an asymmetric grid", () => {
    assert.match(tilesOf(output), /^<div class="tile" style="--i:0"><span class="label"><span class="dot" data-tone="ok"><\/span>Merged pull requests/);
    assert.match(tileFor(output, "Issues solved"), /data-tone="bad"/);
    assert.match(output, /<div class="dash"><section class="block card" id="daily">[\s\S]*?<section class="block card" id="mix">/);
    assert.match(output, /<div class="dash"><section class="block card" id="trend">[\s\S]*?<section class="block card" id="types">/);
    assert.match(themeCss, /@media \(min-width:48rem\)\{[^\n]*\.dash\{grid-template-columns:minmax\(0,2fr\) minmax\(15rem,1fr\)\}/);
  });

  test("a null whose sources all answered reads none; a null whose source failed reads not recorded", () => {
    const empty = page((activity) => (activity.metrics.pr_cycle_time_median_hours = null));
    assert.match(tileFor(empty, "Median PR cycle time"), /<span class="value missing">none merged<\/span>/);
    assert.ok(empty.includes("<li>Median PR cycle time: none merged.</li>"));
    assert.match(empty, /<tr><td>Median PR cycle time<\/td><td class="num">none merged<\/td>/);
    assert.match(empty, /<tr><td>Comments<\/td><td class="num"><span class="missing">not recorded<\/span>/);
  });

  test("uses no emoji or decorative glyph characters, and pills mark tone with a round dot", () => {
    assert.doesNotMatch(output, /[\u2190-\u21FF\u2580-\u27BF\u2B00-\u2BFF\u{1F000}-\u{1FAFF}]/u);
    assert.match(themeCss, /\.pill\[data-tone\]::before\{[^}]*border-radius:50%;clip-path:none/);
  });

  test("the theme keeps every colour inside its three theme blocks, with no pure black", () => {
    const blocks = [/^:root\{[^}]*\}/m, /^@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{[^}]*\}\}/m, /^:root\[data-theme="dark"\]\{[^}]*\}/m];
    for (const block of blocks) assert.match(themeCss.match(block)[0], /--bg:[^;]+;[\s\S]*--shadow-card:0 2px 12px rgba\([^)]+\);/);
    const rules = blocks.reduce((css, block) => css.replace(block, ""), themeCss);
    assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    assert.doesNotMatch(themeCss, /#000(000)?\b|rgba?\(0, ?0, ?0/i);
    assert.match(themeCss, /^\/\* Design source: skills\/user-performance\/assets\/DESIGN\.md/);
    assert.doesNotMatch(output, /\/\* Design source|skills\//);
  });

  test("the footer names the data file by its base name and collection time, never its directory", () => {
    for (const dataPath of ["skills/user-performance/scripts/fixtures/activity.sample.json", ".claude/state/reports/user-performance-last-7-days.json"]) {
      const nested = render({ dataText: sample, baseHtml, themeCss, dataPath, now });
      const name = dataPath.split("/").at(-1).replace(/\./g, "\\.");
      assert.match(nested, new RegExp(`Activity file <code>${name}</code>, collected <time datetime="2026-11-24T09:00:00Z">`));
      assert.doesNotMatch(nested, /skills\/|\.claude\/state|reports\/|fixtures\//);
    }
  });

  test("is self-contained: the only remote URLs are evidence links", () => {
    assert.match(output, /<a href="https:\/\/example\.com\//);
    assert.doesNotMatch(output.replace(/<a href="https?:\/\/[^"]*"/g, ""), selfContained);
  });

  test("validates the schema and required keys", () => {
    assert.throws(() => parseActivity(JSON.stringify({ schema: 2 }), "a.json"), /a\.json has schema 2; this renderer reads schema 1/);
    assert.throws(() => parseActivity(JSON.stringify(activityWith((activity) => delete activity.period.label)), "a.json"), /missing the required key period\.label/);
    assert.throws(() => parseActivity(JSON.stringify(activityWith((activity) => (activity.daily = {}))), "a.json"), /daily must be an array/);
    assert.throws(() => parseActivity("{nope", "a.json"), /not valid JSON/);
  });
});
