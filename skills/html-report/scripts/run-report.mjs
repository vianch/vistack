#!/usr/bin/env node
// Reuses the <style> and <script> blocks of ../assets/base.html verbatim.
// Output must depend only on the inputs and --now: tests assert byte-identical reruns.

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const baseHtmlPath = join(dirname(scriptPath), "..", "assets", "base.html");
const usage = "usage: node run-report.mjs --state <json> --ledger <tsv> [--out <path>] [--artifact] [--now <iso>]";
const emptyCell = "—";
const ledgerColumns = ["ts", "phase", "slice", "decision", "reason", "evidence", "result"];
const phaseOrder = ["planned", "dispatched", "implementing", "pr-open", "qa", "audit", "merge-ready", "blocked", "paused"];
const resultTones = { ok: "ok", applied: "ok", reconciled: "ok", failed: "bad", blocked: "bad", skipped: "warn", void: "neutral" };
const shownStateKeys = new Set([
  "slug", "playbook", "phase", "host", "objective", "request", "finish_condition", "unchanged", "slices",
  "issue", "mode", "base_branch", "branch", "worktree", "permissions", "withheld", "escape_hatch",
]);
const fileExtensions = "md|mdx|py|json|jsonl|ts|tsx|js|jsx|mjs|cjs|html|css|txt|tsv|csv|log|png|jpe?g|gif|svg|diff|patch|ya?ml|toml|sh|rs|go|rb|java|kt|swift|sql";
const pointerPattern = new RegExp(
  [
    String.raw`(https?:\/\/[^\s<>"'\x60]+)`,
    String.raw`\b([0-9a-f]{7,40})\b`,
    String.raw`(\/?(?:[\w@.*~+-]+\/)+[\w@.*~+-]+(?::\d+(?:-\d+)?)?|[\w*+-]+(?:\.[\w-]+)*\.(?:${fileExtensions})(?![\w-])(?::\d+(?:-\d+)?)?)`,
  ].join("|"),
  "g",
);

export class ReportError extends Error {}

class Html {
  constructor(text) {
    this.text = text;
  }
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

const fill = (value) => {
  if (value instanceof Html) return value.text;
  if (Array.isArray(value)) return value.map(fill).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(value);
};

const html = (strings, ...values) =>
  new Html(strings.reduce((out, part, index) => out + part + (index < values.length ? fill(values[index]) : ""), ""));

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isEmpty = (value) => value === undefined || value === null || value === "" || value === emptyCell || value === "-";
const textOf = (value) => {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
};
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const countBy = (values) => values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map());
const humanize = (slug) =>
  slug.split(/[-_\s]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");

export const parseLedger = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const cells = line.split("\t");
      return Object.fromEntries(
        ledgerColumns.map((column, index) => {
          const cell = (index < 6 ? cells[index] : cells.slice(6).join(" ")) ?? "";
          return [column, cell.trim() === "" ? emptyCell : cell.trim()];
        }),
      );
    });

export const parseState = (text, path = "state file") => {
  let state;
  try {
    state = JSON.parse(text);
  } catch (error) {
    throw new ReportError(`${path} is not valid JSON: ${error.message}`);
  }
  if (!isObject(state)) throw new ReportError(`${path} is not a JSON object`);
  return state;
};

const slicesOf = (state) => {
  if (Array.isArray(state.slices)) {
    return state.slices.filter(isObject).map((slice, index) => [textOf(slice.name) ?? textOf(slice.slug) ?? `slice-${index + 1}`, slice]);
  }
  if (isObject(state.slices)) {
    return Object.entries(state.slices).map(([name, slice]) => [name, isObject(slice) ? slice : { phase: slice }]);
  }
  return [];
};

const phaseOf = (slice) => textOf(slice.phase) ?? textOf(slice.status);

const phaseTone = (phase) => {
  if (!phase) return "neutral";
  if (/^(merge-ready|merged|done|applied|complete)/.test(phase)) return "ok";
  if (/^(blocked|failed)/.test(phase)) return "bad";
  if (/^paused/.test(phase)) return "warn";
  return phase === "planned" ? "neutral" : "info";
};

