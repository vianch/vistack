#!/usr/bin/env node

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cell, dailySection, dataTable, day, guideSection, itemSections, legend, pair, pieFigure, pill, stamp, statusPanel } from "./page-parts.mjs";
import { arrayOf, comparisonOf, escapeHtml, html, humanize, isCount, isObject, keyMetrics, labels, lineGeometry, lineSvg, metricDefinitions, sentenceOf, show, trendOf, unitOf, verdictOf } from "./trend-charts.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const baseHtmlPath = join(dirname(scriptPath), "..", "..", "html-report", "assets", "base.html");
const themePath = join(dirname(scriptPath), "..", "assets", "monitoring.css");
const usage = "usage: node render.mjs --data <activity.json> [--out <path>] [--artifact] [--now <iso>]";
const sampleLogin = "sample-dev";
const lineSeries = ["commits", "prs_merged", "prs_reviewed", "issues_solved"];
const mixKinds = [["commits", "Commits", 1], ["comments", "Comments", 6], ["pull_requests", "Pull requests opened", 5], ["issues", "Issues created", 7], ["reviews", "Reviews", 3]];
const spareSlots = [2, 4];
const required = ["subject.login", "scope.label", "period.label", "period.since", "period.until", "period.partial", "sources", "metrics", "daily", "history", "breakdowns", "items"];

export class ReportError extends Error {}

export const parseActivity = (text, path = "activity file") => {
  let activity;
  try {
    activity = JSON.parse(text);
  } catch (error) {
    throw new ReportError(`${path} is not valid JSON: ${error.message}`);
  }
  if (!isObject(activity)) throw new ReportError(`${path} is not a JSON object`);
  if (activity.schema !== 1) throw new ReportError(`${path} has schema ${JSON.stringify(activity.schema ?? null)}; this renderer reads schema 1`);
  for (const key of required) {
    const value = key.split(".").reduce((node, part) => (isObject(node) ? node[part] : undefined), activity);
    if (value === undefined || value === null) throw new ReportError(`${path} is missing the required key ${key}`);
  }
  for (const key of ["sources", "daily", "history"]) {
    if (!Array.isArray(activity[key])) throw new ReportError(`${path}: ${key} must be an array`);
  }
  for (const key of ["metrics", "breakdowns", "items"]) {
    if (!isObject(activity[key])) throw new ReportError(`${path}: ${key} must be an object`);
  }
  return activity;
};

const splitBase = (baseHtml) => {
  const style = baseHtml.match(/<style>\n?([\s\S]*?)\n?<\/style>/);
  const script = baseHtml.match(/<script>\n?([\s\S]*?)\n?<\/script>/);
  if (!style || !script) throw new ReportError("the template has no <style> or <script> block");
  return { style: style[1], script: script[1] };
};

const normalizeNow = (now) => {
  const time = Date.parse(now);
  if (Number.isNaN(time)) throw new ReportError(`--now is not an ISO date: ${now}`);
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");
};


