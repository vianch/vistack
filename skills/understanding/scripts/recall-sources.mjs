import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

export const hostNames = ["claude", "codex", "grok", "opencode"];

const commandParts = /<(command-name|command-args)>([\s\S]*?)<\/\1>/g;
const wrapperTags = /<(system-reminder|command-[a-z-]+|local-command-[a-z-]+)>[\s\S]*?<\/\1>/g;
const codexContextTags = /<(environment_context|user_instructions)>[\s\S]*?<\/\1>/g;
const codexInstructionsHeading = "# AGENTS.md instructions";

export const claudeSlug = (path) => path.replace(/[^a-zA-Z0-9]/g, "-");

export const belongsTo = (cwd, { project, allProjects }) =>
  allProjects || (typeof cwd === "string" && (cwd === project || cwd.startsWith(`${project}/`)));

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const isoOf = (value, fallback) => {
  const date = new Date(value);
  return value === undefined || value === null || Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

const modifiedAt = (path) => {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
};

const isStale = (path, since) => since !== null && since !== undefined && modifiedAt(path) < since.toISOString();

const textBlocks = (content, acceptedTypes) => {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((block) => acceptedTypes.has(block?.type) && typeof block.text === "string").map((block) => block.text);
};

const joinedText = (blocks) => blocks.map((block) => block.trim()).filter(Boolean).join("\n");

const withoutWrappers = (blocks) => blocks.map((block) => block.replace(commandParts, " $2 ").replace(wrapperTags, ""));

export const normalizeClaude = (record) => {
  if ((record?.type !== "user" && record?.type !== "assistant") || record.isMeta || record.isSidechain) return null;
  const blocks = textBlocks(record.message?.content, new Set(["text"]));
  const text = joinedText(record.type === "user" ? withoutWrappers(blocks) : blocks);
  return text ? { role: record.type, text, timestamp: record.timestamp, session: record.sessionId, cwd: record.cwd } : null;
};

export const normalizeCodex = (record) => {
  const payload = record?.payload;
  if (record?.type !== "response_item" || payload?.type !== "message") return null;
  if (payload.role !== "user" && payload.role !== "assistant") return null;
  const blocks = textBlocks(payload.content, new Set(["input_text", "output_text", "text"]));
  const kept =
    payload.role === "user"
      ? blocks
          .filter((block) => !block.trimStart().startsWith(codexInstructionsHeading))
          .map((block) => block.replace(codexContextTags, ""))
      : blocks;
  const text = joinedText(kept);
  return text ? { role: payload.role, text, timestamp: record.timestamp } : null;
};

export const normalizeGrok = (record) => {
  if ((record?.type !== "user" && record?.type !== "assistant") || record.synthetic_reason) return null;
  const blocks = textBlocks(record.content, new Set(["text"]));
  const text = joinedText(record.type === "user" ? withoutWrappers(blocks) : blocks);
  return text ? { role: record.type, text } : null;
};

const listEntries = (directory) => {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
};

const listFiles = (directory, accepts) =>
  listEntries(directory).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(path, accepts);
    return entry.isFile() && accepts(entry.name) ? [path] : [];
  });

async function* readLines(path) {
  const input = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of reader) yield line;
  } catch {
    return;
  } finally {
    reader.close();
    input.destroy();
  }
}

const lacksNeedle = (line, needle) => Boolean(needle) && !line.toLowerCase().includes(needle);

async function* claudeUnits(options) {
  const root = join(options.home, ".claude", "projects");
  const slug = claudeSlug(options.project);
  const directories = listEntries(root).filter((entry) => entry.isDirectory() && (options.allProjects || entry.name.startsWith(slug)));
  for (const directory of directories) {
    for (const file of listFiles(join(root, directory.name), (name) => name.endsWith(".jsonl"))) {
      if (isStale(file, options.since)) continue;
      yield {
        async *read(needle) {
          for await (const line of readLines(file)) {
            if (lacksNeedle(line, needle)) continue;
            const message = normalizeClaude(parseJson(line));
            if (!message || !belongsTo(message.cwd, options)) continue;
            const session = message.session ?? basename(file, ".jsonl");
            yield { host: "claude", session, role: message.role, text: message.text, timestamp: isoOf(message.timestamp, modifiedAt(file)), file };
          }
        },
      };
    }
  }
}

async function* codexUnits(options) {
  const roots = [join(options.home, ".codex", "sessions"), join(options.home, ".codex", "archived_sessions")];
  const isRollout = (name) => name.startsWith("rollout-") && name.endsWith(".jsonl");
  for (const file of roots.flatMap((root) => listFiles(root, isRollout))) {
    if (isStale(file, options.since)) continue;
    yield {
      async *read(needle) {
        let meta = null;
        for await (const line of readLines(file)) {
          if (meta && lacksNeedle(line, needle)) continue;
          const record = parseJson(line);
          if (record?.type === "session_meta") {
            meta = record.payload ?? {};
            if (!belongsTo(meta.cwd, options)) return;
            continue;
          }
          if (!meta) continue;
          const message = normalizeCodex(record);
          if (!message) continue;
          const session = meta.id ?? meta.session_id ?? basename(file, ".jsonl");
          const fallback = isoOf(meta.timestamp, modifiedAt(file));
          yield { host: "codex", session, role: message.role, text: message.text, timestamp: isoOf(message.timestamp, fallback), file };
        }
      },
    };
  }
}

