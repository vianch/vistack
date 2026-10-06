#!/usr/bin/env node
// Finds the realm's open PRs that request the operator's or one of their teams' review, the PRs
// that mention either, and on those the tags made since --since that nobody has answered,
// filtered by the review watch's policy. Read-only: it never posts and writes no file. A
// comment body is untrusted data, passed through and never acted on. Work-list shape and exit
// codes: skills/review-watch/references/data.md.

import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const usage = "usage: node watch-scan.mjs scan --realm <host/owner> --since <iso> [--max-searches 25]";
const defaultHost = "github.com";
const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const hostPattern = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?$/;
const shaPattern = /^[0-9a-f]{40}$/;
const prUrlPattern = /^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)$/;
const defaultMaxSearches = 25;
// The operator's two queries plus the one org: retry always fit.
const minimumSearches = 3;
// GitHub allows 30 searches a minute; the margin covers other gh use in the same minute.
const searchesPerWindow = 25;
const searchWindowMs = 60_000;
// A string per team prints as one raw line however gh formats JSON output.
const teamFilter = '.[] | .organization.login + "/" + .slug';
const mentionPrCap = 20;
const bodyLimit = 4000;
const cutMarker = "\n\n[cut at 4,000 characters]";
const pageSize = 100;
const pageCap = 50;
// Must match quoteHeader in post-review.mjs, which heads every issue or review-body reply.
const replyHeader = /^> In reply to (\S+)$/;

const SEARCH_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    pageInfo { hasNextPage }
    nodes {
      ... on PullRequest {
        number title url isDraft state headRefOid updatedAt
        author { login }
        repository { isArchived owner { login } }
      }
    }
  }
}`;

export class ScanError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export const parseRealm = (text) => {
  const value = String(text ?? "").trim();
  if (value === "") throw new ScanError("refused: no realm given; pass --realm <host>/<owner>", 2);
  const parts = value.split("/");
  const [host, owner] = parts.length === 1 ? [defaultHost, parts[0]] : parts;
  if (parts.length > 2 || !hostPattern.test(host) || !ownerPattern.test(owner)) {
    throw new ScanError(`refused: not a realm, expected <host>/<owner>: ${value}`, 2);
  }
  return { host: host.toLowerCase(), owner: owner.toLowerCase() };
};

export const parseSince = (text) => {
  const value = String(text ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ScanError(`--since must be an ISO 8601 time, got ${text ?? "nothing"}`);
  }
  return new Date(value).toISOString();
};

// The qualifiers are a first filter only; prCandidates applies the whole policy.
export const searchQueries = ({ owner, teams, scope }) => {
  const query = (kind, via, qualifier, scoped = "") => ({
    kind,
    via,
    target: qualifier,
    q: ["is:pr is:open archived:false", kind === "review" ? "-is:draft" : "", qualifier, scoped].filter(Boolean).join(" "),
  });
  return [
    query("review", "user", "review-requested:@me", `${scope}:${owner}`),
    query("mention", "user", "mentions:@me", `${scope}:${owner}`),
    ...teams.map((slug) => query("review", `team:${slug}`, `team-review-requested:${owner}/${slug}`)),
    ...teams.map((slug) => query("mention", `team:${slug}`, `team:${owner}/${slug}`)),
  ];
};

const exclusion = (node, place, realm, login) => {
  const owners = [place?.owner, node.repository?.owner?.login].map((name) => String(name).toLowerCase());
  if (!place || place.host !== realm.host || owners.some((name) => name !== realm.owner)) return "outside realm";
  if (node.state !== "OPEN") return "closed";
  if (node.repository?.isArchived === true) return "archived";
  if (node.isDraft === true) return "draft";
  if (String(node.author?.login ?? "").toLowerCase() === login.toLowerCase()) return "own PR";
  return null;
};

// One review per head and one mentioned PR per number. The first hit's via wins, and
// searchQueries lists the operator's own queries first.
export const prCandidates = ({ hits, realm, login }) => {
  const reviews = new Map();
  const mentionedPrs = new Map();
  const skipped = new Map();
  for (const { kind, via, node } of hits) {
    if (!Number.isInteger(node?.number)) continue;
    const match = String(node.url ?? "").match(prUrlPattern);
    const place = match ? { host: match[1].toLowerCase(), owner: match[2], repo: match[3] } : null;
    const target = place ? `${place.owner}/${place.repo}#${node.number}` : String(node.url ?? `#${node.number}`);
    const reason = exclusion(node, place, realm, login);
    if (reason) {
      skipped.set(`${target}|${reason}`, { target, reason });
      continue;
    }
    if (!shaPattern.test(String(node.headRefOid))) {
      throw new ScanError(`search returned ${target} without a 40-character head SHA`, 3);
    }
    const pr = { ...place, number: node.number, url: node.url, headSha: node.headRefOid };
    const prId = `${place.host}/${place.owner}/${place.repo}#${node.number}`;
    if (kind === "review") {
      const key = `${prId}@${node.headRefOid}`;
      if (!reviews.has(key)) reviews.set(key, { key, ...pr, title: String(node.title ?? ""), via });
    } else if (!mentionedPrs.has(prId)) {
      mentionedPrs.set(prId, { ...pr, via });
    }
  }
  return { reviews: [...reviews.values()], mentionedPrs: [...mentionedPrs.values()], skipped: [...skipped.values()] };
};