const resultTone = (result) => resultTones[result.toLowerCase()] ?? "neutral";

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

const tokenize = (text) => {
  const parts = [];
  let cursor = 0;
  for (const match of text.matchAll(pointerPattern)) {
    let [token] = match;
    if (match[2] && !(/[a-f]/.test(token) && /\d/.test(token))) continue;
    if (!match[2]) token = token.replace(/[.,;:!?)\]]+$/, "");
    if (token === "") continue;
    parts.push({ kind: "text", value: text.slice(cursor, match.index) });
    parts.push({ kind: match[1] ? "link" : match[2] ? "commit" : "path", value: token });
    cursor = match.index + token.length;
  }
  parts.push({ kind: "text", value: text.slice(cursor) });
  return parts.filter((part) => part.value !== "");
};

const renderPointer = (part) => {
  if (part.kind === "link") return html`<a href="${part.value}" rel="noopener" target="_blank">${part.value}</a>`;
  if (part.kind === "text") return part.value;
  return html`<code>${part.value}</code>`;
};

const withBreaks = (text) => text.split("\\n").flatMap((line, index) => (index === 0 ? [line] : [html`<br>`, line]));

const renderEvidence = (text) => {
  if (isEmpty(text)) return html`<span class="missing">none recorded</span>`;
  return text.split("\\n").flatMap((line, index) => [index === 0 ? "" : html`<br>`, ...tokenize(line).map(renderPointer)]);
};

const formatValue = (value, depth = 0) => {
  if (value === null || value === undefined || value === "") return html`<span class="missing">not recorded</span>`;
  if (typeof value !== "object") return renderEvidence(String(value));
  if (Array.isArray(value)) {
    if (value.length === 0) return html`<span class="missing">empty</span>`;
    if (value.every((item) => typeof item !== "object" || item === null)) {
      return value.flatMap((item, index) => [index === 0 ? "" : ", ", renderEvidence(String(item))]);
    }
  }
  if (depth >= 2 || Array.isArray(value)) return html`<pre><code>${JSON.stringify(value, null, 2)}</code></pre>`;
  const entries = Object.entries(value);
  if (entries.length === 0) return html`<span class="missing">empty</span>`;
  return html`<dl class="kv">${entries.map(([key, item]) => html`<dt>${key}</dt><dd>${formatValue(item, depth + 1)}</dd>`)}</dl>`;
};

