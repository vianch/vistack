#!/usr/bin/env node
// The one supported way to post on someone else's PR, refused outside the realm the caller passes
// in. `post` sends a single COMMENT review, never APPROVE or REQUEST_CHANGES. `reply` answers one
// comment and carries no review event; its body comes only from a file, never an argument.
// Input shapes: skills/review-pr/references/findings.md and skills/review-watch/references/reply.md.
// Exit codes: 0 posted, already posted, or dry run; 1 bad input; 2 refused; 3 a GitHub call failed.

import { readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const usage = [
  "usage: node post-review.mjs realm",
  "       node post-review.mjs post --meta <pr.json> --diff <pr.diff> --findings <findings.json> --realm <host/owner> [--realm ...] [--once-per-head] [--dry-run]",
  "       node post-review.mjs reply --pr <url> --comment <id> --kind review|issue|review-body --body-file <path> --realm <host/owner> [--realm ...] [--head <sha>] [--dry-run]",
].join("\n");
const defaultHost = "github.com";
const severities = new Set(["bug", "risk", "nit", "question"]);
const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const repoPattern = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const hostPattern = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?$/;
const shaPattern = /^[0-9a-f]{40}$/;
const sentenceLimit = 120;

export class PostReviewError extends Error {
  constructor(message, { code = 1, payload } = {}) {
    super(message);
    this.code = code;
    this.payload = payload;
  }
}

const refuse = (message, payload) => new PostReviewError(`refused: ${message}`, { code: 2, payload });

const checkName = (owner, repo, number, original) => {
  if (!ownerPattern.test(owner) || !repoPattern.test(repo) || !(number > 0)) {
    throw new PostReviewError(`not a PR reference: ${original}`);
  }
};

export const parsePrRef = (text) => {
  const value = String(text ?? "").trim();
  const url = value.match(/^(?:https?:\/\/)?([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/);
  if (url && hostPattern.test(url[1])) {
    const [, host, owner, repo, digits] = url;
    checkName(owner, repo, Number(digits), value);
    return { host: host.toLowerCase(), owner, repo, number: Number(digits) };
  }
  const short = value.match(/^([^/\s#]+)\/([^/\s#]+)#(\d+)$/);
  if (short) {
    const [, owner, repo, digits] = short;
    checkName(owner, repo, Number(digits), value);
    return { host: defaultHost, owner, repo, number: Number(digits) };
  }
  throw new PostReviewError(`not a PR reference: ${value}`);
};

export const parseRemote = (url) => {
  const value = String(url ?? "").trim();
  const scheme = value.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/[^/]+?\/?$/i);
  const scp = value.match(/^(?:[^@/\s]+@)?([^:/\s]+):([^/\s]+)\/[^/\s]+$/);
  const match = scheme ?? scp;
  if (!match || !hostPattern.test(match[1]) || !ownerPattern.test(match[2])) {
    throw new PostReviewError(`cannot read a host and owner from the remote ${value || "(none)"}`);
  }
  return { host: match[1].toLowerCase(), owner: match[2] };
};

const parseRealm = (entry) => {
  const parts = String(entry).trim().split("/");
  const [host, owner] = parts.length === 1 ? [defaultHost, parts[0]] : parts;
  if (parts.length > 2 || !hostPattern.test(host) || !ownerPattern.test(owner)) {
    throw new PostReviewError(`not a realm, expected <host>/<owner>: ${entry}`);
  }
  return { host: host.toLowerCase(), owner: owner.toLowerCase() };
};

export const checkRealm = (pr, realms) => {
  if (!realms?.length) {
    throw refuse("no realm given; pass --realm <host>/<owner> read from the consuming repository's origin");
  }
  const allowed = realms.map(parseRealm);
  const inside = allowed.some(({ host, owner }) => host === pr.host && owner === pr.owner.toLowerCase());
  if (!inside) {
    const list = allowed.map(({ host, owner }) => `${host}/${owner}`).join(", ");
    throw refuse(`${pr.host}/${pr.owner} is outside the realm (${list})`);
  }
  return true;
};

const unquotePath = (text) => {
  if (!text.startsWith('"') || !text.endsWith('"')) return text;
  const escapes = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '"': 34, "\\": 92 };
  const bytes = [];
  for (let index = 1; index < text.length - 1; index += 1) {
    const character = text[index];
    if (character !== "\\") {
      bytes.push(...Buffer.from(character, "utf8"));
      continue;
    }
    const octal = text.slice(index + 1, index + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      index += 3;
    } else {
      const next = text[index + 1];
      bytes.push(escapes[next] ?? next.charCodeAt(0));
      index += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
};

const newSidePath = (header) => {
  const raw = header.slice(4).replace(/\t$/, "");
  if (raw === "/dev/null") return null;
  const path = unquotePath(raw);
  return path.startsWith("b/") ? path.slice(2) : path;
};

// Hunk bodies are consumed by the counts in their @@ header, so an added line whose text looks
// like "+++ b/x" or "diff --git" is never read as a file header.
export const rightSideLines = (diffText) => {
  const lines = new Map();
  let current = null;
  let remainingOld = 0;
  let remainingNew = 0;
  let newLine = 0;
  for (const raw of String(diffText).split("\n")) {
    if (remainingOld > 0 || remainingNew > 0) {
      const marker = raw[0] ?? " ";
      if (marker === "\\") continue;
      if (marker === "+") {
        current?.add(newLine);
        newLine += 1;
        remainingNew -= 1;
      } else if (marker === "-") {
        remainingOld -= 1;
      } else {
        current?.add(newLine);
        newLine += 1;
        remainingOld -= 1;
        remainingNew -= 1;
      }
      continue;
    }
    if (raw.startsWith("diff --git ")) {
      current = null;
    } else if (raw.startsWith("+++ ")) {
      const path = newSidePath(raw);
      current = path === null ? null : (lines.get(path) ?? lines.set(path, new Set()).get(path));
    } else {
      const hunk = raw.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunk) {
        remainingOld = hunk[1] === undefined ? 1 : Number(hunk[1]);
        newLine = Number(hunk[2]);
        remainingNew = hunk[3] === undefined ? 1 : Number(hunk[3]);
      }
    }
  }
  return lines;
};

const isText = (value) => typeof value === "string" && value.trim() !== "";

export const validateFindings = (findings) => {
  if (findings === null || typeof findings !== "object" || Array.isArray(findings)) {
    throw new PostReviewError("the findings file must hold one JSON object");
  }
  if ("event" in findings && String(findings.event).toUpperCase() !== "COMMENT") {
    throw refuse(`event ${JSON.stringify(findings.event)}; this script posts COMMENT reviews only`);
  }
  const problems = [];
  if (!isText(findings.body)) problems.push("body: a non-empty review body is required (GitHub requires one for COMMENT)");
  const comments = findings.comments ?? [];
  if (!Array.isArray(comments)) problems.push("comments: must be an array");
  const checked = Array.isArray(comments) ? comments : [];
  checked.forEach((comment, index) => {
    const where = `comment ${index + 1}`;
    if (!isText(comment?.path) || comment.path.startsWith("/")) problems.push(`${where}: path must be repository-relative`);
    if (!Number.isInteger(comment?.line) || comment.line < 1) problems.push(`${where}: line must be a positive integer`);
    if (comment?.side !== undefined && comment.side !== "RIGHT") problems.push(`${where}: side must be RIGHT`);
    if (!severities.has(comment?.severity)) problems.push(`${where}: severity must be one of ${[...severities].join(", ")}`);
    if (!isText(comment?.evidence)) problems.push(`${where}: evidence is required; an unverified finding is dropped, not posted`);
    if (!isText(comment?.body)) problems.push(`${where}: body is required`);
  });
  if (problems.length) throw new PostReviewError(`invalid findings:\n- ${problems.join("\n- ")}`);
  return { body: findings.body.trim(), comments: checked };
};

const foldedItem = (comment) => `- \`${comment.path}:${comment.line}\`: ${comment.body.trim().replace(/\n/g, "\n  ")}`;

export const buildReview = ({ findings, diffLines, headSha }) => {
  if (!shaPattern.test(String(headSha))) throw new PostReviewError(`head must be a full 40-character SHA, got ${headSha}`);
  const inDiff = (comment) => diffLines.get(comment.path)?.has(comment.line) === true;
  const inline = findings.comments.filter(inDiff);
  const folded = findings.comments.filter((comment) => !inDiff(comment));
  const body = folded.length
    ? `${findings.body}\n\nOutside the diff:\n${folded.map(foldedItem).join("\n")}`
    : findings.body;
  const payload = {
    commit_id: headSha,
    event: "COMMENT",
    body,
    comments: inline.map(({ path, line, body: text }) => ({ path, line, side: "RIGHT", body: text })),
  };
  return { payload, inline, folded };
};

export const firstSentence = (text) => {
  const line = String(text).trim().split("\n")[0].replace(/\s+/g, " ");
  const sentence = line.match(/^.*?[.?!](?=\s|$)/)?.[0] ?? line;
  return sentence.length > sentenceLimit ? `${sentence.slice(0, sentenceLimit - 1)}…` : sentence;
};

export const matchCommentUrls = (sent, returned) => {
  const unused = [...returned];
  const take = (predicate) => {
    const index = unused.findIndex(predicate);
    return index === -1 ? null : unused.splice(index, 1)[0];
  };
  const lineOf = (comment) => comment.line ?? comment.original_line;
  const exact = sent.map((comment) =>
    take((other) => other.path === comment.path && lineOf(other) === comment.line && other.body === comment.body),
  );
  return sent.map((comment, index) => {
    const match = exact[index] ?? take((other) => other.path === comment.path && lineOf(other) === comment.line);
    return match?.html_url ?? null;
  });
};

export const findExistingReview = (reviews, { viewer, headSha, body }) =>
  reviews.find(
    (review) =>
      review.user?.login?.toLowerCase() === viewer.toLowerCase() &&
      review.commit_id === headSha &&
      review.state === "COMMENTED" &&
      (review.body ?? "").trim() === body.trim(),
  );

const commentLine = (comment, where) => `${comment.path}:${comment.line} — ${firstSentence(comment.body)} — ${where}`;

const planLines = ({ inline, folded }) => [
  ...inline.map((comment) => commentLine(comment, "inline")),
  ...folded.map((comment) => commentLine(comment, "in the review body")),
];

const reportLines = ({ reviewUrl, note, inline, folded, urls }) => [
  `review: ${reviewUrl}${note ? ` (${note})` : ""}`,
  ...inline.map((comment, index) => commentLine(comment, urls[index] ?? "comment URL not returned")),
  ...folded.map((comment) => commentLine(comment, "in the review body")),
];

const callGh = (gh, host, args, input) => {
  const prefix = host === defaultHost ? ["api"] : ["api", "--hostname", host];
  const result = gh([...prefix, ...args], input);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "no output").trim();
    throw new PostReviewError(`gh ${args.join(" ")} failed: ${detail}`, { code: 3 });
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new PostReviewError(`gh ${args.join(" ")} returned output that is not JSON`, { code: 3 });
  }
};

export const postReview = ({ meta, diffText, findings, realms, dryRun, oncePerHead = false, gh }) => {
  const pr = parsePrRef(meta?.url);
  checkRealm(pr, realms);
  const { payload, inline, folded } = buildReview({
    findings: validateFindings(findings),
    diffLines: rightSideLines(diffText),
    headSha: meta.headRefOid,
  });
  if (dryRun) return { posted: false, payload, lines: planLines({ inline, folded }) };

  const base = `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`;
  const viewer = callGh(gh, pr.host, ["user"]).login;
  const current = callGh(gh, pr.host, [base]);
  if (String(current.user?.login).toLowerCase() === String(viewer).toLowerCase()) {
    throw refuse(`${pr.owner}/${pr.repo}#${pr.number} is the operator's own PR`, payload);
  }
  if (current.head?.sha !== meta.headRefOid) {
    throw refuse(`head moved from ${meta.headRefOid} to ${current.head?.sha}; gather the diff again so lines match`, payload);
  }

  const commentUrls = (reviewId) => {
    try {
      return matchCommentUrls(inline, callGh(gh, pr.host, [`${base}/reviews/${reviewId}/comments?per_page=100`]));
    } catch {
      return inline.map(() => null);
    }
  };

  const reviews = callGh(gh, pr.host, [`${base}/reviews?per_page=100`]);
  const existing = findExistingReview(reviews, {
    viewer,
    headSha: meta.headRefOid,
    body: payload.body,
  });
  if (existing) {
    const urls = commentUrls(existing.id);
    const note = "already posted on this head; nothing new posted";
    return { posted: false, payload, lines: reportLines({ reviewUrl: existing.html_url, note, inline, folded, urls }) };
  }
  const onHead = oncePerHead && reviews.find((review) => sameLogin(review.user?.login, viewer) && review.commit_id === meta.headRefOid);
  if (onHead) {
    return { posted: false, payload, lines: [`review: ${onHead.html_url} (already reviewed this head; nothing new posted)`] };
  }

  let review;
  try {
    review = callGh(gh, pr.host, ["--method", "POST", `${base}/reviews`, "--input", "-"], JSON.stringify(payload));
  } catch (error) {
    throw new PostReviewError(error.message, { code: 3, payload });
  }
  const note = review.state && review.state !== "COMMENTED" ? `state is ${review.state}, expected COMMENTED` : "";
  const urls = commentUrls(review.id);
  return { posted: true, payload, lines: reportLines({ reviewUrl: review.html_url, note, inline, folded, urls }) };
};

const replyKinds = {
  review: {
    label: "review comment",
    read: (number, id) => `pulls/comments/${id}`,
    parent: ["pull_request_url", "pulls"],
    time: "created_at",
    threaded: true,
  },
  issue: { label: "comment", read: (number, id) => `issues/comments/${id}`, parent: ["issue_url", "issues"], time: "created_at" },
  "review-body": {
    label: "review",
    read: (number, id) => `pulls/${number}/reviews/${id}`,
    parent: ["pull_request_url", "pulls"],
    time: "submitted_at",
  },
};
const replyLimit = 65536;

const sameLogin = (left, right) => String(left).toLowerCase() === String(right).toLowerCase();

const quoteHeader = (url) => `> In reply to ${url}`;

const checkReplyText = (text) => {
  if (!isText(text)) throw new PostReviewError("the reply body is empty");
  if (text.length > replyLimit) throw new PostReviewError(`the reply is ${text.length} characters; GitHub takes at most 65,536`);
  return text;
};

export const postReply = ({ prUrl, commentId, kind: kindName, body, realms, headSha, dryRun, gh }) => {
  const pr = parsePrRef(prUrl);
  checkRealm(pr, realms);
  const kind = replyKinds[kindName];
  if (!kind) throw new PostReviewError(`--kind must be one of ${Object.keys(replyKinds).join(", ")}, got ${kindName}`);
  if (!/^[1-9]\d*$/.test(String(commentId))) throw new PostReviewError(`--comment must be a numeric comment id, got ${commentId}`);
  if (headSha !== undefined && !shaPattern.test(headSha)) throw new PostReviewError(`--head must be a full 40-character SHA, got ${headSha}`);
  const answer = checkReplyText(String(body ?? "").trim());

  const repoBase = `repos/${pr.owner}/${pr.repo}`;
  const prName = `${pr.owner}/${pr.repo}#${pr.number}`;
  const target = `${kind.label} ${commentId}`;
  const listPath = kind.threaded ? `${repoBase}/pulls/${pr.number}/comments` : `${repoBase}/issues/${pr.number}/comments`;
  const draftFor = ({ root, url }) => ({
    method: "POST",
    path: kind.threaded ? `${listPath}/${root}/replies` : listPath,
    body: kind.threaded ? answer : checkReplyText(`${quoteHeader(url)}\n\n${answer}`),
  });
  if (dryRun) {
    const request = draftFor({ root: commentId, url: `<link to ${target}>` });
    return { posted: false, request, lines: [`reply: dry run for ${target} on ${prName}; the thread root and link are read when posting`] };
  }

  const viewer = callGh(gh, pr.host, ["user"]).login;
  const current = callGh(gh, pr.host, [`${repoBase}/pulls/${pr.number}`]);
  if (sameLogin(current.user?.login, viewer)) throw refuse(`${prName} is the operator's own PR`);
  if (current.state !== "open") throw refuse(`${prName} is ${current.state}, not open`);
  if (headSha !== undefined && current.head?.sha !== headSha) {
    throw refuse(`head moved from ${headSha} to ${current.head?.sha}; draft the reply again against the new head`);
  }

  let comment;
  try {
    comment = callGh(gh, pr.host, [`${repoBase}/${kind.read(pr.number, commentId)}`]);
  } catch (error) {
    if (/HTTP 404\b/.test(error.message)) throw refuse(`target not found on this PR: ${target} on ${prName}`);
    throw error;
  }
  const [parentField, parentPath] = kind.parent;
  if (!String(comment[parentField]).endsWith(`/${parentPath}/${pr.number}`)) throw refuse(`${target} is not on ${prName}`);
  if (sameLogin(comment.user?.login, viewer)) throw refuse(`${target} is the operator's own`);
  if (comment.user?.type === "Bot") throw refuse(`${target} is by the bot ${comment.user.login}`);

  // GitHub takes a reply only on a thread's root, and every reply's in_reply_to_id names that root.
  const root = comment.in_reply_to_id ?? comment.id;
  const draft = draftFor({ root, url: comment.html_url });
  const postedAt = new Date(comment[kind.time]);
  if (Number.isNaN(postedAt.getTime())) throw new PostReviewError(`${target} has no readable ${kind.time}`, { code: 3 });
  const header = quoteHeader(comment.html_url);
  const answers = (other) =>
    kind.threaded ? other.in_reply_to_id === root : String(other.body ?? "").split(/\r?\n/).some((line) => line.trim() === header);
  const existing = callGh(gh, pr.host, [`${listPath}?since=${postedAt.toISOString()}&per_page=100`]).find(
    (other) => sameLogin(other.user?.login, viewer) && new Date(other.created_at) > postedAt && answers(other),
  );
  if (existing) return { posted: false, request: draft, lines: [`reply: ${existing.html_url} (already replied; nothing new posted)`] };

  let reply;
  try {
    reply = callGh(gh, pr.host, ["--method", "POST", draft.path, "--input", "-"], JSON.stringify({ body: draft.body }));
  } catch (error) {
    throw new PostReviewError(error.message, { code: 3, payload: draft });
  }
  return { posted: true, request: draft, lines: [`reply: ${reply.html_url}`] };
};

const parseArgs = (argv) => {
  const [command, ...rest] = argv;
  const options = { command, realms: [], dryRun: false, help: command === "--help" || command === "-h" };
  const valued = {
    "--meta": "meta",
    "--diff": "diff",
    "--findings": "findings",
    "--event": "event",
    "--pr": "pr",
    "--comment": "comment",
    "--kind": "kind",
    "--body-file": "bodyFile",
    "--head": "head",
  };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag === "--dry-run") {
      options.dryRun = true;
    } else if (flag === "--once-per-head") {
      options.oncePerHead = true;
    } else if (flag === "--help" || flag === "-h") {
      options.help = true;
    } else if ((flag === "--realm" || valued[flag]) && value !== undefined && !value.startsWith("--")) {
      if (flag === "--realm") options.realms.push(value);
      else options[valued[flag]] = value;
      index += 1;
    } else {
      throw new PostReviewError(`unexpected argument ${flag}\n${usage}`);
    }
  }
  if (command === "reply" && options.event !== undefined) {
    throw refuse(`event ${options.event}; a reply is a plain comment and carries no review event`);
  }
  if (options.event !== undefined && options.event.toUpperCase() !== "COMMENT") {
    throw refuse(`event ${options.event}; this script posts COMMENT reviews only`);
  }
  if (!options.help && command === "post" && (!options.meta || !options.diff || !options.findings)) {
    throw new PostReviewError(`--meta, --diff, and --findings are required\n${usage}`);
  }
  if (!options.help && command === "reply" && (!options.pr || !options.comment || !options.kind || !options.bodyFile)) {
    throw new PostReviewError(`--pr, --comment, --kind, and --body-file are required\n${usage}`);
  }
  if (!options.help && command !== "post" && command !== "realm" && command !== "reply") {
    throw new PostReviewError(usage);
  }
  return options;
};

const readText = (path, label) => {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new PostReviewError(`cannot read ${label} ${path}: ${error.code ?? error.message}`);
  }
};