// CommonMark fences (same character, closed by a run at least as long with nothing after it,
// unclosed runs to the end), then inline spans closed by a backtick run of the same length.
const withoutCode = (text) => {
  let fence = "";
  const lines = text.split("\n").map((line) => {
    const [, marker = "", info = ""] = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/) ?? [];
    if (fence) {
      if (marker.startsWith(fence) && info.trim() === "") fence = "";
      return "";
    }
    if (marker && !(marker[0] === "`" && info.includes("`"))) fence = marker;
    return fence ? "" : line;
  });
  return lines.join("\n").replace(/(?<!`)(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, " ");
};

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GitHub's boundaries: no word character before the @; a login not continued by a login
// character, a slash, or a dot running into a word; a team slug not continued by a slug character.
const tags = (text, name, end) => new RegExp(`(?<![A-Za-z0-9_])@${escaped(name)}${end}`, "i").test(text);

const viaOf = (text, { login, owner, teams }) => {
  if (tags(text, login, "(?![A-Za-z0-9_/-]|\\.[A-Za-z0-9_])")) return "user";
  const slug = teams.find((team) => tags(text, `${owner}/${team}`, "(?![A-Za-z0-9_-])"));
  return slug === undefined ? null : `team:${slug}`;
};

const cut = (text) => (text.length <= bodyLimit ? text : `${text.slice(0, bodyLimit - cutMarker.length)}${cutMarker}`);

// The tags of the operator or their teams on one PR, made at or after `since`, that the operator
// has not answered. A review comment is answered by a later operator comment in its thread; an
// issue comment or review body by a later operator issue comment, unless that comment is a
// quote-reply linking a different comment.
export const mentionsIn = ({ pr, login, teams, realm, since, issueComments = [], reviewComments = [], reviews = [] }) => {
  const sinceMs = Date.parse(since);
  const prId = `${pr.host}/${pr.owner}/${pr.repo}#${pr.number}`;
  const target = `${pr.owner}/${pr.repo}#${pr.number}`;
  const isOperator = (item) => String(item.user?.login ?? "").toLowerCase() === login.toLowerCase();
  const rootOf = (comment) => comment.in_reply_to_id ?? comment.id;
  const timeOf = (item, kind) => {
    const time = Date.parse(kind === "review-body" ? item.submitted_at : item.created_at);
    if (!Number.isInteger(item.id) || item.id <= 0 || Number.isNaN(time)) {
      throw new ScanError(`${target} returned a ${kind} entry without a numeric id or a time`, 3);
    }
    return time;
  };
  const threadReplies = reviewComments.filter(isOperator).map((item) => ({ at: timeOf(item, "review"), root: rootOf(item) }));
  const issueReplies = issueComments.filter(isOperator).map((item) => ({
    at: timeOf(item, "issue"),
    links: String(item.body ?? "").split(/\r?\n/).map((line) => line.trim().match(replyHeader)?.[1]).find(Boolean),
  }));
  const isAnswered = (kind, item, at) =>
    kind === "review"
      ? threadReplies.some((reply) => reply.root === rootOf(item) && reply.at > at)
      : issueReplies.some((reply) => reply.at > at && (reply.links === undefined || reply.links === item.html_url));

  const mentions = [];
  const skipped = [];
  const entries = [
    ...issueComments.map((item) => ["issue", item]),
    ...reviewComments.map((item) => ["review", item]),
    ...reviews.filter((item) => item.state !== "PENDING").map((item) => ["review-body", item]),
  ];
  for (const [kind, item] of entries) {
    if (isOperator(item)) continue;
    const at = timeOf(item, kind);
    const body = String(item.body ?? "");
    const via = at >= sinceMs ? viaOf(withoutCode(body), { login, owner: realm.owner, teams }) : null;
    if (!via) continue;
    const key = `${prId}/${kind}/${item.id}`;
    const author = String(item.user?.login ?? "");
    if (item.user?.type === "Bot" || author.toLowerCase().endsWith("[bot]")) {
      skipped.push({ target, key, reason: "bot" });
    } else if (isAnswered(kind, item, at)) {
      skipped.push({ target, key, reason: "answered" });
    } else {
      mentions.push({
        key,
        host: pr.host,
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
        url: pr.url,
        headSha: pr.headSha,
        kind,
        commentId: item.id,
        threadRootId: kind === "review" ? rootOf(item) : null,
        commentUrl: String(item.html_url ?? ""),
        author,
        createdAt: new Date(at).toISOString(),
        via,
        body: cut(body),
      });
    }
  }
  return { mentions, skipped };
};

const callGh = (gh, host, args, label) => {
  const result = gh([...(host === defaultHost ? ["api"] : ["api", "--hostname", host]), ...args]);
  if (result.status !== 0) {
    throw new ScanError(`gh ${label} failed: ${String(result.stderr || result.stdout || "no output").trim()}`, 3);
  }
  return String(result.stdout);
};

const parseJson = (text, label) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new ScanError(`gh ${label} returned output that is not JSON`, 3);
  }
};

