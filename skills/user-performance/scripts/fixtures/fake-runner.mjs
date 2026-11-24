import { readFileSync } from "node:fs";
import { basename } from "node:path";

export const loadWorld = () => JSON.parse(readFileSync(new URL("./world.json", import.meta.url), "utf8"));

const searchKinds = [
  ["created", /^is:pr author:\S+ created:/],
  ["merged", /^is:pr author:\S+ merged:/],
  ["closed", /^is:pr author:\S+ closed:/],
  ["open", /^is:pr is:open author:/],
  ["reviewed", /^is:pr reviewed-by:/],
  ["commented", /^commenter:/],
  ["issues-created", /^is:issue author:/],
  ["solved-assigned", /^is:issue closed:\S+ reason:completed assignee:/],
  ["solved-closed", /^is:issue closed:/],
];
const rejection = "Field 'issueType' doesn't exist on type 'Issue'";

export const rawField = (args, name) => args.find((arg, index) => args[index - 1] === "-f" && arg.startsWith(`${name}=`))?.slice(name.length + 1);

const reply = (status, stdout, stderr = "") => ({ status, stdout, stderr });

const commitsByAuthor = (log, args) => {
  const authors = args.filter((arg) => arg.startsWith("--author=")).map((arg) => arg.slice("--author=".length));
  const fold = (text) => (args.includes("-i") ? text.toLowerCase() : text);
  const [before, ...chunks] = log.split("\x1e");
  const matching = chunks.filter((chunk) => !authors.length || authors.some((author) => fold(chunk.split("\x1f")[1] ?? "").includes(fold(author))));
  return [before, ...matching].join("\x1e");
};

const git = (world, args) => {
  const checkout = world.checkouts[basename(args[1])];
  if (!checkout) return reply(128, "", "fatal: not a git repository");
  if (args[2] === "remote") return checkout.origin ? reply(0, `${checkout.origin}\n`) : reply(2, "", "error: No such remote 'origin'\n");
  if (args[2] === "config") return checkout.email ? reply(0, `${checkout.email}\n`) : reply(1, "");
  if (args[2] === "log") return reply(0, commitsByAuthor(checkout.log ?? "", args));
  return reply(1, "", `unexpected git ${args[2]}`);
};

const search = (world, args, rejectIssueFields) => {
  const query = rawField(args, "query");
  if (rejectIssueFields && /issueType|parent/.test(query)) {
    const body = JSON.stringify({ errors: [{ message: rejection }] });
    return rejectIssueFields === "errors" ? reply(0, body) : reply(1, body, `gh: ${rejection}\n`);
  }
  const searchQuery = rawField(args, "searchQuery");
  const [kind] = searchKinds.find(([, pattern]) => pattern.test(searchQuery));
  const target = /(?:repo|org):(\S+)$/.exec(searchQuery)[1].split("/").at(-1);
  const pages = world.searches[`${target} ${kind}`] ?? [{ nodes: [] }];
  const index = Number(rawField(args, "endCursor")?.replace("cursor-", "") ?? 0);
  const issueCount = pages[0].issueCount ?? pages.reduce((total, page) => total + page.nodes.length, 0);
  const pageInfo = { hasNextPage: index < pages.length - 1, endCursor: `cursor-${index + 1}` };
  return reply(0, JSON.stringify({ data: { search: { issueCount, pageInfo, nodes: pages[index].nodes } } }));
};

export const fakeRunner = (world, { fail = () => undefined, rejectIssueFields = false } = {}) => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    const failure = fail(command, args);
    if (failure) return reply(1, "", failure);
    if (command === "git") return git(world, args);
    const rest = args[1] === "--hostname" ? args.slice(3) : args.slice(1);
    if (rest[0] === "user") return reply(0, JSON.stringify(world.user));
    return search(world, rest, rejectIssueFields);
  };
  return { run, calls };
};

export const listWorld = (world) => Object.keys(world.checkouts).sort().map((name) => ({ name, symlink: Boolean(world.checkouts[name].symlink) }));
