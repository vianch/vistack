#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { lstat, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const defaultPort = 47319;
const defaultHost = "127.0.0.1";
const defaultFlowsRoot = join(homedir(), ".claude", "workflow-docs", "projects");
const serverScript = resolve(process.argv[1]);
const parsed = parseArguments(process.argv.slice(2));
const port = parsed.port;
const pidPath = join(tmpdir(), `vistack-visualizer-${hash(`${parsed.repo}:${port}`)}.json`);

const fallbackFlow = {
  app: { name: "Engineering control room", description: "Live workflow state" },
  columns: [
    { id: "actors", label: "ACTORS" },
    { id: "entry", label: "PLUGIN ENTRY" },
    { id: "workflow", label: "PLAYBOOKS" },
    { id: "roles", label: "ROLE AGENTS" },
    { id: "governance", label: "PRINCIPLES + SPECIALISTS" },
    { id: "state", label: "STATE + EVIDENCE" },
    { id: "external", label: "PROJECT / GIT SERVICES" },
  ],
  components: [],
  flows: [],
};

const memory = {
  git: { at: 0, value: null },
  prs: { at: 0, value: null },
  flow: { at: 0, value: null },
  inventory: { at: 0, value: null },
};

if (parsed.help) {
  printHelp();
  process.exit(0);
}

if (parsed.mode === "enable") {
  await enableServer();
} else if (parsed.mode === "disable") {
  await disableServer();
} else if (parsed.mode === "status") {
  await printStatus();
} else {
  await serve();
}

function parseArguments(args) {
  const options = {
    flows: process.env.VISTACK_FLOWS ?? null,
    host: process.env.VISTACK_VISUALIZER_HOST ?? defaultHost,
    mode: "serve",
    offline: false,
    port: Number(process.env.VISTACK_VISUALIZER_PORT ?? defaultPort),
    prData: process.env.VISTACK_PR_DATA ?? null,
    repo: process.env.VISTACK_REPO_ROOT ?? repositoryRoot,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--enable") options.mode = "enable";
    else if (arg === "--disable") options.mode = "disable";
    else if (arg === "--status") options.mode = "status";
    else if (arg === "--serve") options.mode = "serve";
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--port") options.port = Number(args[++index]);
    else if (arg === "--host") options.host = args[++index];
    else if (arg === "--repo") options.repo = resolve(args[++index]);
    else if (arg === "--flows") options.flows = resolve(args[++index]);
    else if (arg === "--pr-data") options.prData = resolve(args[++index]);
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  if (!options.repo) throw new Error("--repo cannot be empty");
  return options;
}

async function enableServer() {
  const current = await readPidRecord();
  if (current && isProcessRunning(current.pid)) {
    console.log(`visualizer already enabled at http://${parsed.host}:${current.port}`);
    return;
  }

  await removePidRecord();
  const childArgs = [serverScript, "--serve", "--host", parsed.host, "--port", String(port), "--repo", parsed.repo];
  if (parsed.offline) childArgs.push("--offline");
  if (parsed.flows) childArgs.push("--flows", parsed.flows);
  if (parsed.prData) childArgs.push("--pr-data", parsed.prData);
  const child = (await import("node:child_process")).spawn(process.execPath, childArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    const record = await readPidRecord();
    if (record && record.pid === child.pid) {
      console.log(`visualizer enabled at http://${parsed.host}:${record.port}`);
      return;
    }
  }
  throw new Error("visualizer process did not publish its status file");
}

async function disableServer() {
  const current = await readPidRecord();
  if (!current) {
    console.log("visualizer already disabled");
    return;
  }
  if (isProcessRunning(current.pid)) {
    process.kill(current.pid, "SIGTERM");
    console.log(`visualizer disabled (pid ${current.pid})`);
  } else {
    console.log("visualizer was not running; removed stale status");
  }
  await removePidRecord();
}

async function printStatus() {
  const current = await readPidRecord();
  if (!current || !isProcessRunning(current.pid)) {
    if (current) await removePidRecord();
    console.log(JSON.stringify({ enabled: false, pid: null, port, repo: parsed.repo }, null, 2));
    return;
  }
  console.log(JSON.stringify({ ...current, enabled: true }, null, 2));
}

async function serve() {
  const current = await readPidRecord();
  if (current && current.pid !== process.pid && isProcessRunning(current.pid)) {
    throw new Error(`visualizer is already running at http://${parsed.host}:${current.port}`);
  }

  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, server);
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  const close = async () => {
    await removePidRecord();
    server.close(() => process.exit(0));
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, parsed.host, resolvePromise);
  });

  await writePidRecord({
    pid: process.pid,
    port,
    repo: parsed.repo,
    startedAt: new Date().toISOString(),
  });
  console.log(`visualizer listening at http://${parsed.host}:${port}`);
}

