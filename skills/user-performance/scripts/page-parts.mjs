import { arrayOf, barGeometry, barSvg, flatPercent, foldSlices, formatNumber, html, isCount, isObject, metricDefinitions, percent, pieGeometry, pieSvg, show } from "./trend-charts.mjs";

export const legend = (items) => html`<ul class="legend">${items.map((item) => html`<li><span class="key k${item.slot}"></span>${item.text}</li>`)}</ul>`;

export const dataTable = (summary, headers, rows) =>
  html`<details><summary>${summary}</summary><div class="table"><table><thead><tr>${headers.map((header) => html`<th>${header}</th>`)}</tr></thead><tbody>${rows.map((row) => html`<tr>${row.map((cell, index) => (index ? html`<td class="num">${cell}</td>` : html`<td>${cell}</td>`))}</tr>`)}</tbody></table></div></details>`;

export const pieFigure = (id, caption, entries, unitWord) => {
  const { slices, missing, total } = foldSlices(entries);
  if (total === 0) return html`<figure class="figure"><p class="muted">${caption}: ${slices.length ? "none in this period" : "not recorded"}.${slices.length && missing.length ? ` Not recorded: ${missing.map((entry) => entry.label).join(", ")}.` : ""}</p></figure>`;
  const summary = slices.map((slice) => `${slice.label} ${formatNumber(slice.value)} (${percent(slice.share)})`).join(", ");
  const folded = slices.find((slice) => slice.members);
  return html`<figure class="figure"><div class="scroll">${pieSvg(id, `${caption}: ${summary}`, pieGeometry(slices))}</div>
${legend(slices.map((slice) => ({ slot: slice.slot, text: `${slice.label}: ${formatNumber(slice.value)} (${percent(slice.share)})` })))}
<figcaption>${caption}, ${formatNumber(total)} ${unitWord} in total; each slice's angle is its share, starting at 12 o'clock and running clockwise. Percentages are rounded.${folded ? ` Other folds ${folded.members.join(", ")}.` : ""}${missing.length ? ` Not recorded: ${missing.map((entry) => entry.label).join(", ")}.` : ""} Source: breakdowns in the activity file.</figcaption></figure>`;
};

export const pill = (text, tone) => (tone ? html`<span class="pill" data-tone="${tone}">${text}</span>` : html`<span class="pill">${text}</span>`);
export const cell = (key, value) => (isCount(value) ? show(key, value) : html`<span class="missing">not recorded</span>`);
export const day = (value) => (typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "—");
export const stamp = (value) => `${value.slice(0, 10)} ${value.slice(11, 16)}`.trim();
export const stateTone = { merged: "ok", open: "info", closed: "neutral", APPROVED: "ok", CHANGES_REQUESTED: "warn" };

export const link = (item) => {
  const name = `${item.repository ?? "unknown"}#${item.number ?? "?"}`;
  return typeof item.url === "string" && /^https?:\/\//i.test(item.url) ? html`<a href="${item.url}" rel="noopener" target="_blank">${name}</a>` : name;
};

export const itemTable = (id, title, items, headers, row, intro = "") =>
  html`<section class="block" id="${id}"><h2>${title}</h2>${intro}${items.length
    ? html`<div class="table"><table><thead><tr>${headers.map((header) => html`<th>${header}</th>`)}</tr></thead><tbody>${items.map((item) => html`<tr>${row(item).map((value) => html`<td>${value}</td>`)}</tr>`)}</tbody></table></div>`
    : html`<p class="muted">None listed in the activity file.</p>`}</section>`;

export const guideSection = (timeZone) => html`<section class="block" id="how-to-read"><h2>How to read this</h2><div class="prose">
<p>Each period is compared with the average of up to 4 complete periods of the same length before it. A change under ${flatPercent}% either way is flat.</p>
<p>Merged pull requests, pull requests reviewed, and issues solved are better higher; median PR cycle time is better lower. Every other number is an input and gets no colour. A colour always comes with its word.</p>
<p>A partial period (one that has not ended) shows its counts so far, uncoloured and labelled "partial, so far", and never enters an average; the trend sentences then compare the last complete period instead.</p>
<p>Days and periods follow ${timeZone ?? "the time zone recorded by the collector"}; weeks start on Monday. A number whose source failed reads "not recorded", never 0; "none" means every source feeding it answered and found nothing. A truncated source hit a search result cap, so its numbers may be low.</p>
<p>This page is a snapshot of one collection run. It does not refresh; collect again for newer numbers.</p>
<p>Activity counts say how much happened, not how much it was worth: one hard review can matter more than ten small commits.</p></div>
<dl class="kv">${metricDefinitions.map(([, label, definition]) => html`<dt>${label}</dt><dd>${definition}</dd>`)}</dl>
</section>`;