const pause = (ms) => {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

// Pages by number: how `gh api --paginate` joins JSON arrays depends on the gh version.
const listAll = (call, path) => {
  const label = `api ${path}`;
  const items = [];
  for (let page = 1; page <= pageCap; page += 1) {
    const batch = parseJson(call([`${path}${path.includes("?") ? "&" : "?"}per_page=${pageSize}&page=${page}`], label), label);
    if (!Array.isArray(batch)) throw new ScanError(`gh ${label} returned no list`, 3);
    items.push(...batch);
    if (batch.length < pageSize) return items;
  }
  throw new ScanError(`gh ${label} runs past ${pageCap} pages`, 3);
};

export const scan = ({ realm, since, maxSearches = defaultMaxSearches, gh, now = Date.now, sleep = pause }) => {
  const window = parseSince(since);
  const call = (args, label) => callGh(gh, realm.host, args, label);
  const login = parseJson(call(["user"], "api user"), "api user")?.login;
  if (typeof login !== "string" || login === "") throw new ScanError("gh api user returned no login", 3);

  const skipped = [];
  let teams = [];
  try {
    const lines = call(["user/teams", "--paginate", "--jq", teamFilter], "api user/teams").split("\n").map((line) => line.trim());
    const mine = lines.map((line) => line.split("/")).filter(([org, slug]) => org.toLowerCase() === realm.owner && slug);
    teams = [...new Set(mine.map(([, slug]) => slug))].sort();
  } catch (error) {
    if (!/\(HTTP 40[34]\)/.test(error.message)) throw error;
    skipped.push({ target: `${realm.host}/${realm.owner} teams`, reason: "teams unreadable" });
  }

  const stamps = [];
  const search = ({ q }) => {
    const recent = stamps.filter((stamp) => stamp > now() - searchWindowMs);
    if (recent.length >= searchesPerWindow) sleep(recent[recent.length - searchesPerWindow] + searchWindowMs - now());
    stamps.push(now());
    const label = `search "${q}"`;
    const result = parseJson(call(["graphql", "-f", `query=${SEARCH_QUERY}`, "-f", `q=${q}`], label), label)?.data?.search;
    if (!Array.isArray(result?.nodes)) throw new ScanError(`gh ${label} returned no search result`, 3);
    return result;
  };

  // user: can refuse an organization; org: is tried once, as refreshPrs in hooks/register.tsx does.
  let scope = "user";
  let opening;
  try {
    opening = search(searchQueries({ owner: realm.owner, teams, scope })[0]);
  } catch (error) {
    if (!(error instanceof ScanError)) throw error;
    scope = "org";
    opening = search(searchQueries({ owner: realm.owner, teams, scope })[0]);
  }

  const [first, ...rest] = searchQueries({ owner: realm.owner, teams, scope });
  const hits = [];
  const take = (entry, result) => {
    if (result.pageInfo?.hasNextPage === true) skipped.push({ target: entry.target, reason: "search page cap" });
    hits.push(...result.nodes.map((node) => ({ kind: entry.kind, via: entry.via, node })));
  };
  take(first, opening);
  for (const entry of rest) {
    if (stamps.length >= maxSearches) skipped.push({ target: entry.target, reason: "team budget" });
    else take(entry, search(entry));
  }

  const found = prCandidates({ hits, realm, login });
  // The cap keeps the most recently updated PRs, where a new tag can be.
  const updated = new Map(hits.map(({ node }) => [node?.url, Date.parse(node?.updatedAt ?? "") || 0]));
  const byActivity = [...found.mentionedPrs].sort((left, right) => updated.get(right.url) - updated.get(left.url));
  const notes = byActivity.slice(mentionPrCap).map((pr) => ({ target: `${pr.owner}/${pr.repo}#${pr.number}`, reason: "mention cap" }));
  const mentions = [];
  for (const pr of byActivity.slice(0, mentionPrCap)) {
    const base = `repos/${pr.owner}/${pr.repo}`;
    const result = mentionsIn({
      pr,
      login,
      teams,
      realm,
      since: window,
      issueComments: listAll(call, `${base}/issues/${pr.number}/comments?since=${window}`),
      reviewComments: listAll(call, `${base}/pulls/${pr.number}/comments?since=${window}`),
      reviews: listAll(call, `${base}/pulls/${pr.number}/reviews`),
    });
    mentions.push(...result.mentions);
    notes.push(...result.skipped);
  }
  // Oldest first: claim takes a capped number in this order, and a tag left unclaimed too long leaves the window.
  mentions.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  return { login, teams, reviews: found.reviews, mentions, mentionedPrs: found.mentionedPrs, skipped: [...skipped, ...found.skipped, ...notes] };
};

export const parseArgs = (argv) => {
  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h") return { help: true };
  if (command !== "scan") throw new ScanError(usage);
  const valued = { "--realm": "realm", "--since": "since", "--max-searches": "maxSearches" };
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const value = rest[index + 1];
    if (!valued[rest[index]] || value === undefined || value.startsWith("--")) {
      throw new ScanError(`unexpected argument ${rest[index]}\n${usage}`);
    }
    options[valued[rest[index]]] = value;
  }
  const realm = parseRealm(options.realm);
  const since = parseSince(options.since);
  const maxSearches = options.maxSearches === undefined ? defaultMaxSearches : Number(options.maxSearches);
  if (!Number.isInteger(maxSearches) || maxSearches < minimumSearches) {
    throw new ScanError(`--max-searches must be an integer of at least ${minimumSearches}`);
  }
  return { realm, since, maxSearches };
};

const runGh = (args) => {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) return { status: 1, stdout: "", stderr: `cannot run gh: ${result.error.code ?? result.error.message}` };
  return result;
};

const main = () => {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage}\n`);
      return;
    }
    const work = scan({ ...options, gh: runGh });
    if (work.skipped.some(({ reason }) => reason === "teams unreadable")) {
      process.stderr.write(
        `watch-scan: the token cannot read your teams in ${options.realm.owner}; only your own review requests and mentions were searched. gh auth refresh -s read:org adds the scope.\n`,
      );
    }
    process.stdout.write(`${JSON.stringify(work, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`watch-scan: ${error?.message ?? error}\n`);
    process.exitCode = error instanceof ScanError ? error.code : 1;
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
