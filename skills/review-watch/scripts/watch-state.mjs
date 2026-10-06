#!/usr/bin/env node
// The only writer of the review watch's state file. Schema, locks, and exit codes:
// skills/review-watch/references/data.md.

import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const usage =
  "usage: node watch-state.mjs on --realm <host/owner> | off | status [--json] | begin --realm <host/owner> [--force] | claim --work <file|-> [--max-reviews 3] [--max-replies 5] | record --results <file|-> | unlock";
const defaultHost = "github.com";
const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const hostPattern = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?$/;
const maps = ["reviewed", "answered"];
const lists = ["needsYou", "clean", "posted"];
export const passLockStaleMs = 20 * 60_000;
export const recentPassMs = 20 * 60_000;
export const writeLockStaleMs = 30_000;
const writeLockWaitMs = 5_000;
const writeLockRetryMs = 25;
const abandonedMs = 60 * 60_000;
const mentionOverlapMs = 2 * 60 * 60_000;
const reviewedKeepMs = 30 * 24 * 60 * 60_000;
const listKeepMs = 14 * 24 * 60 * 60_000;
const listCaps = { needsYou: 20, clean: 20, posted: 50 };
const maxAttempts = 3;
const textChars = 120;
const incompleteScan = new Set(["team budget", "search page cap", "teams unreadable"]);
const kinds = [
  { field: "reviews", map: "reviewed", post: "review", key: /^[^/\s]+\/[^/\s]+\/[^/#\s]+#\d+@[0-9a-f]{40}$/, outcomes: new Set(["posted", "clean", "skipped", "failed"]) },
  { field: "mentions", map: "answered", post: "reply", key: /^[^/\s]+\/[^/\s]+\/[^/#\s]+#\d+\/(?:issue|review|review-body)\/\d+$/, outcomes: new Set(["posted", "skipped", "needs-you", "failed"]) },
];

export class WatchStateError extends Error {
  constructor(message, { code = 1 } = {}) {
    super(message);
    this.code = code;
  }
}

export const watchDir = (env = process.env) => env.VISTACK_REVIEW_WATCH_DIR || join(homedir(), ".vistack", "review-watch");
export const statePath = (dir) => join(dir, "state.json");
export const passLockPath = (dir) => join(dir, "pass.lock");

export const normalizeRealm = (entry) => {
  const parts = String(entry ?? "").trim().split("/");
  const [host, owner] = parts.length === 1 ? [defaultHost, parts[0]] : parts;
  if (parts.length > 2 || !hostPattern.test(host) || !ownerPattern.test(owner)) {
    throw new WatchStateError(`not a realm, expected <host>/<owner>: ${entry}`);
  }
  return `${host.toLowerCase()}/${owner.toLowerCase()}`;
};

const realmOrNull = (entry) => {
  try {
    return normalizeRealm(entry);
  } catch {
    return null;
  }
};

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const freshState = () => ({ version: 1, enabled: false, reviewed: {}, answered: {}, needsYou: [], clean: [], posted: [] });

// "ok" means version 1, every map a plain object, and every list an array.
export const readState = (dir) => {
  let text;
  try {
    text = readFileSync(statePath(dir), "utf8");
  } catch (error) {
    return error.code === "ENOENT" ? { status: "missing" } : { status: "unreadable", reason: error.code ?? error.message };
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    return { status: "unreadable", reason: "not JSON" };
  }
  if (!isPlainObject(state) || state.version !== 1) return { status: "unreadable", reason: "not a version 1 state object" };
  const mistyped = [
    ...maps.filter((key) => key in state && !isPlainObject(state[key])),
    ...lists.filter((key) => key in state && !Array.isArray(state[key])),
  ];
  if (mistyped.length) return { status: "unreadable", reason: `wrong type for ${mistyped.join(", ")}` };
  for (const key of maps) state[key] ??= {};
  for (const key of lists) state[key] ??= [];
  return { status: "ok", state };
};

const unreadableError = (dir, read) =>
  new WatchStateError(`the state file ${statePath(dir)} is unreadable (${read.reason}); \`watch-state.mjs off\` keeps a copy and resets it`);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Two waiters that both find a dead writer's lock stale can both break it; keeping the stat
// directly before the rm keeps that window to microseconds.
export const withWriteLock = (dir, work, { waitMs = writeLockWaitMs } = {}) => {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (statSync(dir).mode & 0o077) chmodSync(dir, 0o700);
  const lock = `${statePath(dir)}.lock`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    let age = 0;
    try {
      age = Date.now() - statSync(lock).mtimeMs;
    } catch {
      continue;
    }
    if (age > writeLockStaleMs) {
      rmSync(lock, { recursive: true, force: true });
    } else if (Date.now() >= deadline) {
      throw new WatchStateError(`another writer holds ${lock}; try again`);
    } else {
      sleep(writeLockRetryMs);
    }
  }
  try {
    return work();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
};

// Call while holding the write lock. An unreadable file is kept as state.json.corrupt-<time>.
export const writeState = (dir, state, read, now = new Date()) => {
  const path = statePath(dir);
  const temp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    const descriptor = openSync(temp, "wx", 0o600);
    try {
      writeSync(descriptor, `${JSON.stringify(state, null, 2)}\n`);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (read?.status === "unreadable") renameSync(path, `${path}.corrupt-${now.toISOString().replace(/[:.]/g, "-")}`);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
};

// `change` gets readState's result and returns the next state, or undefined to write nothing.
export const updateState = (dir, change, { now = new Date(), waitMs } = {}) =>
  withWriteLock(
    dir,
    () => {
      const read = readState(dir);
      const next = change(read);
      if (next !== undefined) writeState(dir, next, read, now);
      return next ?? read.state;
    },
    { waitMs },
  );

export const passLockInfo = (dir, now = new Date()) => {
  try {
    const { mtimeMs } = statSync(passLockPath(dir));
    return { since: new Date(mtimeMs).toISOString(), stale: now.getTime() - mtimeMs > passLockStaleMs };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Take or release the pass lock only while holding the write lock, so begins and records
// never interleave around it.
export const releasePassLock = (dir) => rmSync(passLockPath(dir), { recursive: true, force: true });

export const switchOn = ({ dir, realm, now = new Date() }) => {
  const wanted = normalizeRealm(realm);
  return updateState(
    dir,
    (read) => {
      const state = read.status === "ok" ? read.state : freshState();
      if (state.enabled === true && state.realm === wanted) return undefined;
      return { ...state, version: 1, enabled: true, realm: wanted, enabledAt: now.toISOString() };
    },
    { now },
  );
};

export const switchOff = ({ dir, now = new Date() }) =>
  updateState(
    dir,
    (read) => {
      if (read.status === "unreadable") return freshState();
      if (read.status === "missing" || read.state.enabled !== true) return undefined;
      return { ...read.state, enabled: false };
    },
    { now },
  );

export const statusOf = ({ dir, now = new Date() }) => {
  const read = readState(dir);
  if (read.status === "unreadable") throw unreadableError(dir, read);
  const state = read.status === "ok" ? read.state : freshState();
  return {
    enabled: state.enabled === true,
    realm: realmOrNull(state.realm),
    enabledAt: state.enabledAt ?? null,
    lastPassStartedAt: state.lastPassStartedAt ?? null,
    lastPassAt: state.lastPassAt ?? null,
    lastScanAt: state.lastScanAt ?? null,
    mentionBacklogSince: state.mentionBacklogSince ?? null,
    passLock: passLockInfo(dir, now),
    counts: {
      reviewed: Object.keys(state.reviewed).length,
      answered: Object.keys(state.answered).length,
      posted: state.posted.length,
      needsYou: state.needsYou.length,
      clean: state.clean.length,
    },
    needsYou: state.needsYou,
    clean: state.clean,
  };
};

export const formatStatus = (status) => {
  const { counts, passLock } = status;
  const lines = [
    status.enabled ? `on: ${status.realm}, since ${status.enabledAt}` : `off${status.realm ? ` (last realm ${status.realm})` : ""}`,
    status.lastPassStartedAt
      ? `last pass started ${status.lastPassStartedAt}; last finished ${status.lastPassAt ?? "never"}`
      : "no pass yet",
  ];
  if (passLock) lines.push(`a pass holds the lock since ${passLock.since}${passLock.stale ? " (stale; the next begin breaks it)" : ""}`);
  lines.push(`posted ${counts.posted}, clean ${counts.clean}, needs you ${counts.needsYou}`);
  for (const item of status.needsYou) lines.push(`needs you: ${item.url} (${item.reason})`);
  for (const item of status.clean) lines.push(`${item.pr}: reviewed, nothing to flag, awaiting your approval`);
  return lines.join("\n");
};

// The scan's inclusive --since. It only moves forward, which is what lets claim prune answered
// entries older than it.
export const mentionWindow = (state) => {
  const recent = [Date.parse(state.lastScanAt ?? "") - mentionOverlapMs, Date.parse(state.mentionBacklogSince ?? "")].filter(Number.isFinite);
  const bounds = [Date.parse(state.enabledAt ?? ""), recent.length ? Math.min(...recent) : NaN].filter(Number.isFinite);
  return bounds.length ? Math.max(...bounds) : null;
};

// A missing file exits 4 before any lock, so begin creates nothing when the watch was never on.
export const beginPass = ({ dir, realm, force = false, now = new Date() }) => {
  const off = () => new WatchStateError("the watch is off", { code: 4 });
  if (readState(dir).status === "missing") throw off();
  return withWriteLock(dir, () => {
    const read = readState(dir);
    if (read.status === "missing") throw off();
    if (read.status === "unreadable") throw unreadableError(dir, read);
    if (read.state.enabled !== true) throw off();
    if (realm === undefined) throw new WatchStateError(`begin needs --realm <host/owner> while the watch is on\n${usage}`);
    const wanted = normalizeRealm(realm);
    if (wanted !== read.state.realm) {
      throw new WatchStateError(`this loop's realm ${wanted} differs from the watch's realm ${read.state.realm}`, { code: 6 });
    }
    const sinceLastStart = now.getTime() - Date.parse(read.state.lastPassStartedAt ?? "");
    if (!force && sinceLastStart >= 0 && sinceLastStart < recentPassMs) {
      throw new WatchStateError(`a pass started at ${read.state.lastPassStartedAt}, less than 20 minutes ago`, { code: 5 });
    }
    const lock = passLockInfo(dir, now);
    if (lock && !lock.stale) throw new WatchStateError(`another pass holds the lock since ${lock.since}`, { code: 5 });
    releasePassLock(dir);
    mkdirSync(passLockPath(dir));
    const startedAt = now.toISOString();
    try {
      writeState(dir, { ...read.state, lastPassStartedAt: startedAt }, read, now);
    } catch (error) {
      releasePassLock(dir);
      throw error;
    }
    const window = mentionWindow(read.state);
    return { realm: wanted, since: window === null ? startedAt : new Date(window).toISOString(), startedAt };
  });
};

export const unlockPass = ({ dir }) => {
  if (passLockInfo(dir) === null) return false;
  return withWriteLock(dir, () => {
    const held = passLockInfo(dir) !== null;
    releasePassLock(dir);
    return held;
  });
};

const badInput = (message) => new WatchStateError(message);
const ageOf = (at, now) => now.getTime() - Date.parse(at ?? "");
const cut = (text) => Array.from(String(text ?? "").replace(/\s+/g, " ").trim()).slice(0, textChars).join("");
const prKeyOf = (key) => String(key).replace(/(#\d+)[@/].*$/, "$1");
const prOf = (key) => prKeyOf(key).replace(/^[^/]+\//, "");
const isFinalFailure = (entry) => entry.state === "failed" && (entry.attempts ?? 1) >= maxAttempts;
// `item` holds what record copies into the lists; it lives only while the entry is claimed.
const settle = (entry, fields, now) => {
  const { item, outcome, reason, url, ...kept } = entry;
  return { ...kept, ...fields, at: now.toISOString() };
};
const stash = {
  reviewed: (review) => ({ url: review.url, title: cut(review.title) }),
  answered: (mention) => ({ url: mention.commentUrl, author: mention.author, excerpt: cut(mention.body) }),
};

const stateForPass = (dir, read) => {
  if (read.status === "unreadable") throw unreadableError(dir, read);
  if (read.status === "missing") throw badInput(`no state file at ${statePath(dir)}; the watch is off`);
  return read.state;
};

const keepLists = (state, now) => {
  for (const [name, cap] of Object.entries(listCaps)) {
    state[name] = state[name]
      .filter((item) => name === "posted" || ageOf(item?.at, now) <= listKeepMs)
      .sort((left, right) => (Date.parse(right?.at) || 0) - (Date.parse(left?.at) || 0))
      .slice(0, cap);
  }
};

const parseWork = (work) => {
  if (!isPlainObject(work)) throw badInput("the work list is not a JSON object");
  const skipped = work.skipped ?? [];
  if (!Array.isArray(skipped) || !skipped.every(isPlainObject)) throw badInput("the work list's skipped is not a list of objects");
  const items = {};
  for (const { field, map, key } of kinds) {
    items[map] = work[field] ?? [];
    if (!Array.isArray(items[map])) throw badInput(`the work list's ${field} is not a list`);
    const invalid = (item) =>
      !isPlainObject(item) || typeof item.key !== "string" || !key.test(item.key) || (map === "answered" && !Number.isFinite(Date.parse(item.createdAt ?? "")));
    const bad = items[map].find(invalid);
    if (bad !== undefined) throw badInput(`not a valid ${field} item: ${JSON.stringify(bad?.key ?? bad).slice(0, 200)}`);
  }
  return { items, skipped };
};

// Claims are written before they print: a crash after claim leaves a claim, never a duplicate post.
export const claimWork = ({ dir, work, maxReviews = 3, maxReplies = 5, now = new Date() }) => {
  const { items, skipped } = parseWork(work);
  const caps = { reviewed: maxReviews, answered: maxReplies };
  const taken = { reviewed: [], answered: [] };
  const unclaimedMentions = [];
  updateState(
    dir,
    (read) => {
      const state = stateForPass(dir, read);
      if (passLockInfo(dir, now) === null) throw badInput("claim needs the pass lock that begin takes");
      if (state.enabled !== true) return undefined;
      const window = mentionWindow(state);
      const listed = new Set([...items.reviewed, ...items.answered, ...skipped].map((item) => item.key));
      const complete = !skipped.some((item) => incompleteScan.has(item.reason));
      for (const map of maps) {
        for (const [key, entry] of Object.entries(state[map])) {
          if (entry?.state === "claimed" && ageOf(entry.at, now) > abandonedMs) {
            state[map][key] = settle(entry, { state: "failed", reason: "abandoned" }, now);
          }
        }
        for (const candidate of items[map]) {
          const entry = state[map][candidate.key];
          if (entry !== undefined && (entry.state !== "failed" || isFinalFailure(entry))) continue;
          if (taken[map].length >= caps[map]) {
            if (map === "answered") unclaimedMentions.push(candidate);
            continue;
          }
          const attempts = entry === undefined ? 1 : (entry.attempts ?? 1) + 1;
          state[map][candidate.key] = settle(entry ?? {}, { state: "claimed", attempts, item: stash[map](candidate) }, now);
          taken[map].push(candidate);
        }
      }
      // Only a scan that succeeded reaches claim, so a failed scan never moves the window. A backlog
      // the reply cap left holds it open, but never behind where it already was.
      state.lastScanAt = now.toISOString();
      const backlog = unclaimedMentions.map((mention) => Date.parse(mention.createdAt));
      if (backlog.length) {
        state.mentionBacklogSince = new Date(Math.max(Math.min(...backlog), window ?? -Infinity)).toISOString();
      } else {
        delete state.mentionBacklogSince;
      }
      const answeredByYou = new Set(skipped.filter((item) => item.reason === "answered").map((item) => item.key));
      const listedPrs = new Set(items.reviewed.map((item) => prKeyOf(item.key)));
      const newerHeads = new Set(taken.reviewed.map((item) => prKeyOf(item.key)));
      state.needsYou = state.needsYou.filter((item) => !answeredByYou.has(item?.key));
      state.clean = state.clean.filter((item) => !newerHeads.has(prKeyOf(item?.key)) && (!complete || listedPrs.has(prKeyOf(item?.key))));
      // An unlisted failed key cannot be retried, so pruning ignores its attempts.
      for (const [key, entry] of Object.entries(state.reviewed)) {
        const finished = entry?.state === "done" || entry?.state === "failed";
        if (complete && finished && !listed.has(key) && ageOf(entry.at, now) > reviewedKeepMs) delete state.reviewed[key];
      }
      for (const [key, entry] of Object.entries(state.answered)) {
        if (window !== null && !listed.has(key) && Date.parse(entry?.at ?? "") < window) delete state.answered[key];
      }
      keepLists(state, now);
      return state;
    },
    { now },
  );
  return { ...work, reviews: taken.reviewed, mentions: taken.answered };
};

const parseResults = (results) => {
  if (!isPlainObject(results)) throw badInput("the results are not a JSON object");
  if (typeof results.startedAt !== "string" || results.startedAt === "") throw badInput("the results need startedAt, the value begin printed");
  const entries = [];
  for (const kind of kinds) {
    const list = results[kind.field] ?? [];
    if (!Array.isArray(list)) throw badInput(`the results' ${kind.field} is not a list`);
    for (const result of list) {
      const valid = isPlainObject(result) && typeof result.key === "string" && kind.outcomes.has(result.outcome) && (result.outcome !== "posted" || typeof result.url === "string");
      if (!valid) throw badInput(`not a ${kind.field} result: ${JSON.stringify(result).slice(0, 200)}`);
      entries.push({ kind, result });
    }
  }
  return { startedAt: results.startedAt, entries };
};

// Results always merge, even when this pass no longer holds the lock: dropping them would let
// the claims lapse and a later pass post the same head again. Only the lock's owner releases it.
export const recordResults = ({ dir, results, now = new Date() }) => {
  const { startedAt, entries } = parseResults(results);
  return withWriteLock(dir, () => {
    const read = readState(dir);
    const state = stateForPass(dir, read);
    const report = { recorded: 0, ignored: [], released: false, lockOwner: null };
    const at = now.toISOString();
    for (const { kind, result } of entries) {
      const entry = state[kind.map][result.key];
      if (entry?.state !== "claimed") {
        report.ignored.push(result.key);
        continue;
      }
      const attempts = entry.attempts ?? 1;
      const reason = typeof result.reason === "string" ? { reason: result.reason } : {};
      const pr = prOf(result.key);
      if (result.outcome === "failed") {
        state[kind.map][result.key] = settle(entry, { state: "failed", attempts, ...(attempts >= maxAttempts ? { reason: "gave up" } : reason) }, now);
      } else {
        const url = result.outcome === "posted" ? { url: result.url } : {};
        state[kind.map][result.key] = settle(entry, { state: "done", attempts, outcome: result.outcome, ...reason, ...url }, now);
      }
      if (result.outcome === "posted") state.posted.push({ key: result.key, kind: kind.post, pr, url: result.url, summary: cut(result.summary), at });
      if (result.outcome === "clean") state.clean.push({ key: result.key, pr, url: entry.item?.url, title: entry.item?.title, at });
      if (result.outcome === "needs-you") {
        state.needsYou.push({ key: result.key, pr, url: entry.item?.url, author: entry.item?.author, excerpt: entry.item?.excerpt, reason: result.reason, at });
      }
      report.recorded += 1;
    }
    state.lastPassAt = at;
    keepLists(state, now);
    writeState(dir, state, read, now);
    if (passLockInfo(dir, now) !== null) {
      report.lockOwner = state.lastPassStartedAt ?? null;
      if (state.lastPassStartedAt === startedAt) {
        releasePassLock(dir);
        report.released = true;
      }
    }
    return report;
  });
};

const readJson = (source, flag) => {
  try {
    return JSON.parse(readFileSync(source === "-" ? 0 : source, "utf8"));
  } catch (error) {
    throw badInput(`cannot read ${flag} ${source}: ${error.message}`);
  }
};

const commands = {
  on: ({ realm }, dir) => {
    const state = switchOn({ dir, realm });
    return `on: ${state.realm}, since ${state.enabledAt}`;
  },
  off: (_options, dir) => {
    switchOff({ dir });
    return "off";
  },
  status: ({ json }, dir) => {
    const status = statusOf({ dir });
    return json ? JSON.stringify(status) : formatStatus(status);
  },
  begin: ({ realm, force }, dir) => JSON.stringify(beginPass({ dir, realm, force })),
  claim: ({ work, maxReviews, maxReplies }, dir) => JSON.stringify(claimWork({ dir, work: readJson(work, "--work"), maxReviews, maxReplies })),
  record: ({ results }, dir) => {
    const report = recordResults({ dir, results: readJson(results, "--results") });
    for (const key of report.ignored) process.stderr.write(`watch-state: ignored ${key}: not claimed\n`);
    const lock = report.released
      ? "pass lock released"
      : report.lockOwner
        ? `pass lock kept: it belongs to the pass started at ${report.lockOwner}`
        : "no pass lock held";
    return `recorded ${report.recorded}, ignored ${report.ignored.length}; ${lock}`;
  },
  unlock: (_options, dir) => (unlockPass({ dir }) ? "pass lock released" : "no pass lock held"),
};

const valued = {
  on: { "--realm": "realm" },
  begin: { "--realm": "realm" },
  claim: { "--work": "work", "--max-reviews": "maxReviews", "--max-replies": "maxReplies" },
  record: { "--results": "results" },
};
const required = { on: "realm", claim: "work", record: "results" };

const parseArgs = (argv) => {
  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h") return { help: true };
  if (!Object.hasOwn(commands, command ?? "")) throw new WatchStateError(usage);
  const options = { command, json: false, force: false };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag === "--json" && command === "status") {
      options.json = true;
    } else if (flag === "--force" && command === "begin") {
      options.force = true;
    } else if (valued[command]?.[flag] && value !== undefined) {
      options[valued[command][flag]] = value;
      index += 1;
    } else {
      throw new WatchStateError(`unexpected argument ${flag}\n${usage}`);
    }
  }
  if (required[command] && options[required[command]] === undefined) {
    throw new WatchStateError(`${command} needs --${required[command]}\n${usage}`);
  }
  for (const name of ["maxReviews", "maxReplies"]) {
    if (options[name] === undefined) continue;
    if (!/^\d+$/.test(options[name])) throw new WatchStateError(`--max-${name.slice(3).toLowerCase()} must be a whole number\n${usage}`);
    options[name] = Number(options[name]);
  }
  return options;
};

const main = () => {
  try {
    const options = parseArgs(process.argv.slice(2));
    const output = options.help ? usage : commands[options.command](options, watchDir());
    process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`watch-state: ${error?.message ?? error}\n`);
    process.exitCode = error instanceof WatchStateError ? error.code : 1;
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