async function handleRequest(request, response, server) {
  const url = new URL(request.url ?? "/", `http://${parsed.host}:${port}`);
  if (url.pathname === "/api/snapshot") {
    sendJson(response, 200, await createSnapshot());
    return;
  }
  if (url.pathname === "/api/server/disable" && request.method === "POST") {
    sendJson(response, 200, { enabled: false });
    setTimeout(async () => {
      await removePidRecord();
      server.close();
    }, 25);
    return;
  }
  if (url.pathname !== "/" && url.pathname !== "/index.html") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  const content = await readFile(join(repositoryRoot, "visualizer", "index.html"));
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(content);
}

async function createSnapshot() {
  const [runs, ledgerRows, flow, inventory, git, pullRequests] = await Promise.all([
    readRuns(),
    readLedgerRows(),
    loadFlow(),
    loadInventory(),
    readGitSnapshot(),
    loadPullRequests(),
  ]);
  const activeRun = runs.find((run) => !["merge-ready", "paused", "blocked"].includes(run.phase)) ?? runs[0] ?? null;
  const agents = runs.flatMap((run) => toAgentRows(run));
  const activity = createActivityOverlay(activeRun, agents, ledgerRows, pullRequests.items);

  return {
    generatedAt: new Date().toISOString(),
    repo: { root: parsed.repo, ...git },
    source: {
      flows: flow.source,
      inventory: "repository",
      prs: pullRequests.source,
      state: runs.length > 0 ? "repository state roots" : "no state file found",
    },
    run: activeRun,
    runs,
    agents,
    ledger: ledgerRows.slice(-40).reverse(),
    pullRequests: pullRequests.items,
    activity,
    flow: flow.value,
    inventory,
  };
}

function createActivityOverlay(run, agents, ledgerRows, pullRequests) {
  const openPullRequests = pullRequests.filter((pullRequest) => String(pullRequest.state).toUpperCase() === "OPEN");
  const openThreads = openPullRequests.reduce((total, pullRequest) => total + Number(pullRequest.comments?.unaddressed ?? 0), 0);
  const activeAgents = agents.filter((agent) => agent.role !== "coordinator" && !["complete", "done", "merge-ready"].includes(String(agent.phase).toLowerCase()));
  const latestEvidence = ledgerRows.at(-1)?.evidence ?? activeAgents[0]?.lastEvidence ?? run?.statePath ?? null;
  return {
    status: run?.phase ?? "idle",
    playbook: run?.playbook ?? null,
    objective: run?.objective ?? null,
    activeAgents: activeAgents.map((agent) => ({ role: agent.role, slice: agent.slice, phase: agent.phase, branch: agent.branch })),
    review: { openPullRequests: openPullRequests.length, openThreads },
    evidence: { count: ledgerRows.length, latest: latestEvidence },
    updatedAt: run?.updated_at ?? run?.updatedAt ?? ledgerRows.at(-1)?.ts ?? null,
  };
}

async function readRuns() {
  const roots = [join(parsed.repo, ".claude", "state"), join(parsed.repo, ".codex", "vistack", "state")];
  const files = [];
  for (const root of roots) {
    for (const entry of await readDirectory(root)) {
      if (entry.endsWith(".json")) files.push(join(root, entry));
    }
  }
  const runs = [];
  for (const file of files) {
    try {
      const value = JSON.parse(await readFile(file, "utf8"));
      runs.push({ ...value, statePath: relative(parsed.repo, file) });
    } catch {
      // A half-written state file is ignored until the next refresh.
    }
  }
  return runs.sort((left, right) => String(right.updated_at ?? right.updatedAt ?? "").localeCompare(String(left.updated_at ?? left.updatedAt ?? "")));
}

async function readLedgerRows() {
  const roots = [join(parsed.repo, ".claude", "state"), join(parsed.repo, ".codex", "vistack", "state")];
  const rows = [];
  for (const root of roots) {
    for (const entry of await readDirectory(root)) {
      if (!entry.endsWith(".tsv")) continue;
      const file = join(root, entry);
      const text = await readFile(file, "utf8").catch(() => "");
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        const [ts, phase, slice, decision, reason, evidence, result] = line.split("\t");
        rows.push({ ts, phase, slice, decision, reason, evidence, result, ledgerPath: relative(parsed.repo, file) });
      }
    }
  }
  return rows.sort((left, right) => String(left.ts).localeCompare(String(right.ts)));
}