export const render = ({ dataText, baseHtml, themeCss = "", dataPath = "activity.json", now, artifact = false }) => {
  const activity = parseActivity(dataText, dataPath);
  const { style, script } = splitBase(baseHtml);
  const generated = normalizeNow(now);
  const { subject, scope, period, metrics, breakdowns, items } = activity;
  const sources = arrayOf(activity.sources);
  const history = arrayOf(activity.history);
  const partial = period.partial === true;
  const isSample = subject.login === sampleLogin;
  const { current, earlier } = comparisonOf(activity);
  const unit = unitOf(earlier[0] ?? current ?? period);
  const trends = Object.fromEntries(metricDefinitions.map(([key]) => [key, trendOf(key, current?.metrics?.[key], earlier)]));
  const feeds = (key) => sources.filter((source) => Array.isArray(source.metrics) && source.metrics.includes(key));
  const isNone = (key) => metrics[key] === null && feeds(key).length > 0 && feeds(key).every((source) => source.ok !== false);
  const noneText = (key) => (key === "pr_cycle_time_median_hours" ? "none merged" : "none");
  const nowCell = (key) => (isNone(key) ? noneText(key) : cell(key, metrics[key]));
  const sentence = (key) => (!partial && isNone(key) ? `${labels[key]}: ${noneText(key)}.` : sentenceOf(trends[key], unit));
  const notes = (key, inTile = false) =>
    feeds(key)
      .filter((source) => source.truncated === true || source.ok === false)
      .map((source) => {
        const failed = source.ok === false;
        if (inTile) return html`${pill(failed ? "source failed" : "truncated", failed ? "bad" : "warn")}<span class="hint">${source.name}${failed ? "" : ": may be low"}</span>`;
        return failed ? pill(`${source.name} failed`, "bad") : pill(`${source.name} truncated, so this may be low`, "warn");
      });
  const unmapped = sources.filter((source) => source.truncated === true && !Array.isArray(source.metrics));
  const repositories = Array.isArray(scope.repositories) ? scope.repositories : [];
  const skipped = arrayOf(scope.skipped);
  const collectedAt = String(activity.generated_at ?? "not recorded");

  const alertItems = [
    ...sources.filter((source) => source.ok === false).map((source) => ["bad", `${source.name} failed${source.detail ? `: ${source.detail}` : ""}. Its numbers read "not recorded".`, true]),
    ...sources.filter((source) => source.ok !== false && source.truncated === true).map((source) => ["warn", `${source.name} was truncated${source.detail ? ` (${source.detail})` : ""}, so its numbers may be low.`]),
    ...metricDefinitions.filter(([key]) => trends[key].direction === "higher" && trends[key].change === "down").map(([key]) => ["bad", sentenceOf(trends[key], unit)]),
  ];
  const alerts = alertItems.length
    ? html`<section class="alerts" aria-label="Alerts"><ul>${alertItems.map(([tone, text, pulse]) => html`<li data-tone="${tone}"><span class="dot${pulse ? " pulse" : ""}" data-tone="${tone}"></span>${text}</li>`)}</ul></section>`
    : "";

  const title = `${isSample ? "Sample" : scope.label} activity, ${period.label}`;
  const status = statusPanel({ collectedAt, period, scope, skipped, sources });
  const header = html`<header class="split"><div class="head">
<p class="label">Activity report</p>
<h1>${title}</h1>
<p class="lede">${isSample ? "Sample data. " : ""}Activity by ${subject.login} in ${scope.label} (${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"}${skipped.length ? `, ${skipped.length} skipped` : ""}), ${period.label}: ${stamp(period.since)} to ${stamp(period.until)}${period.time_zone ? `, ${period.time_zone} time` : ""}. ${partial ? "Partial period: counts so far." : "Complete period."}</p>
<div class="meta">${partial ? pill("partial period", "warn") : pill("complete period")}${isSample ? pill("sample data", "info") : ""}</div>
</div>
${alerts}${status}</header>`;

  const tileTone = (key) => {
    const fed = feeds(key);
    if (fed.some((source) => source.ok === false)) return "bad";
    if (fed.some((source) => source.truncated === true)) return "warn";
    return partial ? "neutral" : trends[key].tone ?? "neutral";
  };
  const tile = (key, index) => {
    const value = metrics[key];
    const trend = trends[key];
    const verdict = !isCount(value) ? "" : partial ? pill("partial, so far") : pill(verdictOf(trend), trend.tone);
    const average = !partial && isCount(trend.mean) ? html`<span class="hint">average ${show(key, trend.mean)} over ${unit(trend.count)}</span>` : "";
    const hours = key === "pr_cycle_time_median_hours";
    const shown = isCount(value) ? show(hours ? "" : key, value) : isNone(key) ? noneText(key) : "not recorded";
    return html`<div class="tile" style="--i:${index}"><span class="label"><span class="dot" data-tone="${tileTone(key)}"></span>${labels[key]}${hours ? " (hours)" : ""}</span><span class="value${isCount(value) ? "" : " missing"}">${shown}</span>${verdict}${average}${notes(key, true)}</div>`;
  };
  const tableRow = ([key, label]) => {
    const trend = trends[key];
    const change = !partial && isNone(key) ? "" : pill(verdictOf(trend), trend.tone);
    return html`<tr><td>${label}</td><td class="num">${nowCell(key)}</td>${partial ? html`<td class="num">${cell(key, current?.metrics?.[key])}</td>` : ""}<td class="num">${cell(key, trend.mean)}</td><td>${change}${notes(key, true)}</td></tr>`;
  };
  const tiles = html`<section class="block" id="tiles"><h2>Key numbers</h2>
${unmapped.length ? html`<p class="callout" data-tone="warn"><strong>Counts may be low.</strong> ${unmapped.map((source) => source.name).join(", ")} hit a result cap, and the file does not say which numbers it feeds.</p>` : ""}
<div class="tiles">${keyMetrics.map(tile)}</div>
<div class="table"><table><thead><tr><th>Metric</th><th class="num">This period${partial ? " (so far)" : ""}</th>${partial ? html`<th class="num">Last complete period</th>` : ""}<th class="num">Earlier average</th><th>Change</th></tr></thead><tbody>${metricDefinitions.map(tableRow)}</tbody></table></div>
</section>`;

  const comparedRange = current ? `${day(current.since)} to ${day(current.until)}` : "";
  const changed = html`<section class="block" id="changes"><h2>What changed</h2>
${!current
  ? html`<p class="muted">No complete period to compare yet.</p>`
  : html`${partial ? html`<p class="hint">This period is partial, so these sentences compare the last complete period (${comparedRange}) with the ${unit(earlier.length)} before it.</p>` : ""}
<ul class="rows">${keyMetrics.map((key) => html`<li>${sentence(key)}${notes(key)}</li>`)}</ul>`}
</section>`;

  const mixEntries = isObject(breakdowns.activity_mix) ? Object.entries(breakdowns.activity_mix) : [];
  const known = new Map(mixKinds.map(([key, label, slot]) => [key, { label, slot }]));
  const extras = mixEntries.filter(([key]) => !known.has(key));
  const mix = [
    ...mixKinds.filter(([key]) => mixEntries.some(([entry]) => entry === key)).map(([key, label, slot]) => ({ key, label, slot, value: breakdowns.activity_mix[key] })),
    ...extras.map(([key, value], index) => ({ key, label: humanize(key), slot: spareSlots[index] ?? "o", value })),
  ];
  const types = isObject(breakdowns.issues_by_type) ? Object.entries(breakdowns.issues_by_type).map(([key, value], index) => ({ key, label: key, slot: index < 7 ? index + 1 : "o", value })) : [];
  const typesHaveData = types.some((entry) => isCount(entry.value) && entry.value > 0);
  const mixSection = html`<section class="block card" id="mix"><h2>Activity mix</h2>
${mix.length ? pieFigure("mix-pie", "Activity mix", mix, "items") : html`<p class="missing">Activity mix not recorded.</p>`}
</section>`;
  const typesSection = typesHaveData ? html`<section class="block card" id="types"><h2>Issues by type</h2>
${pieFigure("types-pie", "Created issues by type", types, "issues")}
</section>` : "";

  const barSection = dailySection(arrayOf(activity.daily));

  const periods = [
    ...history.map((entry) => ({ label: day(entry.since).slice(5), partial: entry.partial === true, values: isObject(entry.metrics) ? entry.metrics : {} })),
    { label: day(period.since).slice(5), partial, values: metrics },
  ];
  const series = lineSeries.map((key, index) => ({ key, slot: index + 1, label: labels[key], mean: trends[key].mean }));
  const lines = lineGeometry(periods, series);
  const lineLabel = `${series.map((line) => `${line.label}: ${periods.map((entry) => show(line.key, entry.values[line.key])).join(", ")}`).join("; ")}`;
  const lineSection = html`<section class="block card" id="trend"><h2>Over time</h2>
<figure class="figure"><div class="scroll">${lineSvg("trend-lines", lineLabel, lines)}</div>
${legend(series.map((line) => ({ slot: line.slot, text: `${line.label}: ${isNone(line.key) ? noneText(line.key) : show(line.key, metrics[line.key])} now, earlier average ${show(line.key, line.mean)}` })))}
<figcaption>One point per period, labelled by its start date; the last point is the selected period${partial ? ", hollow because it is partial" : ""}. Dashed lines: the earlier average each trend sentence compares against. Scale: baseline y=${lines.baseline}, 0 to ${lines.scaleTop} in steps of ${lines.step}, ${lines.unit} px per item; periods ${lines.gap} px apart. A missing value breaks its line. Source: history and metrics in the activity file.</figcaption>
${dataTable("Numbers per period", ["Period start", ...series.map((line) => line.label)], periods.map((entry) => [`${entry.label}${entry.partial ? " (partial)" : ""}`, ...series.map((line) => cell(line.key, entry.values[line.key]))]))}</figure>
</section>`;

  const [pullRequests, reviews, issues] = itemSections(items, breakdowns);

  const page = html`<div class="page">
${header}
<main class="stack">
${tiles}
${changed}
${pair(barSection, mixSection)}
${pair(lineSection, typesSection)}
${pullRequests}
${reviews}
${issues}
${guideSection(period.time_zone)}
</main>
<footer class="sources"><span>Activity file <code>${basename(dataPath)}</code>, collected <time datetime="${collectedAt}">${collectedAt}</time>.</span><span>Sources named in it: ${sources.length ? sources.map((source) => `${source.name}${source.ok === false ? " (failed)" : ""}${source.truncated === true ? " (truncated)" : ""}`).join("; ") : "none"}.</span><span>Generated <time datetime="${generated}">${generated}</time>. Every number on this page comes from the activity file.</span></footer>
</div>`;

  const fragment = `<title>${escapeHtml(title)}</title>\n${artifact ? '<meta name="claude:viewport-fit-sides" content="cover">\n' : ""}<style>\n${style}\n</style>\n<style>\n${themeCss.replace(/\/\*[\s\S]*?\*\/\n?/g, "")}\n</style>\n\n${page.text}\n\n<script>\n${script}\n</script>\n`;
  if (artifact) return fragment;
  return `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${fragment}`;
};

