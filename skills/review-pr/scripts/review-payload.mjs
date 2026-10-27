import { PostReviewError, refuse } from "./review-error.mjs";

const severities = new Set(["bug", "risk", "nit", "question"]);
export const shaPattern = /^[0-9a-f]{40}$/;

export const isText = (value) => typeof value === "string" && value.trim() !== "";

const isRightSide = (side) => side === undefined || side === "RIGHT";

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
    if (!isRightSide(comment?.side)) problems.push(`${where}: side must be RIGHT`);
    if (!isRightSide(comment?.start_side)) problems.push(`${where}: start_side must be RIGHT`);
    const startLine = comment?.start_line;
    if (startLine !== undefined && (!Number.isInteger(startLine) || startLine < 1 || !(startLine < comment.line))) {
      problems.push(`${where}: start_line must be a positive integer below line`);
    }
    if (comment?.suggestion !== undefined && typeof comment.suggestion !== "string") problems.push(`${where}: suggestion must be a string`);
    if (!severities.has(comment?.severity)) problems.push(`${where}: severity must be one of ${[...severities].join(", ")}`);
    if (!isText(comment?.evidence)) problems.push(`${where}: evidence is required; an unverified finding is dropped, not posted`);
    if (!isText(comment?.body)) problems.push(`${where}: body is required`);
  });
  if (problems.length) throw new PostReviewError(`invalid findings:\n- ${problems.join("\n- ")}`);
  return { body: findings.body.trim(), comments: checked };
};

export const commentLocation = (comment) =>
  `${comment.path}:${comment.start_line === undefined ? comment.line : `${comment.start_line}-${comment.line}`}`;

export const fence = (info, text) => {
  const longestBacktickRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(Math.max(3, longestBacktickRun + 1));
  const closingBreak = text === "" || text.endsWith("\n") ? "" : "\n";
  return `${ticks}${info}\n${text}${closingBreak}${ticks}`;
};

const postedBody = (comment) =>
  comment.suggestion === undefined ? comment.body : `${comment.body.trimEnd()}\n\n${fence("suggestion", comment.suggestion)}`;

const foldedItem = (comment) => {
  const item = `- \`${commentLocation(comment)}\`: ${comment.body.trim().replace(/\n/g, "\n  ")}`;
  if (comment.suggestion === undefined) return item;
  return `${item}\n\n  ${fence("", comment.suggestion).replace(/\n/g, "\n  ")}`;
};

const coversRange = (lines, firstLine, lastLine) => {
  for (let line = firstLine; line <= lastLine; line += 1) {
    if (!lines.has(line)) return false;
  }
  return true;
};

const inlineComment = (comment) => ({
  path: comment.path,
  ...(comment.start_line === undefined ? {} : { start_line: comment.start_line, start_side: "RIGHT" }),
  line: comment.line,
  side: "RIGHT",
  body: postedBody(comment),
});

export const buildReview = ({ findings, diffLines, headSha, pending = false }) => {
  if (!shaPattern.test(String(headSha))) throw new PostReviewError(`head must be a full 40-character SHA, got ${headSha}`);
  const inDiff = (comment) => {
    const lines = diffLines.get(comment.path);
    return lines !== undefined && coversRange(lines, comment.start_line ?? comment.line, comment.line);
  };
  const inline = findings.comments.filter(inDiff);
  const folded = findings.comments.filter((comment) => !inDiff(comment));
  const body = folded.length
    ? `${findings.body}\n\nOutside the diff:\n${folded.map(foldedItem).join("\n")}`
    : findings.body;
  const payload = {
    commit_id: headSha,
    ...(pending ? {} : { event: "COMMENT" }),
    body,
    comments: inline.map(inlineComment),
  };
  return { payload, inline, folded };
};