function toAgentRows(run) {
  const slices = Object.entries(run.slices ?? {});
  const coordinator = {
    id: `${run.slug ?? "run"}:coordinator`,
    role: "coordinator",
    model: "opus",
    phase: run.phase ?? "unknown",
    slice: "run",
    branch: run.base_branch ?? run.baseBranch ?? "-",
    worktree: "-",
    pr: null,
    lastEvidence: run.monitor?.last_progress_at ?? run.monitor?.lastProgressAt ?? run.statePath,
    monitor: run.monitor ?? null,
  };
  return [coordinator, ...slices.map(([slice, value]) => ({
    id: `${run.slug ?? "run"}:${slice}`,
    role: value.agent ?? "implementer",
    model: value.model ?? "-",
    phase: value.phase ?? "planned",
    slice,
    branch: value.branch ?? "-",
    worktree: value.worktree ?? "-",
    pr: value.pr ?? null,
    lastEvidence: value.last_evidence ?? value.lastEvidence ?? value.session_id ?? "-",
    monitor: null,
  }))];
}

async function loadFlow() {
  if (memory.flow.value && Date.now() - memory.flow.at < 30000) return memory.flow;
  const candidate = parsed.flows ?? await discoverFlowsFile();
  if (!candidate) {
    memory.flow = { at: Date.now(), source: "built-in", value: fallbackFlow };
    return memory.flow;
  }
  try {
    memory.flow = { at: Date.now(), source: candidate, value: JSON.parse(await readFile(candidate, "utf8")) };
  } catch {
    memory.flow = { at: Date.now(), source: "built-in after unreadable source", value: fallbackFlow };
  }
  return memory.flow;
}

async function discoverFlowsFile() {
  const candidates = [join(parsed.repo, "flows.json")];
  if (defaultFlowsRoot) {
    for (const project of await readDirectory(defaultFlowsRoot)) {
      candidates.push(join(defaultFlowsRoot, project, "flows.json"));
    }
  }
  const existing = [];
  for (const candidate of candidates) {
    if (await exists(candidate)) existing.push(candidate);
  }
  if (existing.length === 0) return null;
  const withTimes = await Promise.all(existing.map(async (candidate) => ({ candidate, modified: (await stat(candidate)).mtimeMs })));
  return withTimes.sort((left, right) => right.modified - left.modified)[0].candidate;
}

async function loadInventory() {
  if (memory.inventory.value && Date.now() - memory.inventory.at < 30000) return memory.inventory.value;
  const skillEntries = await readDirectory(join(parsed.repo, "skills"));
  const skills = [];
  for (const entry of skillEntries) {
    if (entry.startsWith(".")) continue;
    if (await exists(join(parsed.repo, "skills", entry, "SKILL.md"))) skills.push(entry);
  }
  const playbookEntries = await readDirectory(join(parsed.repo, "skills", "vistack", "playbooks"));
  const playbooks = playbookEntries.filter((entry) => entry.endsWith(".md")).map((entry) => entry.slice(0, -3));
  memory.inventory = { at: Date.now(), value: { skills: skills.sort(), playbooks: playbooks.sort() } };
  return memory.inventory.value;
}

async function readGitSnapshot() {
  if (memory.git.value && Date.now() - memory.git.at < 5000) return memory.git.value;
  const branch = await command("git", ["-C", parsed.repo, "branch", "--show-current"]);
  const status = await command("git", ["-C", parsed.repo, "status", "--porcelain"]);
  const value = {
    branch: branch.stdout.trim() || "detached",
    dirty: status.stdout.trim().length > 0,
    statusCount: status.stdout.trim() ? status.stdout.trim().split(/\r?\n/).length : 0,
  };
  memory.git = { at: Date.now(), value };
  return value;
}

async function loadPullRequests() {
  if (memory.prs.value && Date.now() - memory.prs.at < 15000) return memory.prs.value;
  if (parsed.prData) {
    try {
      const raw = JSON.parse(await readFile(parsed.prData, "utf8"));
      const items = Array.isArray(raw) ? raw : raw.pullRequests ?? raw.items ?? [];
      memory.prs = { at: Date.now(), value: { source: parsed.prData, items: normalizePullRequests(items) } };
      return memory.prs.value;
    } catch (error) {
      memory.prs = { at: Date.now(), value: { source: `fixture error: ${error.message}`, items: [] } };
      return memory.prs.value;
    }
  }
  if (parsed.offline) {
    memory.prs = { at: Date.now(), value: { source: "offline", items: [] } };
    return memory.prs.value;
  }

  const list = await command("gh", ["pr", "list", "--state", "all", "--limit", "30", "--json", "number,title,state,isDraft,url,headRefName,baseRefName,updatedAt"]);
  if (list.code !== 0) {
    memory.prs = { at: Date.now(), value: { source: `gh unavailable: ${list.error ?? "not authenticated"}`, items: [] } };
    return memory.prs.value;
  }
  const repository = await repositoryName();
  const listed = JSON.parse(list.stdout || "[]");
  const items = await Promise.all(listed.map(async (item) => ({
    ...item,
    comments: await loadReviewThreads(repository, item.number),
  })));
  memory.prs = { at: Date.now(), value: { source: "gh", items: normalizePullRequests(items) } };
  return memory.prs.value;
}

