import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { buildHome, project } from "./recall.fixture.mjs";
import { claudeSlug, normalizeClaude, normalizeCodex, normalizeGrok } from "./recall-sources.mjs";
import { listSessions, search } from "./recall.mjs";

let home;
let hasOpencode;

before(async () => {
  ({ home, hasOpencode } = await buildHome());
});
after(() => rmSync(home, { recursive: true, force: true }));

const options = (overrides = {}) => ({
  home,
  project,
  allProjects: false,
  hosts: ["claude", "codex", "grok", "opencode"],
  since: null,
  limit: 50,
  ...overrides,
});

const brief = (results) => results.map((result) => `${result.host}:${result.session}:${result.role}`);

describe("normalizers", () => {
  test("claude slug replaces every non-alphanumeric character", () => {
    assert.equal(claudeSlug("/Users/v/.claude/x"), "-Users-v--claude-x");
  });

  test("claude keeps text blocks, drops meta and sidechain, and unwraps slash commands", () => {
    assert.equal(normalizeClaude({ type: "user", isMeta: true, message: { content: "x" } }), null);
    assert.equal(normalizeClaude({ type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "x" }] } }), null);
    assert.equal(normalizeClaude({ type: "user", message: { content: "<system-reminder>gone</system-reminder>" } }), null);
    const command = normalizeClaude({
      type: "user",
      message: { content: "<command-name>/vistack:vistack</command-name>\n<command-message>vistack</command-message>\n<command-args>fix the bug</command-args>" },
    });
    assert.equal(command.text.replace(/\s+/g, " ").trim(), "/vistack:vistack fix the bug");
    const local = normalizeClaude({ type: "user", message: { content: "<local-command-stdout>ok</local-command-stdout>" } });
    assert.equal(local, null);
  });

  test("codex drops environment context and AGENTS.md instructions from user text only", () => {
    const user = normalizeCodex({
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>cwd</environment_context>" }, { type: "input_text", text: "# AGENTS.md instructions\nrules" }, { type: "input_text", text: "real" }] },
    });
    assert.equal(user.text, "real");
    assert.equal(normalizeCodex({ type: "response_item", payload: { type: "message", role: "developer", content: [] } }), null);
  });

  test("grok skips system and synthetic lines", () => {
    assert.equal(normalizeGrok({ type: "system", content: "x" }), null);
    assert.equal(normalizeGrok({ type: "user", content: "x", synthetic_reason: "skills" }), null);
    assert.equal(normalizeGrok({ type: "assistant", content: "answer" }).text, "answer");
  });
});

describe("search", () => {
  test("covers the project and its worktrees, newest first, and excludes other projects", async () => {
    const results = await search({ ...options(), terms: ["postgres"] });
    const expected = [
      ...(hasOpencode ? ["opencode:ses_open1:user"] : []),
      "grok:grok-g1:user",
      "grok:grok-g1:assistant",
      "claude:claude-w1:user",
      "codex:codex-session-1:assistant",
      "codex:codex-session-1:user",
      "claude:claude-s1:assistant",
      "claude:claude-s1:user",
    ];
    assert.deepEqual(brief(results), expected);
    const text = results.map((result) => result.snippet).join(" ");
    for (const hidden of ["hidden", "meta caveat", "sidechain", "postgres env", "postgres agents", "developer", "synthetic", "elsewhere", "sibling", "system prompt", "tool"]) {
      assert.ok(!text.includes(hidden), hidden);
    }
  });

  test("matches every term, ignoring case", async () => {
    const results = await search({ ...options(), terms: ["POSTGRES", "sqlite"] });
    assert.deepEqual(brief(results), ["codex:codex-session-1:user"]);
    assert.equal(results[0].snippet, "Why Postgres over SQLite?");
  });

  test("limit keeps the newest", async () => {
    const results = await search({ ...options({ limit: 2 }), terms: ["postgres"] });
    assert.equal(results.length, 2);
    assert.equal(results[0].host, hasOpencode ? "opencode" : "grok");
  });

  test("--all-projects reaches the other projects", async () => {
    const results = await search({ ...options({ allProjects: true }), terms: ["elsewhere"] });
    const hosts = brief(results).sort();
    const expected = ["claude:claude-o1:user", "codex:codex-session-2:user", ...(hasOpencode ? ["opencode:ses_open2:user"] : [])].sort();
    assert.deepEqual(hosts, expected);
  });

  test("--host and --since narrow the search", async () => {
    assert.deepEqual(brief(await search({ ...options({ hosts: ["codex"] }), terms: ["postgres"] })), ["codex:codex-session-1:assistant", "codex:codex-session-1:user"]);
    const recent = await search({ ...options({ since: new Date("2026-01-03T00:00:00Z") }), terms: ["postgres"] });
    assert.ok(recent.every((result) => result.timestamp >= "2026-01-03"));
    assert.equal(recent.length, hasOpencode ? 4 : 3);
  });
});

describe("sessions", () => {
  test("one row per session with its first real prompt, newest first", async () => {
    const sessions = await listSessions(options());
    const rows = sessions.map((session) => [session.host, session.session, session.prompt.replace(/\s+/g, " ").trim()]);
    assert.deepEqual(rows, [
      ...(hasOpencode ? [["opencode", "ses_open1", "opencode postgres question"]] : []),
      ["grok", "grok-g1", "grok asks about postgres"],
      ["claude", "claude-w1", "/review postgres in worktree"],
      ["codex", "codex-session-1", "Why Postgres over SQLite?"],
      ["claude", "claude-s1", "We decided to use Postgres for the ledger"],
    ]);
    assert.equal(sessions.find((session) => session.session === "claude-s1").start, "2026-01-01T09:59:00.000Z");
  });

  test("a session of bare slash commands falls back to the first command", async () => {
    const sessions = await listSessions(options({ hosts: ["claude"], project: "/work/bare" }));
    assert.deepEqual(sessions.map((session) => session.prompt), ["/model"]);
  });

  test("prompts are redacted and cut to 120 characters", async () => {
    const sessions = await listSessions(options({ hosts: ["codex"] }));
    assert.ok(sessions.every((session) => session.prompt.length <= 120));
  });
});
