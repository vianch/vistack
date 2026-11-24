import { firstLine } from "./collect-lib.mjs";

export const defaultHost = "github.com";
export const hostPattern = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?$/;
export const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const repositoryNamePattern = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const issueFieldNames = /\b(?:issueType|parent)\b/;
const searchCap = 1000;
const pageSize = 50;
const lower = (value) => String(value ?? "").toLowerCase();

export const searchRange = (window) => {
  const utc = (instant) => new Date(instant).toISOString().replace(/\.\d{3}Z$/, "+00:00");
  return { since: utc(window.since), range: `${utc(window.since)}..${utc(window.until)}` };
};

const onTypes = (types, fields) => types.map((type) => `... on ${type} { ${fields} }`).join(" ");
const repositoryField = "repository { nameWithOwner }";
const pullRequestFields = `number title url state createdAt mergedAt closedAt additions deletions ${repositoryField}`;
const issueFields = (typed, solved) =>
  [
    `number title url state stateReason createdAt closedAt ${repositoryField} assignees(first: 20) { nodes { login } }`,
    typed ? "issueType { name } parent { number }" : "",
    solved
      ? "closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { state author { login } } } timelineItems(last: 5, itemTypes: [CLOSED_EVENT]) { nodes { __typename ... on ClosedEvent { closer { __typename ... on PullRequest { author { login } } } } } }"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

export const searchPlans = [
  { source: "pullRequests", terms: (login, range) => `is:pr author:${login} created:${range.range}`, select: () => onTypes(["PullRequest"], pullRequestFields) },
  { source: "pullRequests", terms: (login, range) => `is:pr author:${login} merged:>=${range.since}`, select: () => onTypes(["PullRequest"], pullRequestFields) },
  { source: "pullRequests", terms: (login, range) => `is:pr author:${login} closed:>=${range.since}`, select: () => onTypes(["PullRequest"], pullRequestFields) },
  { source: "pullRequests", terms: (login) => `is:pr is:open author:${login}`, select: () => onTypes(["PullRequest"], pullRequestFields) },
  {
    source: "reviews",
    reviewer: true,
    terms: (login, range) => `is:pr reviewed-by:${login} -author:${login} updated:>=${range.since}`,
    select: () => onTypes(["PullRequest"], `number title url ${repositoryField} reviews(author: $login, first: 100) { totalCount nodes { submittedAt state author { login } comments { totalCount } } }`),
  },
  { source: "comments", terms: (login, range) => `commenter:${login} updated:>=${range.since}`, select: () => onTypes(["Issue", "PullRequest"], `number ${repositoryField} comments(last: 100) { totalCount nodes { author { login } createdAt } }`) },
  { source: "issuesCreated", typed: true, terms: (login, range) => `is:issue author:${login} created:${range.range}`, select: (typed) => onTypes(["Issue"], issueFields(typed, false)) },
  { source: "issuesSolved", typed: true, terms: (login, range) => `is:issue closed:${range.range} reason:completed assignee:${login}`, select: (typed) => onTypes(["Issue"], issueFields(typed, true)) },
  { source: "issuesSolved", typed: true, terms: (login, range) => `is:issue closed:${range.range} reason:completed`, select: (typed) => onTypes(["Issue"], issueFields(typed, true)) },
];

export const buildQuery = (plan, typed) =>
  `query($searchQuery: String!, $first: Int!, $endCursor: String${plan.reviewer ? ", $login: String!" : ""}) { search(query: $searchQuery, type: ISSUE, first: $first, after: $endCursor) { issueCount pageInfo { hasNextPage endCursor } nodes { __typename ${plan.select(typed)} } } }`;

export const apiPrefix = (host) => (host === defaultHost ? ["api"] : ["api", "--hostname", host]);

export const graphqlArgs = ({ host, query, searchQuery, login, endCursor }) => [
  ...apiPrefix(host),
  "graphql",
  "-f",
  `query=${query}`,
  "-f",
  `searchQuery=${searchQuery}`,
  "-F",
  `first=${pageSize}`,
  ...(login ? ["-f", `login=${login}`] : []),
  ...(endCursor ? ["-f", `endCursor=${endCursor}`] : []),
];

export const readSearchPage = (response) => {
  const search = response?.data?.search;
  if (!search || !Array.isArray(search.nodes)) throw new Error("GitHub search returned no search result");
  return {
    nodes: search.nodes.filter((node) => node?.__typename),
    issueCount: search.issueCount ?? 0,
    hasNextPage: Boolean(search.pageInfo?.hasNextPage),
    endCursor: search.pageInfo?.endCursor ?? null,
  };
};

const isSubject = (actor, login) => actor != null && lower(actor.login) === lower(login);
const nodeKey = (node) => `${lower(node.repository?.nameWithOwner)}#${node.number}`;
const itemBase = (node) => ({ repository: node.repository?.nameWithOwner ?? "", number: node.number, title: node.title ?? "", url: node.url ?? "" });

export const uniqueNodes = (nodes) => [...new Map(nodes.map((node) => [nodeKey(node), node])).values()];

export const toPullRequest = (node) => ({
  ...itemBase(node),
  state: lower(node.state),
  created_at: node.createdAt,
  merged_at: node.mergedAt ?? null,
  closed_at: node.closedAt ?? null,
  additions: node.additions ?? 0,
  deletions: node.deletions ?? 0,
});

export const toReviews = (node, login) =>
  (node.reviews?.nodes ?? [])
    .filter((review) => review?.submittedAt && review.state !== "PENDING" && isSubject(review.author, login))
    .map((review) => ({ ...itemBase(node), submitted_at: review.submittedAt, state: review.state, comments: review.comments?.totalCount ?? 0 }));

export const reviewsCut = (node) => (node.reviews?.totalCount ?? 0) > (node.reviews?.nodes?.length ?? 0);

export const toComments = (node, login) =>
  (node.comments?.nodes ?? [])
    .filter((comment) => isSubject(comment?.author, login))
    .map((comment) => ({ repository: node.repository?.nameWithOwner ?? "", number: node.number, created_at: comment.createdAt }));

export const commentsCut = (node, since) => {
  const nodes = node.comments?.nodes ?? [];
  return (node.comments?.totalCount ?? 0) > nodes.length && (nodes.length === 0 || Date.parse(nodes[0].createdAt) >= since);
};

const closedBySubject = (node, login) => {
  const referenced = (node.closedByPullRequestsReferences?.nodes ?? []).some((pull) => pull?.state === "MERGED" && isSubject(pull.author, login));
  const closer = (node.timelineItems?.nodes ?? []).filter((event) => event?.__typename === "ClosedEvent").at(-1)?.closer;
  return referenced || (closer?.__typename === "PullRequest" && isSubject(closer.author, login));
};

export const toIssue = (node, { login, typed }) => ({
  ...itemBase(node),
  type: (typed && node.issueType?.name) || "Other",
  sub_issue: typed ? node.parent != null : null,
  state: lower(node.state),
  created_at: node.createdAt,
  closed_at: node.closedAt ?? null,
  solved: node.stateReason === "COMPLETED" && ((node.assignees?.nodes ?? []).some((user) => isSubject(user, login)) || closedBySubject(node, login)),
});

const normalizers = {
  pullRequests: (nodes) => ({ records: nodes.map(toPullRequest), cut: false }),
  reviews: (nodes, { login }) => ({ records: nodes.flatMap((node) => toReviews(node, login)), cut: nodes.some(reviewsCut) }),
  comments: (nodes, { login, since }) => ({ records: nodes.flatMap((node) => toComments(node, login)), cut: nodes.some((node) => commentsCut(node, since)) }),
  issuesCreated: (nodes, context) => ({ records: nodes.map((node) => toIssue(node, context)), cut: false }),
  issuesSolved: (nodes, context) => ({ records: nodes.map((node) => toIssue(node, context)), cut: false }),
};

export const normalizeNodes = (source, nodes, context) => normalizers[source](uniqueNodes(nodes), context);

export const normalizeRemote = (remote) => {
  const trimmed = String(remote ?? "").trim();
  const match = /^[\w.-]+@([\w.-]+):(.+)$/.exec(trimmed) ?? /^[a-z+]+:\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/(.+)$/i.exec(trimmed);
  if (!match) return null;
  const [owner, repository, ...rest] = match[2].replace(/\/+$/, "").replace(/\.git$/, "").split("/");
  if (rest.length || !ownerPattern.test(owner) || !repositoryNamePattern.test(repository ?? "")) return null;
  return { host: match[1].toLowerCase(), owner, name: `${owner}/${repository}` };
};

export const insideRealm = (repository, realms) =>
  realms.some(({ host, owner }) => host === repository.host && owner === repository.owner.toLowerCase());

export const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const callGraphql = (run, request) => {
  const result = run("gh", graphqlArgs(request));
  const response = parseJson(result.stdout);
  const messages = (response?.errors ?? []).map((error) => String(error?.message ?? ""));
  if (result.status !== 0 || messages.length) {
    const error = new Error(messages[0] || firstLine(result.stderr));
    error.issueFieldsUnsupported = issueFieldNames.test([result.stderr, ...messages].join("\n"));
    throw error;
  }
  return readSearchPage(response);
};

export const searchAll = (run, request, pageLimit) => {
  const nodes = [];
  let truncated = false;
  for (let page = 1, endCursor = null; ; page += 1) {
    const result = callGraphql(run, { ...request, endCursor });
    nodes.push(...result.nodes);
    truncated ||= result.issueCount > searchCap;
    if (!result.hasNextPage) return { nodes, truncated };
    if (page >= pageLimit) return { nodes, truncated: true };
    endCursor = result.endCursor;
  }
};

const ownerOf = (repository) => lower(String(repository ?? "").split("/")[0]);
export const insideOwners = (nodes, owners) => nodes.filter((node) => owners.has(ownerOf(node.repository?.nameWithOwner)));

const recordKeyFields = { reviews: ["submitted_at"], comments: ["created_at"] };
export const uniqueRecords = (source, records) => {
  const keyOf = (record) => [lower(record.repository), record.number, ...(recordKeyFields[source] ?? []).map((field) => record[field])].join("#");
  return [...new Map(records.map((record) => [keyOf(record), record])).values()];
};
