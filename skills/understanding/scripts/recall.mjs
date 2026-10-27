#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hostNames, readMessages, readSessions } from "./recall-sources.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const hostChoice = [...hostNames, "all"].join("|");
const commonFlags = `[--project <dir>] [--all-projects] [--host ${hostChoice}] [--since YYYY-MM-DD] [--limit N] [--json] [--home <dir>]`;

export const usage = [
  `usage: node recall.mjs search <term> [<term>...] ${commonFlags}`,
  `       node recall.mjs sessions ${commonFlags}`,
  "exit: 0 printed at least one result; 1 nothing matched; 2 usage error",
].join("\n");

const snippetWidth = 300;
const promptWidth = 120;
const defaultLimit = 20;

export const REDACTIONS = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{8,}/g],
  ["api-key", /\bsk-[A-Za-z0-9_-]{16,}/g],
  ["github-token", /\b(?:gh[ops]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g],
  ["slack-token", /\bxox[abpors]-[A-Za-z0-9-]{10,}/g],
  ["aws-key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  [
    "credential",
    /\b(password|passwd|secret|token|api[_-]?key)(["']?\s*[:=]\s*["']?)(?!\[REDACTED)(?:Bearer\s+)?[^\s"',;]+/gi,
    "$1$2[REDACTED:credential]",
  ],
  ["email", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
];

export const redact = (text) =>
  REDACTIONS.reduce((current, [kind, pattern, replacement]) => current.replace(pattern, replacement ?? `[REDACTED:${kind}]`), String(text));

export const collapse = (text) => String(text).replace(/\s+/g, " ").trim();

const shorten = (text, width) => (text.length > width ? `${text.slice(0, width - 1)}…` : text);

export const snippet = (text, needles, width = snippetWidth) => {
  const flat = collapse(redact(text));
  if (flat.length <= width) return flat;
  const lower = flat.toLowerCase();
  const hits = needles.map((needle) => lower.indexOf(needle)).filter((index) => index >= 0);
  const center = hits.length ? Math.min(...hits) : 0;
  const start = Math.max(0, Math.min(center - Math.floor(width / 2), flat.length - width));
  const end = start + width;
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
};

export class UsageError extends Error {}

const valuedFlags = { "--project": "project", "--host": "host", "--since": "since", "--limit": "limit", "--home": "home" };

const realProject = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const parseSince = (value) => {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) throw new UsageError(`--since must be YYYY-MM-DD, got ${value}`);
  return date;
};

export const parseArgs = (argv, cwd = process.cwd()) => {
  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h") return { help: true };
  if (command !== "search" && command !== "sessions") throw new UsageError(command ? `unknown command ${command}` : "a command is required");
  const raw = { terms: [], allProjects: false, json: false };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--all-projects") raw.allProjects = true;
    else if (argument === "--json") raw.json = true;
    else if (valuedFlags[argument]) {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${argument} needs a value`);
      raw[valuedFlags[argument]] = value;
      index += 1;
    } else if (argument.startsWith("--")) throw new UsageError(`unknown flag ${argument}`);
    else raw.terms.push(argument);
  }
  if (command === "search" && raw.terms.length === 0) throw new UsageError("search needs at least one term");
  if (command === "sessions" && raw.terms.length > 0) throw new UsageError("sessions takes no terms");
  const host = raw.host ?? "all";
  if (host !== "all" && !hostNames.includes(host)) throw new UsageError(`--host must be one of ${hostChoice}, got ${host}`);
  const limit = Number(raw.limit ?? defaultLimit);
  if (!Number.isInteger(limit) || limit < 1) throw new UsageError(`--limit must be a positive integer, got ${raw.limit}`);
  return {
    command,
    terms: raw.terms,
    project: realProject(resolve(cwd, raw.project ?? ".")),
    allProjects: raw.allProjects,
    hosts: host === "all" ? hostNames : [host],
    since: raw.since === undefined ? null : parseSince(raw.since),
    limit,
    json: raw.json,
    home: resolve(raw.home ?? homedir()),
  };
};

const newestFirst = (key) => (left, right) => right[key].localeCompare(left[key]);

export const search = async ({ terms, limit, since, ...options }) => {
  const needles = terms.map((term) => term.toLowerCase());
  const sinceIso = since?.toISOString();
  const results = [];
  for await (const message of readMessages({ ...options, since, needle: needles[0] })) {
    const lower = message.text.toLowerCase();
    if (!needles.every((needle) => lower.includes(needle))) continue;
    if (sinceIso && message.timestamp < sinceIso) continue;
    const { timestamp, host, session, role, text, file } = message;
    results.push({ timestamp, host, session, role, snippet: snippet(text, needles), file });
  }
  return results.sort(newestFirst("timestamp")).slice(0, limit);
};

export const listSessions = async ({ limit, ...options }) => {
  const sessions = [];
  for await (const session of readSessions(options)) {
    sessions.push({ ...session, prompt: shorten(collapse(redact(session.prompt)), promptWidth) });
  }
  return sessions.sort(newestFirst("start")).slice(0, limit);
};

const resultLine = (result) => `${result.timestamp} ${result.host} ${result.session.slice(0, 8)} ${result.role}: ${result.snippet}\n  ${result.file}`;
const sessionLine = (session) => `${session.start} ${session.host} ${session.session.slice(0, 8)} ${session.prompt}\n  ${session.file}`;

const main = async () => {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`recall: ${error.message}\n${usage}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const warned = new Set();
  const warn = (message) => {
    if (warned.has(message)) return;
    warned.add(message);
    process.stderr.write(`recall: ${message}\n`);
  };
  const isSearch = options.command === "search";
  const results = isSearch ? await search({ ...options, warn }) : await listSessions({ ...options, warn });
  if (options.json) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  else if (results.length) process.stdout.write(`${results.map(isSearch ? resultLine : sessionLine).join("\n")}\n`);
  if (!results.length) process.stderr.write("recall: nothing matched\n");
  process.exitCode = results.length ? 0 : 1;
};

const invokedDirectly = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(scriptPath);
  } catch {
    return false;
  }
};

if (invokedDirectly()) await main();