const formatSpan = (rows) => {
  const times = rows.map((row) => Date.parse(row.ts)).filter((time) => !Number.isNaN(time));
  if (times.length < 2) return times.length === 1 ? "one timestamp" : "no valid timestamps";
  const minutes = Math.round((Math.max(...times) - Math.min(...times)) / 60000);
  if (minutes < 60) return `over ${minutes} min`;
  if (minutes < 1440) return `over ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `over ${Math.floor(minutes / 1440)} d ${Math.floor((minutes % 1440) / 60)} h`;
};

const advisorCheckpoints = (rows) =>
  rows
    .filter((row) => row.decision.startsWith("advisor-") && row.decision !== "advisor-unavailable")
    .map((row) => (row.decision === "advisor-consulted" ? row.reason.split(/\s+/)[0] : row.decision.slice("advisor-".length)));

const needsAttention = (row) =>
  row.decision === "escalated" || row.decision === "step-skipped" || ["failed", "blocked"].includes(row.result.toLowerCase());

const attentionLabel = (row) => {
  if (row.decision === "escalated") return ["escalated", "bad"];
  if (row.decision === "step-skipped") return ["skipped step", "warn"];
  return [row.result.toLowerCase(), "bad"];
};

const orderPhases = (phases) => {
  const unique = [...new Set(phases)];
  const known = phaseOrder.filter((phase) => unique.includes(phase));
  return [...known, ...unique.filter((phase) => !phaseOrder.includes(phase))];
};

const sliceLabel = (slice) => (isEmpty(slice) ? "run" : slice);

const collectPointers = (state, slices, rows) => {
  const pointers = new Map();
  const add = (text, citedBy) => {
    if (isEmpty(text)) return;
    for (const part of tokenize(String(text))) {
      if (part.kind === "text") continue;
      const entry = pointers.get(part.value) ?? { ...part, citedBy: [] };
      entry.citedBy.push(citedBy);
      pointers.set(part.value, entry);
    }
  };
  add(textOf(state.issue), "state: issue");
  add(textOf(state.worktree), "state: worktree");
  for (const [name, slice] of slices) {
    add(textOf(slice.pr), `state: ${name} PR`);
    add(textOf(slice.worktree), `state: ${name} worktree`);
  }
  rows.forEach((row, index) => add(row.evidence, `ledger row ${index + 1}`));
  return [...pointers.values()];
};

const timeLabel = (ts, multiDay) => {
  const match = ts.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return ts;
  return multiDay ? `${match[2]}-${match[3]} ${match[4]}:${match[5]}` : `${match[4]}:${match[5]}:${match[6]}`;
};

const markdownSummary = ({ title, state, phase, slices, rows, counts, attention, now, statePath, ledgerPath }) => {
  const line = (label, value) => `- ${label}: ${value ?? "not recorded"}`;
  const flat = (value) => String(value).replace(/\s*\n\s*/g, " ");
  return [
    `# ${title}`,
    "",
    ...(textOf(state.objective) ?? textOf(state.request) ? [flat(textOf(state.objective) ?? textOf(state.request)), ""] : []),
    line("Slug", textOf(state.slug)),
    line("Playbook", textOf(state.playbook)),
    line("Phase", phase),
    line("Host", textOf(state.host)),
    line("Done when", textOf(state.finish_condition)),
    line("Must not change", textOf(state.unchanged)),
    "",
    "## Counts",
    line("Slices", counts.slices),
    line("Ledger rows", rows.length),
    line("Advisor consultations", counts.advisor),
    line("Skipped steps", counts.skipped),
    line("Failed or blocked", counts.failed),
    "",
    "## Slices",
    ...(slices.length ? slices.map(([name, slice]) => `- ${name}: ${phaseOf(slice) ?? "phase not recorded"}`) : ["- none recorded"]),
    "",
    "## Needs attention",
    ...(attention.length ? attention : ["- nothing"]),
    "",
    `Generated ${now} from ${statePath} and ${ledgerPath}.`,
  ].join("\n");
};

