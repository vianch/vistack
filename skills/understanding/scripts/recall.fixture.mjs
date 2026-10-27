import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const project = "/work/app";

const writeJsonl = (path, records) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\nnot json\n`);
};

const claudeRecord = (type, cwd, timestamp, content, extra = {}) => ({
  type,
  cwd,
  timestamp,
  sessionId: extra.sessionId ?? "claude-s1",
  message: { role: type, content },
  ...extra,
});

const writeClaude = (home) => {
  const projects = join(home, ".claude", "projects");
  writeJsonl(join(projects, "-work-app", "claude-s1.jsonl"), [
    { type: "permission-mode", permissionMode: "auto", sessionId: "claude-s1" },
    claudeRecord("user", project, "2026-01-01T09:59:00Z", "<command-name>/model</command-name><command-message>model</command-message><command-args></command-args>"),
    claudeRecord("user", project, "2026-01-01T10:00:00Z", "We decided to use Postgres for the ledger"),
    claudeRecord("assistant", project, "2026-01-01T10:01:00Z", [
      { type: "text", text: "Postgres ledger decision recorded. token=abc123secret" },
      { type: "tool_use", name: "Bash", input: { command: "echo postgres tool" } },
    ]),
    claudeRecord("user", project, "2026-01-01T10:02:00Z", "postgres meta caveat", { isMeta: true }),
    claudeRecord("user", project, "2026-01-01T10:03:00Z", "<system-reminder>postgres hidden</system-reminder>Real prompt about caching"),
    claudeRecord("assistant", project, "2026-01-01T10:04:00Z", [{ type: "text", text: "postgres sidechain" }], { isSidechain: true }),
  ]);
  writeJsonl(join(projects, "-work-app--claude-worktrees-feature", "claude-w1.jsonl"), [
    claudeRecord("user", `${project}/.claude/worktrees/feature`, "2026-01-03T08:00:00Z", "<command-name>/review</command-name><command-message>review</command-message><command-args>postgres in worktree</command-args>", { sessionId: "claude-w1" }),
  ]);
  writeJsonl(join(projects, "-work-apple", "claude-a1.jsonl"), [
    claudeRecord("user", "/work/apple", "2026-01-04T08:00:00Z", "postgres in a sibling project", { sessionId: "claude-a1" }),
  ]);
  writeJsonl(join(projects, "-work-bare", "claude-b1.jsonl"), [
    claudeRecord("user", "/work/bare", "2026-01-04T07:00:00Z", "<command-name>/model</command-name><command-args></command-args>", { sessionId: "claude-b1" }),
    claudeRecord("user", "/work/bare", "2026-01-04T07:01:00Z", "<command-name>/effort</command-name><command-args></command-args>", { sessionId: "claude-b1" }),
  ]);
  writeJsonl(join(projects, "-work-other", "claude-o1.jsonl"), [
    claudeRecord("user", "/work/other", "2026-01-04T09:00:00Z", "postgres elsewhere", { sessionId: "claude-o1" }),
  ]);
};

const codexMessage = (role, timestamp, texts) => ({
  timestamp,
  type: "response_item",
  payload: { type: "message", role, content: texts.map((text) => ({ type: role === "user" ? "input_text" : "output_text", text })) },
});

const writeCodex = (home) => {
  writeJsonl(join(home, ".codex", "sessions", "2026", "01", "02", "rollout-2026-01-02T09-00-00-codex-1.jsonl"), [
    { timestamp: "2026-01-02T09:00:00Z", type: "session_meta", payload: { id: "codex-session-1", cwd: project, timestamp: "2026-01-02T09:00:00Z" } },
    codexMessage("user", "2026-01-02T09:01:00Z", [
      "<environment_context>postgres env</environment_context>",
      "# AGENTS.md instructions for /work/app\npostgres agents",
      "Why Postgres over SQLite?",
    ]),
    codexMessage("assistant", "2026-01-02T09:02:00Z", ["Because postgres handles concurrent writers. Ask ops@example.com"]),
    codexMessage("developer", "2026-01-02T09:03:00Z", ["postgres developer note"]),
  ]);
  writeJsonl(join(home, ".codex", "archived_sessions", "rollout-2026-01-04T00-00-00-codex-2.jsonl"), [
    { timestamp: "2026-01-04T10:00:00Z", type: "session_meta", payload: { id: "codex-session-2", cwd: "/work/other" } },
    codexMessage("user", "2026-01-04T10:01:00Z", ["postgres archived elsewhere"]),
  ]);
};

const writeGrok = (home) => {
  const session = join(home, ".grok", "sessions", encodeURIComponent(project), "grok-g1");
  writeJsonl(join(session, "chat_history.jsonl"), [
    { type: "system", content: "postgres system prompt" },
    { type: "user", content: [{ type: "text", text: "<system-reminder>postgres skills</system-reminder>" }], synthetic_reason: "skills" },
    { type: "user", content: [{ type: "text", text: "grok asks about postgres" }] },
    { type: "assistant", content: "grok answers postgres" },
  ]);
  writeFileSync(join(session, "summary.json"), JSON.stringify({ created_at: "2026-01-05T00:00:00Z" }));
};

const opencodeSchema = `
  CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
  CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);
  CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);`;

const writeOpencode = async (home) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return false;
  }
  const directory = join(home, ".local", "share", "opencode");
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "opencode.db"));
  database.exec(opencodeSchema);
  const at = Date.parse("2026-01-06T00:00:00Z");
  database.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run("ses_open1", project, "Postgres", at, at);
  database.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run("ses_open2", "/work/other", "Other", at, at);
  const message = database.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
  message.run("msg_1", "ses_open1", at, JSON.stringify({ role: "user" }));
  message.run("msg_2", "ses_open2", at, JSON.stringify({ role: "user" }));
  const part = database.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)");
  part.run("prt_1", "msg_1", "ses_open1", at, JSON.stringify({ type: "text", text: "opencode postgres question" }));
  part.run("prt_2", "msg_1", "ses_open1", at + 1, JSON.stringify({ type: "text", text: "postgres synthetic", synthetic: true }));
  part.run("prt_3", "msg_2", "ses_open2", at, JSON.stringify({ type: "text", text: "opencode postgres elsewhere" }));
  database.close();
  return true;
};

export const buildHome = async () => {
  const home = mkdtempSync(join(tmpdir(), "recall-test-"));
  writeClaude(home);
  writeCodex(home);
  writeGrok(home);
  const hasOpencode = await writeOpencode(home);
  return { home, hasOpencode };
};