const parseArgs = (argv) => {
  const options = { artifact: false, help: false };
  const valued = { "--data": "data", "--out": "out", "--now": "now" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--artifact") {
      options.artifact = true;
    } else if (flag === "--help" || flag === "-h") {
      options.help = true;
    } else if (valued[flag] && argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) {
      options[valued[flag]] = argv[index + 1];
      index += 1;
    } else {
      throw new ReportError(`unexpected argument ${flag}. ${usage}`);
    }
  }
  if (!options.help && !options.data) throw new ReportError(`--data is required. ${usage}`);
  return options;
};

const readInput = (path, label) => {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new ReportError(`cannot read ${label} ${path}: ${error.code ?? error.message}`);
  }
};

const main = () => {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage}\n`);
      return;
    }
    const output = render({
      dataText: readInput(options.data, "activity file"),
      baseHtml: readInput(baseHtmlPath, "template"),
      themeCss: readInput(themePath, "theme"),
      dataPath: options.data,
      now: options.now ?? new Date().toISOString(),
      artifact: options.artifact,
    });
    if (!options.out) {
      process.stdout.write(output);
      return;
    }
    mkdirSync(dirname(resolve(options.out)), { recursive: true });
    writeFileSync(options.out, output);
    process.stdout.write(`wrote ${options.out} (${Buffer.byteLength(output)} bytes)\n`);
  } catch (error) {
    process.stderr.write(`render: ${String(error?.message ?? error).replace(/\s+/g, " ")}\n`);
    process.exitCode = 1;
  }
};

const invokedDirectly = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(scriptPath);
  } catch {
    return false;
  }
};

if (invokedDirectly()) main();