export const render = ({ stateText, ledgerText, baseHtml, statePath = "state.json", ledgerPath = "ledger.tsv", now, artifact = false }) => {
  const state = parseState(stateText, statePath);
  const rows = parseLedger(ledgerText);
  const { style, script } = splitBase(baseHtml);
  const generated = normalizeNow(now);
  const slices = slicesOf(state);
  const slug = textOf(state.slug) ?? basename(statePath).replace(/\.json$/i, "");
  const title = humanize(slug) || "Run";
  const lastRow = rows.at(-1);
  const statePhase = textOf(state.phase);
  const phase = statePhase ?? (lastRow && !isEmpty(lastRow.phase) ? lastRow.phase : null);
  const multiDay = new Set(rows.map((row) => row.ts.slice(0, 10))).size > 1;

  const slicePhases = slices.map(([, slice]) => phaseOf(slice) ?? "not recorded");
  const phaseCounts = countBy(slicePhases);
  const checkpoints = advisorCheckpoints(rows);
  const skipped = rows.filter((row) => row.decision === "step-skipped").length;
  const failed = rows.filter((row) => ["failed", "blocked"].includes(row.result.toLowerCase())).length;
  const lastRowBySlice = new Map(rows.filter((row) => !isEmpty(row.slice)).map((row) => [row.slice, row]));
  const sliceNames = new Set(slices.map(([name]) => name));
  const strayLedgerSlices = [...lastRowBySlice.keys()].filter((name) => !sliceNames.has(name));
  const attentionRows = rows.filter(needsAttention);
  const blockedSlices = slices.filter(([, slice]) => Array.isArray(slice.blockers) && slice.blockers.length > 0);
  const pointers = collectPointers(state, slices, rows);
  const breakdown = [...phaseCounts].map(([name, count]) => `${count} ${name}`).join(", ");

  const tile = (label, value, note) => html`<div class="tile"><span class="label">${label}</span><span class="value">${value}</span>${note}</div>`;
  const hint = (text) => html`<span class="hint">${text}</span>`;
  const pill = (text, tone) => (tone ? html`<span class="pill" data-tone="${tone}">${text}</span>` : html`<span class="pill">${text}</span>`);

  const header = html`<header class="head">
<p class="label">Run report</p>
<h1>${title}</h1>
${textOf(state.objective) ?? textOf(state.request)
  ? html`<p class="lede">${textOf(state.objective) ?? textOf(state.request)}</p>`
  : html`<p class="lede missing">No objective or request recorded in the state file.</p>`}
<div class="meta">${pill(phase ? `phase ${phase}${statePhase ? "" : " (from the ledger)"}` : "phase not recorded", phaseTone(phase))}${pill(`playbook ${textOf(state.playbook) ?? "not recorded"}`)}${pill(`host ${textOf(state.host) ?? "not recorded"}`)}<code>${slug}</code></div>
</header>`;

  const goalFields = [
    ["Done when", state.finish_condition],
    ["Must not change", state.unchanged],
    ...[["Mode", "mode"], ["Issue", "issue"], ["Base branch", "base_branch"], ["Branch", "branch"], ["Worktree", "worktree"], ["Permissions", "permissions"], ["Withheld", "withheld"], ["Escape hatch", "escape_hatch"]]
      .filter(([, key]) => key in state)
      .map(([label, key]) => [label, state[key]]),
  ];
  const goal = html`<section class="block" id="goal"><h2>Goal</h2>
<dl class="kv">${goalFields.map(([label, value]) => html`<dt>${label}</dt><dd>${formatValue(value)}</dd>`)}</dl>
</section>`;

  const counts = html`<section class="block" id="counts"><h2>Counts</h2>
<div class="tiles">
${tile("Slices", slices.length, hint(slices.length ? breakdown : "none recorded"))}
${tile("Ledger rows", rows.length, hint(formatSpan(rows)))}
${tile("Advisor consultations", checkpoints.length, hint(checkpoints.length ? `checkpoints: ${checkpoints.join(", ")}` : "none recorded"))}
${tile("Skipped steps", skipped, skipped ? pill("reasons below", "warn") : hint("none"))}
${tile("Failed or blocked", failed, failed ? pill("see below", "bad") : pill("none", "ok"))}
</div>
</section>`;

  const attentionItems = [
    ...blockedSlices.map(([name, slice]) => html`<li><div class="meta">${pill("blocker", "bad")}${pill(name)}</div>${slice.blockers.map((blocker) => html`<p>${textOf(blocker?.summary) ?? JSON.stringify(blocker)}</p>${blocker?.last_evidence ? html`<p class="ev">attempts ${textOf(blocker.attempts) ?? "not recorded"}; last evidence ${renderEvidence(String(blocker.last_evidence))}</p>` : ""}`)}</li>`),
    ...attentionRows.map((row) => {
      const [label, tone] = attentionLabel(row);
      return html`<li><div class="meta">${pill(label, tone)}<span class="what">${row.decision}</span>${pill(sliceLabel(row.slice))}<time datetime="${row.ts}">${timeLabel(row.ts, true)}</time></div><p>${withBreaks(row.reason)}</p><p class="ev">${renderEvidence(row.evidence)}</p></li>`;
    }),
  ];
  const attention = html`<section class="block" id="attention"><h2>Needs attention</h2>
${attentionItems.length
  ? html`<ul class="rows">${attentionItems}</ul>`
  : html`<p class="muted">Nothing: no blockers in the state file, and no escalated, failed, blocked, or skipped-step rows in the ledger.</p>`}
</section>`;

  const sliceCard = ([name, slice]) => {
    const owner = [textOf(slice.agent) ?? textOf(slice.role), textOf(slice.tier), textOf(slice.model)].filter(Boolean).join(", ");
    const owned = [slice.files, slice.owns].find(Array.isArray);
    const last = lastRowBySlice.get(name);
    const retries = Number(slice.retries) || 0;
    return html`<li class="ticket"><span class="title">${name}</span>
${owner ? html`<span class="meta">${owner}</span>` : ""}
${textOf(slice.pr) ? html`<span class="ev">PR ${renderEvidence(textOf(slice.pr))}</span>` : ""}
${textOf(slice.branch) ? html`<span class="ev">branch <code>${textOf(slice.branch)}</code></span>` : ""}
${textOf(slice.worktree) ? html`<span class="ev">worktree <code>${textOf(slice.worktree)}</code></span>` : ""}
${textOf(slice.depends_on) ? html`<span class="ev">after ${textOf(slice.depends_on)}</span>` : ""}
${Array.isArray(slice.blockers) && slice.blockers.length ? pill(plural(slice.blockers.length, "blocker"), "bad") : ""}
${retries ? pill(plural(retries, "retry").replace("retrys", "retries"), "warn") : ""}
${owned ? html`<details><summary>${plural(owned.length, "owned path")}</summary><p class="ev">${owned.flatMap((path, index) => [index ? ", " : "", html`<code>${String(path)}</code>`])}</p></details>` : ""}
${last ? html`<span class="ev">last ledger row: ${last.decision} (${last.result}), <time datetime="${last.ts}">${timeLabel(last.ts, true)}</time></span>` : html`<span class="ev missing">no ledger rows name this slice</span>`}
</li>`;
  };
  const columns = orderPhases(slicePhases).map((columnPhase) => {
    const members = slices.filter(([, slice]) => (phaseOf(slice) ?? "not recorded") === columnPhase);
    return html`<section class="col"><header><h3>${columnPhase}</h3>${pill(members.length, phaseTone(columnPhase === "not recorded" ? null : columnPhase))}</header><ol class="items">${members.map(sliceCard)}</ol></section>`;
  });
  const sliceBoard = html`<section class="block" id="slices"><h2>Slices</h2>
${slices.length ? html`<div class="board">${columns}</div>` : html`<p class="muted">No slices recorded in the state file.</p>`}
${strayLedgerSlices.length ? html`<p class="hint">Ledger rows also name slices the state file does not list: ${strayLedgerSlices.join(", ")}.</p>` : ""}
</section>`;

  const chipGroup = (label, key, values) => {
    const tally = countBy(values);
    return html`<div class="chips" role="group" aria-label="${label}" data-filter-group="${key}"><span class="label">${label}</span>${[...tally].map(([value, count]) => html`<button class="chip" aria-pressed="false" data-filter-value="${value}">${value} <span class="n">${count}</span></button>`)}</div>`;
  };
  const ledgerItems = rows.map((row) => {
    const tone = resultTone(row.result);
    return html`<li data-filter-item data-phase="${row.phase}" data-result="${row.result}" data-tone="${tone}"><time${/^\d{4}-\d{2}-\d{2}T/.test(row.ts) ? html` datetime="${row.ts}"` : ""} title="${row.ts}">${timeLabel(row.ts, multiDay)}</time><div class="body"><div class="meta"><span class="what">${row.decision}</span>${pill(sliceLabel(row.slice))}${pill(row.phase)}${pill(row.result, tone)}</div><p>${withBreaks(row.reason)}</p><p class="ev">${renderEvidence(row.evidence)}</p></div></li>`;
  });
  const ledger = html`<section class="block" id="ledger" data-filter-scope><h2>Decision log</h2>
${rows.length
  ? html`<div class="meta">${chipGroup("Phase", "phase", rows.map((row) => row.phase))}${chipGroup("Result", "result", rows.map((row) => row.result))}<button class="chip" data-filter-reset>Show all</button></div>
<p class="hint">Rows appear in the order they were appended. Pick chips to filter; chips in one group widen the match, groups narrow it.</p>
<ol class="timeline">${ledgerItems}</ol>`
  : html`<p class="muted">The ledger has no rows.</p>`}
</section>`;

  const evidence = html`<section class="block" id="evidence"><h2>Evidence</h2>
${pointers.length
  ? html`<div class="table"><table><thead><tr><th>Pointer</th><th>Kind</th><th>Cited by</th></tr></thead><tbody>${pointers.map((pointer) => html`<tr><td>${renderPointer(pointer)}</td><td>${pointer.kind}</td><td>${pointer.citedBy.join(", ")}</td></tr>`)}</tbody></table></div>`
  : html`<p class="muted">No links, paths, or commits found in the ledger evidence or the state file.</p>`}
</section>`;

  const extraEntries = Object.entries(state).filter(([key]) => !shownStateKeys.has(key));
  const extra = extraEntries.length
    ? html`<section class="block" id="other"><h2>Other recorded fields</h2>
<details><summary>${plural(extraEntries.length, "field")} from the state file</summary><dl class="kv">${extraEntries.map(([key, value]) => html`<dt>${key}</dt><dd>${formatValue(value)}</dd>`)}</dl></details>
</section>`
    : "";

  const attentionLines = [
    ...blockedSlices.map(([name, slice]) => `- blocker on ${name}: ${slice.blockers.map((blocker) => textOf(blocker?.summary) ?? JSON.stringify(blocker)).join("; ")}`),
    ...attentionRows.map((row) => `- ${row.ts} ${sliceLabel(row.slice)} ${row.decision} (${row.result}): ${row.reason.replace(/\\n/g, " ")}; evidence ${row.evidence}`),
  ];
  const summary = markdownSummary({
    title,
    state,
    phase,
    slices,
    rows,
    counts: { slices: slices.length ? `${slices.length} (${breakdown})` : "0", advisor: checkpoints.length, skipped, failed },
    attention: attentionLines,
    now: generated,
    statePath,
    ledgerPath,
  });

  const body = html`<div class="page">
${header}
<div class="toolbar"><span class="hint grow">Generated <time datetime="${generated}">${generated}</time> from the state file and the ledger.</span><button class="btn" data-copy-from="#run-summary">Copy as Markdown</button><textarea id="run-summary" class="copy-fallback" readonly hidden aria-label="Run summary as Markdown">${summary}</textarea></div>
<main class="stack">
${goal}
${counts}
${attention}
${sliceBoard}
${ledger}
${evidence}
${extra}
</main>
<footer class="sources"><span>State file <code>${statePath}</code></span><span>Ledger <code>${ledgerPath}</code></span><span>Generated <time datetime="${generated}">${generated}</time>. Every count on this page is computed from these two files.</span></footer>
</div>`;

  const fragment = `<title>${escapeHtml(title)}</title>\n<style>\n${style}\n</style>\n\n${body.text}\n\n<script>\n${script}\n</script>\n`;
  if (artifact) return fragment;
  return `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${fragment}`;
};

const parseArgs = (argv) => {
  const options = { artifact: false, help: false };
  const valued = { "--state": "state", "--ledger": "ledger", "--out": "out", "--now": "now" };
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
  if (!options.help && (!options.state || !options.ledger)) throw new ReportError(`--state and --ledger are required. ${usage}`);
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
      stateText: readInput(options.state, "state file"),
      ledgerText: readInput(options.ledger, "ledger"),
      baseHtml: readInput(baseHtmlPath, "template"),
      statePath: options.state,
      ledgerPath: options.ledger,
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
    process.stderr.write(`run-report: ${String(error?.message ?? error).replace(/\s+/g, " ")}\n`);
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
