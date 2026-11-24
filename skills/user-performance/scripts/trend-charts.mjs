class Html {
  constructor(text) {
    this.text = text;
  }
}

export const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

const fill = (value) => {
  if (value instanceof Html) return value.text;
  if (Array.isArray(value)) return value.map(fill).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(value);
};

export const html = (strings, ...values) =>
  new Html(strings.reduce((out, part, index) => out + part + (index < values.length ? fill(values[index]) : ""), ""));

export const isCount = (value) => typeof value === "number" && Number.isFinite(value);

const round = (value) => Math.round(value * 100) / 100;

export const formatNumber = (value) => {
  const rounded = Math.round(value * 10) / 10;
  const [whole, fraction] = String(Math.abs(rounded)).split(".");
  return `${rounded < 0 ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
};

export const percent = (share) => `${Math.round(share * 100)}%`;

export const niceScale = (max, ticks = 4) => {
  if (!(max > 0)) return { top: 1, step: 1 };
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].find((factor) => raw <= factor * magnitude) * magnitude);
  return { top: Math.ceil(max / step) * step, step };
};

export const foldSlices = (entries, limit = 6) => {
  const recorded = entries.filter((entry) => isCount(entry.value));
  const missing = entries.filter((entry) => !isCount(entry.value));
  const named = recorded.filter((entry) => entry.label !== "Other");
  const kept = recorded.length <= limit ? recorded : [...named].sort((left, right) => right.value - left.value).slice(0, limit - 1);
  const folded = recorded.filter((entry) => !kept.includes(entry));
  const slices = recorded.filter((entry) => kept.includes(entry));
  if (folded.length > 0) {
    slices.push({ key: "other", label: "Other", slot: "o", value: folded.reduce((sum, entry) => sum + entry.value, 0), members: folded.map((entry) => entry.label) });
  }
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  return { slices: slices.map((slice) => ({ ...slice, share: total ? slice.value / total : 0 })), missing, total };
};

export const pieGeometry = (slices, radius = 80, pad = 4) => {
  const center = radius + pad;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const drawn = slices.filter((slice) => slice.value > 0);
  const point = (angle) => `${round(center + radius * Math.cos(angle))} ${round(center + radius * Math.sin(angle))}`;
  let angle = -Math.PI / 2;
  const arcs = drawn.map((slice) => {
    if (drawn.length === 1) return { ...slice, circle: true };
    const start = angle;
    angle += (2 * Math.PI * slice.value) / total;
    return { ...slice, d: `M${center} ${center}L${point(start)}A${radius} ${radius} 0 ${angle - start > Math.PI ? 1 : 0} 1 ${point(angle)}Z` };
  });
  return { size: 2 * center, center, radius, arcs };
};

export const barGeometry = (rows, kinds, { targetWidth = 680, left = 36, top = 16, baseline = 200, right = 8 } = {}) => {
  const band = Math.max(12, Math.floor((targetWidth - left - right) / Math.max(1, rows.length)));
  const barWidth = Math.min(24, band - 8);
  const totals = rows.map((row) => kinds.reduce((sum, kind) => sum + (isCount(row[kind.key]) ? row[kind.key] : 0), 0));
  const { top: scaleTop, step } = niceScale(Math.max(0, ...totals));
  const unit = (baseline - top) / scaleTop;
  const yOf = (value) => round(baseline - value * unit);
  const columns = rows.map((row, index) => {
    const x = left + index * band + (band - barWidth) / 2;
    let stacked = 0;
    const segments = kinds
      .filter((kind) => isCount(row[kind.key]) && row[kind.key] > 0)
      .map((kind) => {
        const bottom = yOf(stacked);
        stacked += row[kind.key];
        return { key: kind.key, label: kind.label, slot: kind.slot, value: row[kind.key], y: yOf(stacked), height: round(bottom - yOf(stacked)) };
      });
    return { date: String(row.date), x, center: x + barWidth / 2, total: totals[index], top: yOf(totals[index]), segments };
  });
  const ticks = [];
  for (let value = 0; value <= scaleTop; value += step) ticks.push({ value, y: yOf(value) });
  return { width: left + rows.length * band + right, height: baseline + 24, left, right, baseline, band, barWidth, unit: round(unit), step, scaleTop, ticks, columns };
};

export const lineGeometry = (periods, series, { targetWidth = 680, left = 36, top = 16, baseline = 200, inset = 16, right = 8 } = {}) => {
  const span = targetWidth - left - right - 2 * inset;
  const gap = periods.length > 1 ? Math.max(40, Math.floor(span / (periods.length - 1))) : span;
  const values = [...periods.flatMap((period) => series.map((line) => period.values[line.key])), ...series.map((line) => line.mean)].filter(isCount);
  const { top: scaleTop, step } = niceScale(Math.max(0, ...values));
  const unit = (baseline - top) / scaleTop;
  const yOf = (value) => round(baseline - value * unit);
  const xs = periods.map((_, index) => left + inset + index * gap);
  const lines = series.map((line) => {
    const points = periods.map((period, index) => {
      const value = period.values[line.key];
      return isCount(value) ? { x: xs[index], y: yOf(value), value, partial: Boolean(period.partial), label: period.label } : null;
    });
    const runs = points.reduce((all, point) => (point ? all.at(-1).push(point) : all.push([]), all), [[]]).filter((run) => run.length > 0);
    return { ...line, points: points.filter(Boolean), paths: runs.map((run) => `M${run.map((point) => `${point.x} ${point.y}`).join("L")}`), meanY: isCount(line.mean) ? yOf(line.mean) : null };
  });
  const ticks = [];
  for (let value = 0; value <= scaleTop; value += step) ticks.push({ value, y: yOf(value) });
  const plotRight = Math.max((xs.at(-1) ?? left) + inset, targetWidth - right);
  return { width: plotRight + right, height: baseline + 24, left, plotRight, baseline, gap, unit: round(unit), step, scaleTop, ticks, xs, labels: periods.map((period) => period.label), lines };
};

const svgOpen = (id, label, width, height, kind = "chart") =>
  html`
<svg class="${kind}" id="${id}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><title>${label}</title>`;

const gridOf = (ticks, left, right) =>
  ticks.map((tick) => html`<line class="grid" x1="${left}" x2="${right}" y1="${tick.y}" y2="${tick.y}"/><text class="axis" x="${left - 6}" y="${tick.y + 4}">${formatNumber(tick.value)}</text>`);

const roundedTop = (x, y, width, height) => {
  const radius = Math.min(4, height, width / 2);
  return `M${x} ${round(y + height)}V${round(y + radius)}Q${x} ${y} ${round(x + radius)} ${y}H${round(x + width - radius)}Q${x + width} ${y} ${x + width} ${round(y + radius)}V${round(y + height)}Z`;
};

export const pieSvg = (id, label, { size, center, radius, arcs }) =>
  html`${svgOpen(id, label, size, size)}${arcs.map((arc) => {
    const tip = html`<title>${arc.label}: ${formatNumber(arc.value)} (${percent(arc.share)})</title>`;
    return arc.circle
      ? html`<circle class="slice k${arc.slot}" cx="${center}" cy="${center}" r="${radius}">${tip}</circle>`
      : html`<path class="slice k${arc.slot}" d="${arc.d}">${tip}</path>`;
  })}</svg>
`;

export const barSvg = (id, label, geometry) => {
  const { width, baseline, barWidth, columns, left, right } = geometry;
  const peak = Math.max(0, ...columns.map((column) => column.total));
  const every = Math.ceil(columns.length / 14);
  return html`${svgOpen(id, label, width, geometry.height, "chart wide")}
${gridOf(geometry.ticks, left, width - right)}
${columns.map((column, index) => html`<g>${column.segments.map((segment, position) => {
    const tip = html`<title>${column.date} ${segment.label}: ${formatNumber(segment.value)}</title>`;
    return position === column.segments.length - 1
      ? html`<path class="mark k${segment.slot}" d="${roundedTop(column.x, segment.y, barWidth, segment.height)}">${tip}</path>`
      : html`<rect class="mark k${segment.slot}" x="${column.x}" y="${segment.y}" width="${barWidth}" height="${segment.height}">${tip}</rect>`;
  })}${peak > 0 && column.total === peak ? html`<text class="value" x="${column.center}" y="${column.top - 5}">${formatNumber(peak)}</text>` : ""}${index % every === 0 ? html`<text x="${column.center}" y="${baseline + 16}">${column.date.slice(5)}</text>` : ""}</g>
`)}</svg>
`;
};

export const lineSvg = (id, label, geometry) => {
  const { left, plotRight, baseline, lines, xs, labels } = geometry;
  return html`${svgOpen(id, label, geometry.width, geometry.height, "chart wide")}
${gridOf(geometry.ticks, left, plotRight)}
${lines.map((line) => (line.meanY === null ? "" : html`<line class="mean k${line.slot}" x1="${left}" x2="${plotRight}" y1="${line.meanY}" y2="${line.meanY}"><title>${line.label}, earlier average: ${formatNumber(line.mean)}</title></line>`))}
${lines.map((line) => line.paths.map((d) => html`<path class="line k${line.slot}" d="${d}"/>`))}
${lines.map((line) => line.points.map((point) => html`<circle class="point k${line.slot}${point.partial ? " open" : ""}" cx="${point.x}" cy="${point.y}" r="4"><title>${point.label} ${line.label}: ${formatNumber(point.value)}</title></circle>`))}
${xs.map((x, index) => html`<text x="${x}" y="${baseline + 16}">${labels[index]}</text>`)}
</svg>
`;
};

export const flatPercent = 5;
export const directions = { prs_merged: "higher", prs_reviewed: "higher", issues_solved: "higher", pr_cycle_time_median_hours: "lower" };
export const metricDefinitions = [
  ["commits", "Commits", "Commits authored with your git author emails in the period, merge commits excluded, counted from each checkout's current branch history (HEAD) only."],
  ["lines_added", "Lines added", "Lines added by those commits, from git --numstat."],
  ["lines_removed", "Lines removed", "Lines removed by those commits, from git --numstat."],
  ["files_changed", "Files changed", "Distinct files changed by those commits, counted per repository; a rename counts its new path."],
  ["active_days", "Active days", "Distinct local days in the period with at least one of those commits."],
  ["prs_opened", "Pull requests opened", "Pull requests you authored that were created in the period."],
  ["prs_merged", "Merged pull requests", "Pull requests you authored that were merged in the period."],
  ["prs_closed_unmerged", "Closed unmerged", "Pull requests you authored that were closed without merging in the period."],
  ["prs_open", "Still open", "Pull requests you authored that were still open at the end of the period."],
  ["pr_cycle_time_median_hours", "Median PR cycle time", "Median hours from creation to merge for your pull requests merged in the period."],
  ["prs_reviewed", "Pull requests reviewed", "Pull requests by other authors that you reviewed in the period."],
  ["review_comments", "Review comments", "Comments inside those reviews."],
  ["comments", "Comments", "Your comments on issues and pull requests, written in the period."],
  ["issues_created", "Issues created", "Issues you opened in the period."],
  ["tasks_created", "Tasks created", "Created issues whose issue type is Task."],
  ["sub_issues_created", "Sub-issues created", "Created issues that have a parent issue."],
  ["issues_solved", "Issues solved", "Issues closed as completed in the period that were assigned to you or closed by a pull request you authored."],
];
export const labels = Object.fromEntries(metricDefinitions.map(([key, label]) => [key, label]));
export const keyMetrics = ["prs_merged", "prs_reviewed", "issues_solved", "pr_cycle_time_median_hours", "commits", "prs_opened", "review_comments", "issues_created"];

export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const arrayOf = (value) => (Array.isArray(value) ? value.filter(isObject) : []);
export const show = (key, value) => (isCount(value) ? `${formatNumber(value)}${key === "pr_cycle_time_median_hours" ? " h" : ""}` : "not recorded");
export const humanize = (key) => String(key).replace(/_/g, " ");

export const comparisonOf = (activity) => {
  const complete = arrayOf(activity.history).filter((period) => period.partial !== true);
  if (activity.period.partial !== true) return { current: { ...activity.period, metrics: activity.metrics }, earlier: complete.slice(-4) };
  return { current: complete.at(-1) ?? null, earlier: complete.slice(0, -1).slice(-4) };
};

export const trendOf = (key, value, earlier) => {
  const direction = directions[key] ?? "input";
  const recorded = earlier.map((period) => period?.metrics?.[key]).filter(isCount);
  const count = recorded.length;
  const sum = recorded.reduce((total, item) => total + item, 0);
  const base = { key, direction, value: isCount(value) ? value : null, count, mean: count ? sum / count : null, tone: null };
  if (!isCount(value)) return { ...base, state: "missing" };
  if (count === 0) return { ...base, state: "no-baseline" };
  if (sum === 0) return value === 0 ? { ...base, state: "none" } : { ...base, state: "from-none", change: "up", tone: toneOf(direction, "up") };
  if (Math.abs(value * count - sum) * 100 < flatPercent * sum) return { ...base, state: "flat" };
  const change = value > base.mean ? "up" : "down";
  return { ...base, state: "changed", change, percent: Math.round((Math.abs(value - base.mean) / base.mean) * 100), tone: toneOf(direction, change) };
};

const toneOf = (direction, change) => {
  if (direction === "input") return null;
  return (change === "up") === (direction === "higher") ? "ok" : "bad";
};

export const verdictOf = (trend) =>
  ({ missing: "not recorded", "no-baseline": "no earlier period", none: "none in either", "from-none": "up from none", flat: "flat" })[trend.state] ??
  `${trend.change} ${trend.percent}%`;

export const unitOf = (period) => {
  const days = period ? Math.round((Date.parse(period.until) - Date.parse(period.since)) / 86400000) : Number.NaN;
  const [one, many] = days === 7 ? ["week", "weeks"] : days === 1 ? ["day", "days"] : Number.isNaN(days) ? ["period", "periods"] : [`${days}-day period`, `${days}-day periods`];
  return (count) => `${count} ${count === 1 ? one : many}`;
};

export const sentenceOf = (trend, unit) => {
  const label = labels[trend.key] ?? humanize(trend.key);
  const value = show(trend.key, trend.value);
  const over = `over the previous ${unit(trend.count)}`;
  const mean = isCount(trend.mean) ? show(trend.key, trend.mean) : "";
  return {
    missing: `${label}: not recorded.`,
    "no-baseline": `${label}: ${value}; no earlier period to compare.`,
    none: `${label}: none in either this period or the previous ${unit(trend.count)}.`,
    "from-none": `${label}: ${value}, up from none ${over}.`,
    flat: `${label}: ${value}, flat against an average of ${mean} ${over} (within ${flatPercent}%).`,
    changed: `${label}: ${value}, ${trend.change} from an average of ${mean} ${over}.`,
  }[trend.state];
};