async function repositoryName() {
  const remote = await command("git", ["-C", parsed.repo, "remote", "get-url", "origin"]);
  const value = remote.stdout.trim().replace(/\.git$/, "");
  const match = value.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

async function loadReviewThreads(repository, number) {
  if (!repository) return unavailableComments("repository is not on GitHub");
  const query = "query($owner:String!, $repo:String!, $number:Int!) { repository(owner:$owner, name:$repo) { pullRequest(number:$number) { reviewThreads(first:100) { nodes { isResolved comments(first:1) { nodes { author { login } createdAt url } } } } } } }";
  const result = await command("gh", [
    "api", "graphql", "-f", `query=${query}`, "-f", `owner=${repository.owner}`, "-f", `repo=${repository.repo}`, "-F", `number=${number}`,
  ]);
  if (result.code !== 0) return unavailableComments(result.error ?? "review threads unavailable");
  try {
    const threads = JSON.parse(result.stdout).data.repository.pullRequest.reviewThreads.nodes ?? [];
    const addressed = threads.filter((thread) => thread.isResolved).length;
    return {
      available: true,
      total: threads.length,
      addressed,
      unaddressed: threads.length - addressed,
      threads: threads.map((thread) => ({
        addressed: thread.isResolved,
        author: thread.comments.nodes[0]?.author?.login ?? "unknown",
        createdAt: thread.comments.nodes[0]?.createdAt ?? null,
        url: thread.comments.nodes[0]?.url ?? null,
      })),
    };
  } catch {
    return unavailableComments("invalid review-thread response");
  }
}

function normalizePullRequests(items) {
  return items.map((item) => {
    const comments = item.comments ?? normalizeComments(item);
    return {
      number: item.number,
      title: item.title ?? `Pull request #${item.number}`,
      state: item.state ?? "UNKNOWN",
      draft: Boolean(item.isDraft ?? item.draft),
      url: item.url ?? item.html_url ?? null,
      head: item.headRefName ?? item.head ?? "-",
      base: item.baseRefName ?? item.base ?? "-",
      updatedAt: item.updatedAt ?? item.updated_at ?? null,
      comments,
    };
  });
}

function normalizeComments(item) {
  const comments = item.comments ?? {};
  if (typeof comments === "number") return { available: true, total: comments, addressed: 0, unaddressed: comments, threads: [] };
  return {
    available: comments.available ?? false,
    total: comments.total ?? 0,
    addressed: comments.addressed ?? 0,
    unaddressed: comments.unaddressed ?? 0,
    threads: comments.threads ?? [],
  };
}

function unavailableComments(reason) {
  return { available: false, total: 0, addressed: 0, unaddressed: 0, threads: [], reason };
}

async function command(file, args) {
  try {
    const result = await execFileAsync(file, args, { cwd: parsed.repo, timeout: 8000, maxBuffer: 1024 * 1024 });
    return { code: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "", error: error.message };
  }
}

async function readPidRecord() {
  try {
    return JSON.parse(await readFile(pidPath, "utf8"));
  } catch {
    return null;
  }
}

async function writePidRecord(value) {
  await writeFile(pidPath, JSON.stringify(value, null, 2));
}

async function removePidRecord() {
  await unlink(pidPath).catch(() => undefined);
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readDirectory(path) {
  try {
    return (await readdir(path)).sort();
  } catch {
    return [];
  }
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function hash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function printHelp() {
  console.log(`Usage: node scripts/visualizer-server.mjs [option]

  --enable                 Start a detached local server
  --status                 Print lifecycle status as JSON
  --disable                Stop the detached local server
  --serve                  Run in the foreground (the default)
  --offline                Do not query GitHub for pull requests
  --repo <path>            Repository to observe
  --flows <path>           Workflow graph JSON source
  --pr-data <path>         Local pull-request fixture JSON
  --host <host>            Bind host (default: ${defaultHost})
  --port <port>            Bind port (default: ${defaultPort})
`);
}
