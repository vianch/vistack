#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { apiPrefix, buildQuery, defaultHost, hostPattern, insideOwners, insideRealm, normalizeNodes, normalizeRemote, ownerPattern } from "./collect-github.mjs";
import { parseJson, searchAll, searchPlans, searchRange, uniqueRecords } from "./collect-github.mjs";
import { buildReport, computePeriods, customPeriod, firstLine, formatZoned, metricNeeds, parseGitLog, periodKinds, toRedactedJson } from "./collect-lib.mjs";

const usage = `usage: node collect.mjs --realm <host/owner> [--realm ...] [--scope repo|folder|org] [--org <owner>] [--dir <path>]
         [--period last-7-days|current-week|last-week|last-30-days|<YYYY-MM-DD>..<YYYY-MM-DD>] [--time-zone <IANA>]
         [--author-email <email> ...] [--history 4] [--out <path>] [--now <iso>]
Writes the operator's activity JSON (schema 1) to --out, or to stdout.
Exit codes: 0 written; 1 bad arguments or an unwritable --out; 2 refused (no realm, or an org outside it).`;
const dayMs = 86_400_000;
export const unknownLogin = "(login not recorded)";
const gitFormat = "--format=%x1e%H%x1f%ae%x1f%aI";

export const sourceNames = {
  git: "git log",
  pullRequests: "GitHub search: pull requests",
  reviews: "GitHub search: reviews",
  comments: "GitHub search: comments",
  issuesCreated: "GitHub search: issues created",
  issueFields: "GitHub search: issue fields",
  issuesSolved: "GitHub search: issues solved",
};
const searchSources = ["pullRequests", "reviews", "comments", "issuesCreated", "issuesSolved"];

export class CollectError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export const parseArgs = (argv, { cwd, defaultTimeZone }) => {
  const options = { realms: [], authorEmails: [], scope: "repo", dir: cwd, period: "last-7-days", timeZone: defaultTimeZone, history: 4, help: false };
  const valued = { "--scope": "scope", "--org": "org", "--dir": "dir", "--period": "period", "--time-zone": "timeZone", "--history": "history", "--out": "out", "--now": "now" };
  const repeated = { "--realm": "realms", "--author-email": "authorEmails" };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    const key = valued[flag] ?? repeated[flag];
    if (!key || value === undefined || value.startsWith("--")) throw new CollectError(`unexpected argument ${flag}\n${usage}`);
    if (repeated[flag]) options[key].push(value);
    else options[key] = value;
    index += 1;
  }
  if (options.help) return options;
  if (!["repo", "folder", "org"].includes(options.scope)) throw new CollectError(`--scope must be repo, folder, or org, got ${options.scope}`);
  if ((options.scope === "org") !== (options.org !== undefined)) throw new CollectError("--org is required with --scope org and applies to it only");
  if (options.org !== undefined && !ownerPattern.test(options.org)) throw new CollectError(`--org is not a GitHub owner name: ${options.org}`);
  if (!periodKinds[options.period] && !customPeriod.test(options.period)) throw new CollectError(`unknown --period ${options.period}`);
  if (!/^\d{1,2}$/.test(String(options.history)) || Number(options.history) > 12) throw new CollectError(`--history must be a whole number from 0 to 12, got ${options.history}`);
  options.history = Number(options.history);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: options.timeZone });
  } catch {
    throw new CollectError(`unknown --time-zone ${options.timeZone}`);
  }
  if (options.now !== undefined && Number.isNaN(Date.parse(options.now))) throw new CollectError(`--now is not a date: ${options.now}`);
  return options;
};

export const parseRealm = (entry) => {
  const parts = String(entry).trim().split("/");
  const [host, owner] = parts.length === 1 ? [defaultHost, parts[0]] : parts;
  if (parts.length > 2 || !hostPattern.test(host) || !ownerPattern.test(owner)) throw new CollectError(`not a realm, expected <host>/<owner>: ${entry}`);
  return { host: host.toLowerCase(), owner: owner.toLowerCase(), spelling: owner };
};

export const gateRealms = (options) => {
  if (!options.realms.length) throw new CollectError("refused: no realm given; pass --realm <host>/<owner> read from the consuming repository's origin", 2);
  const realms = options.realms.map(parseRealm);
  if (options.scope !== "org") return realms;
  const realm = realms.find(({ owner }) => owner === options.org.toLowerCase());
  if (!realm) throw new CollectError(`refused: org ${options.org} is outside the realm (${realms.map(({ host, owner }) => `${host}/${owner}`).join(", ")})`, 2);
  return realms;
};

