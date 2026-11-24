const hourMs = 3_600_000;
const dayMs = 24 * hourMs;
const formatters = new Map();
const pad = (value) => String(value).padStart(2, "0");
const lower = (value) => String(value ?? "").toLowerCase();
const sum = (records, field) => records.reduce((total, record) => total + record[field], 0);

const formatterFor = (timeZone) => {
  if (!formatters.has(timeZone)) {
    const fields = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" };
    formatters.set(timeZone, new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", ...fields }));
  }
  return formatters.get(timeZone);
};

const zonedParts = (instant, timeZone) =>
  Object.fromEntries(formatterFor(timeZone).formatToParts(instant).map(({ type, value }) => [type, Number(value)]));

const offsetMinutes = (instant, timeZone) => {
  const whole = Math.floor(instant / 1000) * 1000;
  const { year, month, day, hour, minute, second } = zonedParts(whole, timeZone);
  return Math.round((Date.UTC(year, month - 1, day, hour, minute, second) - whole) / 60_000);
};

const dateKey = ({ year, month, day }) => `${year}-${pad(month)}-${pad(day)}`;
const calendarDate = (instant, timeZone) => {
  const { year, month, day } = zonedParts(instant, timeZone);
  return { year, month, day };
};
const addDays = ({ year, month, day }, days) => {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
};
const daysFromMonday = ({ year, month, day }) => (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
const daysBetween = (from, to) => Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / dayMs);

export const localDate = (instant, timeZone) => dateKey(calendarDate(instant, timeZone));

export const startOfDay = (date, timeZone) => {
  const guess = Date.UTC(date.year, date.month - 1, date.day);
  const first = guess - offsetMinutes(guess, timeZone) * 60_000;
  const second = guess - offsetMinutes(first, timeZone) * 60_000;
  const onDate = [first, second].filter((instant) => localDate(instant, timeZone) === dateKey(date));
  return onDate.length ? Math.min(...onDate) : first;
};

export const formatZoned = (instant, timeZone) => {
  const { year, month, day, hour, minute, second } = zonedParts(instant, timeZone);
  const offset = offsetMinutes(instant, timeZone);
  const zone = `${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${zone}`;
};

export const periodKinds = {
  "last-7-days": { label: "Last 7 days", days: 7, first: (today) => addDays(today, -7) },
  "current-week": { label: "Current week", days: 7, first: (today) => addDays(today, -daysFromMonday(today)) },
  "last-week": { label: "Last week", days: 7, first: (today) => addDays(today, -daysFromMonday(today) - 7) },
  "last-30-days": { label: "Last 30 days", days: 30, first: (today) => addDays(today, -30) },
};
export const customPeriod = /^(\d{4})-(\d{2})-(\d{2})\.\.(\d{4})-(\d{2})-(\d{2})$/;

const customKind = (period, today) => {
  const [, ...parts] = customPeriod.exec(period).map(Number);
  const from = { year: parts[0], month: parts[1], day: parts[2] };
  const to = { year: parts[3], month: parts[4], day: parts[5] };
  if (dateKey(addDays(from, 0)) !== dateKey(from) || dateKey(addDays(to, 0)) !== dateKey(to)) throw new RangeError(`not a calendar date: ${period}`);
  if (daysBetween(from, to) < 0) throw new RangeError(`the period ends before it starts: ${period}`);
  if (daysBetween(from, today) < 0) throw new RangeError(`the period starts in the future: ${period}`);
  return { label: `${dateKey(from)} to ${dateKey(to)}`, days: daysBetween(from, to) + 1, first: () => from };
};

export const computePeriods = ({ period, now, timeZone, history }) => {
  const today = calendarDate(now, timeZone);
  const kind = periodKinds[period] ?? customKind(period, today);
  const first = kind.first(today);
  const fullUntil = startOfDay(addDays(first, kind.days), timeZone);
  const until = Math.min(fullUntil, now);
  const window = (offset) => ({
    since: startOfDay(addDays(first, -offset * kind.days), timeZone),
    until: startOfDay(addDays(first, kind.days - offset * kind.days), timeZone),
  });
  const dates = Array.from({ length: kind.days }, (_, index) => addDays(first, index))
    .filter((date) => startOfDay(date, timeZone) < until)
    .map(dateKey);
  return {
    selected: { label: kind.label, since: window(0).since, until, partial: until < fullUntil, dates },
    history: Array.from({ length: history }, (_, index) => window(history - index)),
  };
};

const numstatRow = /^(\d+|-)\t(\d+|-)\t(.+)$/;

export const renamedPath = (path) => {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);
  if (braced) return `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/{2,}/g, "/");
  return /^.* => (.*)$/.exec(path)?.[1] ?? path;
};

export const parseGitLog = (text, { repository, emails }) =>
  String(text)
    .split("\x1e")
    .slice(1)
    .flatMap((chunk) => {
      const [header = "", ...rows] = chunk.split("\n");
      const [sha, email, authoredAt] = header.split("\x1f");
      if (!sha || !emails.has(lower(email)) || Number.isNaN(Date.parse(authoredAt))) return [];
      const files = rows.flatMap((row) => {
        const match = numstatRow.exec(row);
        return match ? [{ added: Number(match[1]) || 0, removed: Number(match[2]) || 0, path: renamedPath(match[3]) }] : [];
      });
      return [{ repository, sha, at: Date.parse(authoredAt), added: sum(files, "added"), removed: sum(files, "removed"), paths: files.map((file) => file.path) }];
    });

export const metricNeeds = {
  commits: ["git"],
  lines_added: ["git"],
  lines_removed: ["git"],
  files_changed: ["git"],
  active_days: ["git"],
  prs_opened: ["pullRequests"],
  prs_merged: ["pullRequests"],
  prs_closed_unmerged: ["pullRequests"],
  prs_open: ["pullRequests"],
  pr_cycle_time_median_hours: ["pullRequests"],
  prs_reviewed: ["reviews"],
  review_comments: ["reviews"],
  comments: ["comments"],
  issues_created: ["issuesCreated"],
  tasks_created: ["issuesCreated", "issueFields"],
  sub_issues_created: ["issuesCreated", "issueFields"],
  issues_solved: ["issuesSolved"],
};

const dailyColumns = {
  commits: ["git", "commits", "at"],
  prs_opened: ["pullRequests", "opened", "created_at"],
  prs_merged: ["pullRequests", "merged", "merged_at"],
  reviews: ["reviews", "reviews", "submitted_at"],
  comments: ["comments", "comments", "created_at"],
  issues_created: ["issuesCreated", "created", "created_at"],
  issues_solved: ["issuesSolved", "solved", "closed_at"],
};

const timeOf = (value) => (typeof value === "number" ? value : Date.parse(value));
const within = (value, { since, until }) => {
  const at = timeOf(value);
  return at >= since && at < until;
};
const openAt = (pull, until) => Date.parse(pull.created_at) < until && !(Date.parse(pull.merged_at) < until) && !(Date.parse(pull.closed_at) < until);
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
};

const pick = (records, window) => ({
  commits: records.commits.filter((commit) => within(commit.at, window)),
  opened: records.pullRequests.filter((pull) => within(pull.created_at, window)),
  merged: records.pullRequests.filter((pull) => within(pull.merged_at, window)),
  closedUnmerged: records.pullRequests.filter((pull) => !pull.merged_at && within(pull.closed_at, window)),
  open: records.pullRequests.filter((pull) => openAt(pull, window.until)),
  reviews: records.reviews.filter((review) => within(review.submitted_at, window)),
  comments: records.comments.filter((comment) => within(comment.created_at, window)),
  created: records.issuesCreated.filter((issue) => within(issue.created_at, window)),
  solved: records.issuesSolved.filter((issue) => issue.solved && within(issue.closed_at, window)),
});

const countByDay = (picked, timeZone) => {
  const days = new Map();
  for (const [column, [, list, field]] of Object.entries(dailyColumns)) {
    for (const record of picked[list]) {
      const date = localDate(timeOf(record[field]), timeZone);
      const counts = days.get(date) ?? {};
      counts[column] = (counts[column] ?? 0) + 1;
      days.set(date, counts);
    }
  }
  return days;
};

const keepAvailable = (values, needs, available) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, needs[key].every((need) => available.has(need)) ? value : null]));

const metricsFor = (picked, timeZone, available) => {
  const filesChanged = new Set(picked.commits.flatMap((commit) => commit.paths.map((path) => `${commit.repository}\n${path}`)));
  const raw = {
    commits: picked.commits.length,
    lines_added: sum(picked.commits, "added"),
    lines_removed: sum(picked.commits, "removed"),
    files_changed: filesChanged.size,
    active_days: new Set(picked.commits.map((commit) => localDate(commit.at, timeZone))).size,
    prs_opened: picked.opened.length,
    prs_merged: picked.merged.length,
    prs_closed_unmerged: picked.closedUnmerged.length,
    prs_open: picked.open.length,
    pr_cycle_time_median_hours: median(picked.merged.map((pull) => (Date.parse(pull.merged_at) - Date.parse(pull.created_at)) / hourMs)),
    prs_reviewed: new Set(picked.reviews.map((review) => `${review.repository}#${review.number}`)).size,
    review_comments: sum(picked.reviews, "comments"),
    comments: picked.comments.length,
    issues_created: picked.created.length,
    tasks_created: picked.created.filter((issue) => issue.type === "Task").length,
    sub_issues_created: picked.created.filter((issue) => issue.sub_issue === true).length,
    issues_solved: picked.solved.length,
  };
  return keepAvailable(raw, metricNeeds, available);
};