const dailyKinds = [
  ["commits", "Commits"], ["prs_merged", "PRs merged"], ["reviews", "Reviews"], ["issues_solved", "Issues solved"],
  ["prs_opened", "PRs opened"], ["comments", "Comments"], ["issues_created", "Issues created"],
].map(([key, label], index) => ({ key, label, slot: index + 1 }));

export const sourceTone = (source) => (source.ok === false ? "bad" : source.truncated === true ? "warn" : "ok");
export const sourceState = (source) => (source.ok === false ? "failed" : source.truncated === true ? "truncated" : "ok");

export const statusPanel = ({ collectedAt, period, scope, skipped, sources }) => html`<aside class="status" aria-label="Snapshot status"><p class="label">Snapshot, not live</p>
<dl class="kv"><dt>Collected</dt><dd><time datetime="${collectedAt}">${collectedAt}</time></dd><dt>Period</dt><dd>${period.label}</dd><dt>Scope</dt><dd>${scope.label} (${scope.kind ?? "kind not recorded"})</dd></dl>
<ul>${sources.map((source) => html`<li><span class="dot" data-tone="${sourceTone(source)}"></span>${source.name}<span class="state">${sourceState(source)}</span>${source.detail ? html`<span class="hint">${source.detail}</span>` : ""}</li>`)}${skipped.map((entry) => html`<li><span class="dot" data-tone="warn"></span>${entry.repository ?? "unknown"}<span class="state">skipped</span><span class="hint">${entry.reason ?? "no reason recorded"}</span></li>`)}</ul>
<p class="hint">The page does not refresh. Collect again for newer numbers.</p></aside>`;

export const dailySection = (daily) => {
  const recordedKinds = dailyKinds.filter((kind) => daily.some((row) => isCount(row[kind.key])));
  const absentKinds = dailyKinds.filter((kind) => !recordedKinds.includes(kind));
  const bars = barGeometry(daily, recordedKinds);
  const dailyLabel = `Activity per day: ${bars.columns.map((column) => `${column.date} ${column.total}`).join(", ")}`;
  return html`<section class="block card" id="daily"><h2>Activity per day</h2>
${daily.length
  ? html`<figure class="figure"><div class="scroll">${barSvg("daily-bars", dailyLabel, bars)}</div>
${legend(recordedKinds.map((kind) => ({ slot: kind.slot, text: kind.label })))}
<figcaption>Items per day, stacked bottom to top in legend order. Scale: baseline y=${bars.baseline}, 0 to ${bars.scaleTop} in steps of ${bars.step}, ${bars.unit} px per item; bars ${bars.barWidth} px wide, ${bars.band - bars.barWidth} px apart; the peak day is labelled.${absentKinds.length ? ` Not recorded: ${absentKinds.map((kind) => kind.label).join(", ")}.` : ""} Source: the daily rows of the activity file.</figcaption>
${dataTable("Daily numbers", ["Date", ...dailyKinds.map((kind) => kind.label)], daily.map((row) => [String(row.date), ...dailyKinds.map((kind) => cell(kind.key, row[kind.key]))]))}</figure>`
  : html`<p class="muted">No daily rows in the activity file.</p>`}
</section>`;
};

export const itemSections = (items, breakdowns) => {
  const outcomes = isObject(breakdowns.pr_outcomes) ? Object.entries(breakdowns.pr_outcomes).map(([key, value]) => `${show(key, value)} ${key}`).join(", ") : "not recorded";
  const pullRequests = itemTable("pull-requests", "Pull requests", arrayOf(items.pull_requests), ["Pull request", "Title", "State", "Created", "Merged", "Lines"], (item) => [
    link(item), item.title ?? "", pill(item.state ?? "not recorded", stateTone[item.state]), day(item.created_at), day(item.merged_at), `+${show("", item.additions)} −${show("", item.deletions)}`,
  ], html`<p class="hint">Outcomes: ${outcomes}.</p>`);
  const reviews = itemTable("reviews", "Reviews", arrayOf(items.reviews), ["Pull request", "Title", "State", "Submitted", "Comments"], (item) => [
    link(item), item.title ?? "", pill(item.state ?? "not recorded", stateTone[item.state]), day(item.submitted_at), show("", item.comments),
  ]);
  const issues = itemTable("issues", "Issues", arrayOf(items.issues), ["Issue", "Title", "Role", "Type", "Sub-issue", "State", "Created", "Closed"], (item) => [
    link(item), item.title ?? "", item.role ?? "not recorded", item.type ?? "not recorded", item.sub_issue === true ? "yes" : item.sub_issue === false ? "no" : "unknown", item.state ?? "not recorded", day(item.created_at), day(item.closed_at),
  ]);
  return [pullRequests, reviews, issues];
};

export const pair = (wide, narrow) => (narrow ? html`<div class="dash">${wide}${narrow}</div>` : wide);