const collectSource = ({ source, targets, run, window, pageLimit }) => {
  const groups = [];
  let typed = true;
  let truncated = false;
  let dropped = 0;
  try {
    for (const { host, login, qualifier, owners } of targets) {
      const nodes = [];
      groups.push({ login, nodes });
      for (const plan of searchPlans.filter((candidate) => candidate.source === source)) {
        const request = (withFields) => ({ host, login: plan.reviewer ? login : undefined, query: buildQuery(plan, withFields), searchQuery: `${plan.terms(login, searchRange(window))} ${qualifier}` });
        let result;
        try {
          result = searchAll(run, request(typed), pageLimit);
        } catch (error) {
          if (!(plan.typed && typed && error.issueFieldsUnsupported)) throw error;
          typed = false;
          result = searchAll(run, request(false), pageLimit);
        }
        const inside = insideOwners(result.nodes, owners);
        dropped += result.nodes.length - inside.length;
        nodes.push(...inside);
        truncated ||= result.truncated;
      }
    }
  } catch (error) {
    return { ok: false, detail: firstLine(error.message), truncated: false, records: [] };
  }
  const normalized = groups.map(({ login, nodes }) => normalizeNodes(source, nodes, { login, since: window.since, typed }));
  const records = uniqueRecords(source, normalized.flatMap((group) => group.records));
  const cut = normalized.some((group) => group.cut);
  const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const detail = `${plural(targets.length, "search scope")}${dropped ? `; ${plural(dropped, "result")} outside the realm dropped` : ""}`;
  return { ok: true, detail, truncated: truncated || cut, fieldsMissing: !typed, records };
};

const issueFieldsFrom = ({ issuesCreated, issuesSolved }) => {
  if (!issuesCreated.ok) return failed(issuesCreated.detail);
  if (issuesCreated.fieldsMissing || issuesSolved.fieldsMissing) {
    return failed("this GitHub host does not support the issue type and parent fields, so issue types and sub-issues are not recorded");
  }
  return { ok: true, detail: "issue type and parent read", truncated: issuesCreated.truncated, records: [] };
};

const failed = (detail) => ({ ok: false, detail, truncated: false, records: [] });

const readCheckouts = ({ options, realms, run, listCheckouts }) => {
  const listed = () => {
    try {
      return listCheckouts(options.dir);
    } catch (error) {
      throw new CollectError(`cannot read --dir ${options.dir}: ${error.code ?? error.message}`);
    }
  };
  const entries = options.scope === "folder" ? listed().map(({ name, symlink }) => ({ dir: join(options.dir, name), symlink })) : [{ dir: options.dir, symlink: false }];
  const kept = [];
  const skipped = [];
  for (const { dir, symlink } of entries) {
    if (symlink) {
      skipped.push({ repository: basename(dir), reason: "symlink" });
      continue;
    }
    const origin = run("git", ["-C", dir, "remote", "get-url", "origin"]);
    const repository = origin.status === 0 ? normalizeRemote(origin.stdout) : null;
    if (origin.status !== 0) skipped.push({ repository: basename(dir), reason: "no origin remote" });
    else if (!repository) skipped.push({ repository: basename(dir), reason: "origin is not a hosted remote" });
    else if (!insideRealm(repository, realms)) skipped.push({ repository: repository.name, reason: "outside realm" });
    else kept.push({ dir, ...repository });
  }
  return { kept, skipped };
};

const collectGit = ({ checkouts, options, run, window, now }) => {
  const emails = new Set(options.authorEmails.map((email) => email.toLowerCase()));
  for (const { dir } of checkouts) {
    const config = run("git", ["-C", dir, "config", "user.email"]);
    if (config.status === 0 && config.stdout.trim()) emails.add(config.stdout.trim().toLowerCase());
  }
  if (!emails.size) return failed("no author email: set git config user.email or pass --author-email");
  const iso = (instant) => new Date(instant).toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const commits = new Map();
  for (const { dir, name } of checkouts) {
    const authors = [...emails].map((email) => `--author=${email}`);
    const result = run("git", ["-C", dir, "log", "--no-merges", "-F", "-i", ...authors, `--since=${iso(window.since - dayMs)}`, `--until=${iso(now + dayMs)}`, "--numstat", gitFormat]);
    if (result.status !== 0) return failed(`${name}: ${firstLine(result.stderr)}`);
    for (const commit of parseGitLog(result.stdout, { repository: name, emails })) commits.set(commit.sha, commit);
  }
  return { ok: true, detail: `${checkouts.length} repositor${checkouts.length === 1 ? "y" : "ies"}`, truncated: false, records: [...commits.values()] };
};

const identify = (run, host) => {
  const result = run("gh", [...apiPrefix(host), "user"]);
  const login = parseJson(result.stdout)?.login;
  if (result.status !== 0 || !login) throw new Error(result.status !== 0 ? firstLine(result.stderr) : "gh api user returned no login");
  return login;
};