const byTime = (field) => (left, right) =>
  timeOf(left[field]) - timeOf(right[field]) || left.repository.localeCompare(right.repository) || left.number - right.number;

const issueItem = (issue, role) => ({
  repository: issue.repository,
  number: issue.number,
  title: issue.title,
  url: issue.url,
  type: issue.type,
  sub_issue: issue.sub_issue,
  role,
  state: issue.state,
  created_at: issue.created_at,
  closed_at: issue.closed_at,
});

const countTypes = (issues) => {
  const counts = new Map();
  for (const issue of issues) counts.set(issue.type, (counts.get(issue.type) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName)));
};

export const availableKeys = (sources) => new Set(Object.keys(sources).filter((key) => sources[key].ok));

export const buildReport = ({ records, periods, timeZone, sources }) => {
  const available = availableKeys(sources);
  const { selected } = periods;
  const picked = pick(records, selected);
  const metrics = metricsFor(picked, timeZone, available);
  const days = countByDay(picked, timeZone);
  const daily = selected.dates.map((date) => ({
    date,
    ...Object.fromEntries(Object.entries(dailyColumns).map(([column, [need]]) => [column, available.has(need) ? (days.get(date)?.[column] ?? 0) : null])),
  }));
  const history = periods.history.map((window) => ({
    since: formatZoned(window.since, timeZone),
    until: formatZoned(window.until, timeZone),
    partial: false,
    metrics: metricsFor(pick(records, window), timeZone, available),
  }));
  const breakdowns = {
    activity_mix: { commits: metrics.commits, pull_requests: metrics.prs_opened, reviews: metrics.prs_reviewed, comments: metrics.comments, issues: metrics.issues_created },
    issues_by_type: available.has("issuesCreated") && available.has("issueFields") ? countTypes(picked.created) : null,
    pr_outcomes: available.has("pullRequests") ? { merged: metrics.prs_merged, open: metrics.prs_open, closed: metrics.prs_closed_unmerged } : null,
  };
  const pullRequests = records.pullRequests
    .filter((pull) => [pull.created_at, pull.merged_at, pull.closed_at].some((value) => within(value, selected)))
    .sort(byTime("created_at"))
    .map(({ closed_at, ...pull }) => pull);
  const items = {
    pull_requests: pullRequests,
    reviews: [...picked.reviews].sort(byTime("submitted_at")),
    issues: [
      ...[...picked.created].sort(byTime("created_at")).map((issue) => issueItem(issue, "created")),
      ...[...picked.solved].sort(byTime("closed_at")).map((issue) => issueItem(issue, "solved")),
    ],
  };
  return { metrics, daily, history, breakdowns, items };
};

export const emailPattern = /[\p{L}\p{N}._%+-]+@(?:[\p{L}\p{N}-]+\.)*\p{L}[\p{L}\p{N}-]*/gu;
export const redactEmails = (text) => String(text).replace(emailPattern, "[email hidden]");
export const toRedactedJson = (value) => JSON.stringify(value, (key, item) => (typeof item === "string" ? redactEmails(item) : item), 2);

const secretShapes = [
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, "[token hidden]"],
  [/github_pat_[A-Za-z0-9_]+/g, "[token hidden]"],
  [/\/\/[^/@\s]+@/g, "//[credentials hidden]@"],
];
export const firstLine = (text) =>
  secretShapes.reduce((line, [shape, replacement]) => line.replace(shape, replacement), String(text ?? "").trim().split("\n")[0] || "no output");