const readJson = (path, label) => {
  try {
    return JSON.parse(readText(path, label));
  } catch (error) {
    if (error instanceof PostReviewError) throw error;
    throw new PostReviewError(`${label} ${path} is not JSON: ${error.message}`);
  }
};

const runGh = (args, input) => {
  const result = spawnSync("gh", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) return { status: 1, stdout: "", stderr: `cannot run gh: ${result.error.code ?? result.error.message}` };
  return result;
};

const main = () => {
  const drafted = process.argv[2] === "reply" ? "reply" : "review";
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage}\n`);
      return;
    }
    if (options.command === "realm") {
      const origin = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
      if (origin.status !== 0) throw refuse("this repository has no origin remote, so there is no realm to compare against");
      const { host, owner } = parseRemote(origin.stdout);
      process.stdout.write(`${host}/${owner}\n`);
      return;
    }
    if (options.command === "reply") {
      const result = postReply({
        prUrl: options.pr,
        commentId: options.comment,
        kind: options.kind,
        body: readText(options.bodyFile, "reply body"),
        realms: options.realms,
        headSha: options.head,
        dryRun: options.dryRun,
        gh: runGh,
      });
      if (options.dryRun) process.stdout.write(`${JSON.stringify(result.request, null, 2)}\n`);
      process.stdout.write(`${result.lines.join("\n")}\n`);
      return;
    }
    const result = postReview({
      meta: readJson(options.meta, "PR metadata"),
      diffText: readText(options.diff, "diff"),
      findings: readJson(options.findings, "findings"),
      realms: options.realms,
      dryRun: options.dryRun,
      oncePerHead: options.oncePerHead,
      gh: runGh,
    });
    if (options.dryRun) process.stdout.write(`${JSON.stringify(result.payload, null, 2)}\n`);
    process.stdout.write(`${result.lines.join("\n")}\n`);
  } catch (error) {
    process.stderr.write(`post-review: ${error?.message ?? error}\n`);
    if (error?.payload) {
      process.stdout.write(`drafted ${drafted}, not posted:\n${JSON.stringify(error.payload, null, 2)}\n`);
    }
    process.exitCode = error instanceof PostReviewError ? error.code : 1;
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