export const collect = ({ options, realms, run, now, listCheckouts, pageLimit = 20 }) => {
  const periods = computePeriods({ period: options.period, now, timeZone: options.timeZone, history: options.history });
  const window = { since: periods.history[0]?.since ?? periods.selected.since, until: periods.selected.until };
  const orgRealm = options.scope === "org" ? realms.find(({ owner }) => owner === options.org.toLowerCase()) : null;
  const { kept, skipped } = orgRealm ? { kept: [], skipped: [] } : readCheckouts({ options, realms, run, listCheckouts });
  const repositories = [...new Map(kept.map((checkout) => [`${checkout.host}/${checkout.name.toLowerCase()}`, checkout]).reverse()).values()].reverse();
  const scopes = orgRealm ? [{ host: orgRealm.host, qualifier: `org:${orgRealm.spelling}` }] : repositories.map(({ host, name }) => ({ host, qualifier: `repo:${name}` }));
  const sources = {};
  let login = unknownLogin;
  if (!scopes.length) {
    for (const key of Object.keys(sourceNames)) sources[key] = failed("no repository inside the realm");
  } else {
    sources.git = orgRealm ? failed("org scope reads no local checkout") : collectGit({ checkouts: kept, options, run, window, now });
    const logins = new Map();
    try {
      for (const host of new Set(scopes.map((scope) => scope.host))) logins.set(host, identify(run, host));
      login = logins.values().next().value;
      const owners = (host) => new Set(realms.filter((realm) => realm.host === host).map((realm) => realm.owner));
      const targets = scopes.map((scope) => ({ ...scope, login: logins.get(scope.host), owners: owners(scope.host) }));
      for (const key of searchSources) sources[key] = collectSource({ source: key, targets, run, window, pageLimit });
    } catch (error) {
      for (const key of searchSources) sources[key] = failed(firstLine(error.message));
    }
  }
  sources.issueFields = issueFieldsFrom(sources);
  const records = Object.fromEntries(Object.entries(sources).map(([key, source]) => [key === "git" ? "commits" : key, source.records]));
  const report = buildReport({ records, periods, timeZone: options.timeZone, sources });
  const seen = [...new Set(report.items.pull_requests.concat(report.items.reviews, report.items.issues).map((item) => item.repository))];
  return {
    schema: 1,
    generated_at: new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z"),
    subject: { login },
    scope: {
      kind: options.scope,
      label: orgRealm ? orgRealm.spelling : options.scope === "repo" ? (repositories[0]?.name ?? basename(options.dir)) : basename(options.dir),
      repositories: (orgRealm ? seen : repositories.map(({ name }) => name)).sort(),
      skipped,
    },
    period: {
      label: periods.selected.label,
      since: formatZoned(periods.selected.since, options.timeZone),
      until: formatZoned(periods.selected.until, options.timeZone),
      partial: periods.selected.partial,
      time_zone: options.timeZone,
    },
    sources: Object.entries(sourceNames).map(([key, name]) => ({
      name,
      ok: sources[key].ok,
      detail: sources[key].detail,
      truncated: sources[key].truncated,
      metrics: Object.keys(metricNeeds).filter((metric) => metricNeeds[metric].includes(key)),
    })),
    ...report,
  };
};

export const main = (argv, deps) => {
  try {
    const options = parseArgs(argv, deps);
    if (options.help) return { code: 0, stdout: `${usage}\n`, stderr: "" };
    const realms = gateRealms(options);
    const now = options.now === undefined ? deps.now() : Date.parse(options.now);
    let activity;
    try {
      activity = collect({ ...deps, options, realms, now });
    } catch (error) {
      if (error instanceof RangeError) throw new CollectError(error.message);
      throw error;
    }
    const text = `${toRedactedJson(activity)}\n`;
    if (options.out === undefined) return { code: 0, stdout: text, stderr: "" };
    try {
      deps.writeFile(options.out, text);
    } catch (error) {
      return { code: 1, stdout: "", stderr: `collect: cannot write ${options.out}: ${error.code ?? error.message}\n` };
    }
    return { code: 0, stdout: `wrote ${options.out}\n`, stderr: "" };
  } catch (error) {
    if (!(error instanceof CollectError)) throw error;
    return { code: error.code, stdout: "", stderr: `collect: ${error.message}\n` };
  }
};

export const writeOutput = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const runCommand = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) return { status: 1, stdout: "", stderr: `cannot run ${command}: ${result.error.code ?? result.error.message}` };
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
};

export const listGitCheckouts = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink() || (entry.isDirectory() && existsSync(join(dir, entry.name, ".git"))))
    .map((entry) => ({ name: entry.name, symlink: entry.isSymbolicLink() }))
    .sort((left, right) => (left.name < right.name ? -1 : 1));

const invokedDirectly = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (invokedDirectly()) {
  const result = main(process.argv.slice(2), {
    run: runCommand,
    now: Date.now,
    listCheckouts: listGitCheckouts,
    writeFile: writeOutput,
    cwd: process.cwd(),
    defaultTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