const decodedDirectory = (name) => {
  try {
    return decodeURIComponent(name);
  } catch {
    return null;
  }
};

const grokStartedAt = (sessionDirectory, file) => {
  const summary = parseJson(existsSync(join(sessionDirectory, "summary.json")) ? readFileSync(join(sessionDirectory, "summary.json"), "utf8") : "");
  return isoOf(summary?.created_at, modifiedAt(file));
};

async function* grokUnits(options) {
  const root = join(options.home, ".grok", "sessions");
  for (const projectEntry of listEntries(root)) {
    if (!projectEntry.isDirectory() || !belongsTo(decodedDirectory(projectEntry.name), options)) continue;
    for (const sessionEntry of listEntries(join(root, projectEntry.name))) {
      const sessionDirectory = join(root, projectEntry.name, sessionEntry.name);
      const file = join(sessionDirectory, "chat_history.jsonl");
      if (!sessionEntry.isDirectory() || !existsSync(file) || isStale(file, options.since)) continue;
      const timestamp = grokStartedAt(sessionDirectory, file);
      yield {
        async *read(needle) {
          for await (const line of readLines(file)) {
            if (lacksNeedle(line, needle)) continue;
            const message = normalizeGrok(parseJson(line));
            if (message) yield { host: "grok", session: sessionEntry.name, role: message.role, text: message.text, timestamp, file };
          }
        },
      };
    }
  }
}

const opencodeSessionsQuery = `SELECT id FROM session
  WHERE (? = 1 OR directory = ? OR substr(directory, 1, ?) = ?) AND time_updated >= ?`;
const opencodePartsQuery = `SELECT p.data AS part, m.data AS message, p.time_created AS created
  FROM part p JOIN message m ON m.id = p.message_id
  WHERE p.session_id = ? AND instr(lower(p.data), ?) > 0
  ORDER BY p.time_created, p.id`;

const opencodeMessages = (database, session, file, needle) =>
  database
    .prepare(opencodePartsQuery)
    .all(session, needle ?? "")
    .flatMap((row) => {
      const part = parseJson(row.part);
      const role = parseJson(row.message)?.role;
      const text = typeof part?.text === "string" ? part.text.trim() : "";
      if (part?.type !== "text" || part.synthetic || !text || (role !== "user" && role !== "assistant")) return [];
      return [{ host: "opencode", session, role, text, timestamp: isoOf(row.created, modifiedAt(file)), file }];
    });

async function* opencodeUnits(options) {
  const file = join(options.home, ".local", "share", "opencode", "opencode.db");
  if (!existsSync(file)) return;
  let database;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    database = new DatabaseSync(file, { readOnly: true });
  } catch (error) {
    const reason = error?.code === "ERR_UNKNOWN_BUILTIN_MODULE" ? "node:sqlite needs Node 22.5 or later" : error?.message;
    options.warn?.(`opencode skipped: ${reason}`);
    return;
  }
  try {
    const project = options.project;
    const sinceMs = options.since ? options.since.getTime() : 0;
    const rows = database.prepare(opencodeSessionsQuery).all(options.allProjects ? 1 : 0, project, project.length + 1, `${project}/`, sinceMs);
    for (const { id } of rows) {
      yield {
        async *read(needle) {
          yield* opencodeMessages(database, id, file, needle);
        },
      };
    }
  } catch (error) {
    options.warn?.(`opencode skipped: ${error?.message}`);
  } finally {
    database.close();
  }
}

const unitsByHost = { claude: claudeUnits, codex: codexUnits, grok: grokUnits, opencode: opencodeUnits };

export async function* readMessages(options) {
  for (const host of options.hosts) {
    for await (const unit of unitsByHost[host](options)) yield* unit.read(options.needle);
  }
}

const isBareCommand = (text) => /^\/\S+$/.test(text.trim());

const sessionRow = (first, prompt) => ({ start: first.timestamp, host: first.host, session: first.session, prompt, file: first.file });

const firstSession = async (messages) => {
  let first = null;
  let bareCommand = null;
  for await (const message of messages) {
    first ??= message;
    if (message.role !== "user") continue;
    if (!isBareCommand(message.text)) return sessionRow(first, message.text);
    bareCommand ??= message;
  }
  return first && sessionRow(first, bareCommand?.text.trim() ?? "");
};

export async function* readSessions(options) {
  for (const host of options.hosts) {
    for await (const unit of unitsByHost[host](options)) {
      const session = await firstSession(unit.read());
      if (session) yield session;
    }
  }
}
