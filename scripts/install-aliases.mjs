#!/usr/bin/env node

import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = `usage: node install-aliases.mjs [status|install|uninstall] [--skills-dir <dir>] [--plugin-root <dir>]
                                  [--replace a,b] [--skip a,b] [--clear a,b] [--dry-run]
Writes a bare-name personal skill (/<name>) for every plugin skill and command, so /qa-video runs
/<plugin>:qa-video. No subcommand means status. --replace takes a reserved or project-shadowed name,
--skip leaves a name out, --clear forgets both; install saves them per skills dir in
$HOME/.vistack/aliases.json. Rows: <action>\\t/<name>\\t<detail>, then a summary line.`;

const validName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const commands = new Set(["install", "status", "uninstall"]);
const descriptionLimit = 160;

// Per https://code.claude.com/docs/en/commands.md (fetched 2026-11-20); a personal skill of the
// same name replaces the built-in.
const claudeCodeReserved = {
  "built-in command": ["add-dir", "advisor", "agents", "artifacts", "auto-mode-setup", "autocompact", "autofix-pr", "background", "branch", "btw", "bug", "cd", "chrome", "clear", "color", "compact", "config", "context", "copy", "cost", "design-login", "desktop", "diff", "effort", "exit", "export", "fast", "feedback", "focus", "fork", "goal", "heapdump", "help", "hooks", "ide", "import", "init", "insights", "install-github-app", "install-slack-app", "keybindings", "list-agents", "login", "logout", "mcp", "memory", "mobile", "model", "output-style", "passes", "permissions", "plan", "plugin", "powerup", "pr-comments", "privacy-settings", "radio", "rate-limit-options", "recap", "release-notes", "reload-plugins", "reload-skills", "remote-control", "remote-env", "rename", "restart", "resume", "rewind", "sandbox", "schedule", "scroll-speed", "security-review", "setup-bedrock", "setup-vertex", "skill-doctor", "skills", "stats", "status", "statusline", "stickers", "stop", "subtask", "tasks", "team-onboarding", "teleport", "terminal-setup", "theme", "tui", "ultraplan", "ultrareview", "upgrade", "usage", "usage-credits", "vim", "voice", "web-setup", "workflows"],
  "bundled skill": ["artifact-capabilities", "artifact-diagramming", "batch", "claude-api", "claude-in-chrome", "code-review", "dataviz", "debug", "deep-research", "design", "design-sync", "doctor", "fewer-permission-prompts", "loop", "plugin-authoring", "run", "run-skill-generator", "simplify", "slides", "update-config", "verify", "workflow-authoring"],
  "built-in alias": ["cost", "stats", "review", "checkup", "reset", "new", "checkpoint", "undo", "bg", "app", "quit", "ios", "android", "rc", "update", "continue", "routines", "tp", "allowed-tools", "settings", "proactive", "share"],
};
const reservedKind = new Map();
for (const [kind, names] of Object.entries(claudeCodeReserved)) {
  for (const name of names) if (!reservedKind.has(name)) reservedKind.set(name, kind);
}

const actionOrder = ["written", "unchanged", "installed", "stale", "missing", "root-missing", "orphan", "removed", "kept-dir", "reserved", "project", "foreign", "skipped"];

class UsageError extends Error {}

const parseNames = (flag, value) => {
  if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} needs a comma-separated list of names`);
  const names = value.split(",").map((name) => name.trim()).filter(Boolean);
  const invalid = names.find((name) => !validName.test(name));
  if (names.length === 0 || invalid !== undefined) throw new UsageError(`${flag}: invalid name ${JSON.stringify(invalid ?? value)}`);
  return names;
};

const parseArgs = (argv) => {
  const options = { command: null, dryRun: false, edits: [], help: false, pluginRoot: null, skillsDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].startsWith("--") ? argv[index].split(/=(.*)/s, 2) : [argv[index], undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      index += 1;
      return argv[index];
    };
    if (flag === "--help" || flag === "-h") options.help = true;
    else if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--skills-dir" || flag === "--plugin-root") {
      const path = value();
      if (!path || path.startsWith("--")) throw new UsageError(`${flag} needs a directory`);
      options[flag === "--skills-dir" ? "skillsDir" : "pluginRoot"] = path;
    } else if (flag === "--replace" || flag === "--skip" || flag === "--clear") {
      options.edits.push({ operation: flag.slice(2), names: parseNames(flag, value()) });
    } else if (options.command === null && commands.has(flag)) options.command = flag;
    else throw new UsageError(`unknown ${flag.startsWith("-") ? "flag" : "argument"}: ${flag}`);
  }
  options.command ??= "status";
  return options;
};

const lstat = (path) => lstatSync(path, { throwIfNoEntry: false });
const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() === true;
const entries = (directory) => {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  }
};

const realPath = (path) => {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(realPath(parent), basename(absolute));
  }
};

const writeAtomic = (path, content, temporaryDirectory) => {
  mkdirSync(temporaryDirectory, { recursive: true });
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(temporaryDirectory, `.${basename(dirname(path))}-${basename(path)}.${process.pid}.tmp`);
  writeFileSync(temporary, content);
  renameSync(temporary, path);
};

const unquote = (raw) => {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
};

const parseFrontmatter = (content) => {
  const lines = content.split(/\r?\n/);
  const raw = new Map();
  if (lines[0] !== "---") return raw;
  let key = null;
  for (const line of lines.slice(1)) {
    if (line.trimEnd() === "---") break;
    const match = line.match(/^([A-Za-z][\w-]*):(?:\s+|$)(.*)$/);
    if (match) {
      key = match[1];
      raw.set(key, match[2]);
    } else if (key !== null && /^\s/.test(line)) raw.set(key, `${raw.get(key)} ${line.trim()}`);
  }
  return new Map([...raw].map(([field, value]) => [field, unquote(value.replace(/^[>|][-+]?\s*/, ""))]));
};

const aliasDescription = (plugin, name, description) => {
  const lead = `Alias of /${plugin}:${name}.`;
  const sentence = String(description ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0];
  const full = sentence ? `${lead} ${sentence}` : lead;
  if (full.length <= descriptionLimit) return full;
  const cut = full.slice(0, descriptionLimit - 2);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:.]+$/, "")}...`;
};

const readTargets = (pluginRoot) => {
  const found = new Map();
  const add = (name, relativePath) => {
    if (validName.test(name) && !found.has(name) && isFile(join(pluginRoot, relativePath))) found.set(name, relativePath);
  };
  // Claude Code resolves <plugin>:<name> to the command when a command and a skill share the name.
  for (const entry of entries(join(pluginRoot, "commands"))) {
    if (entry.name.endsWith(".md")) add(entry.name.slice(0, -3), `commands/${entry.name}`);
  }
  for (const entry of entries(join(pluginRoot, "skills"))) add(entry.name, `skills/${entry.name}/SKILL.md`);
  const targets = new Map();
  for (const name of [...found.keys()].sort()) {
    const path = join(pluginRoot, found.get(name));
    const fields = parseFrontmatter(readFileSync(path, "utf8"));
    targets.set(name, {
      description: fields.get("description") ?? "",
      hint: fields.get("argument-hint") ?? "",
      mode: fields.get("disable-model-invocation") === "true" ? "path" : "skill",
      name,
      path,
    });
  }
  return targets;
};

const markerLine = (plugin, name, mode) => `<!-- ${plugin}-alias target=${plugin}:${name} mode=${mode} -->`;
const bakedPathLine = /^Read `(.+)` and follow it/m;

const aliasContent = (plugin, pluginRoot, target) => {
  const { hint, mode, name } = target;
  const body = mode === "path"
    ? [
        `Read \`${target.path}\` and follow it as executable instructions, with the request below standing in for that file's arguments placeholder. Do not call the Skill tool for \`${plugin}:${name}\`: it disables model invocation, so the Skill tool refuses it.`,
        "",
        `In that file \`\${CLAUDE_PLUGIN_ROOT}\` and plugin-relative paths such as \`skills/...\` or \`scripts/...\` resolve from \`${pluginRoot}\`. This alias defines no behavior of its own.`,
      ]
    : [`Invoke the Skill tool with skill \`${plugin}:${name}\` and the request below as its args (no args when it is empty), then follow the loaded skill as executable instructions. This alias defines no behavior of its own.`];
  return [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(aliasDescription(plugin, name, target.description))}`,
    "disable-model-invocation: true",
    ...(hint ? [`argument-hint: ${JSON.stringify(hint)}`] : []),
    "---",
    markerLine(plugin, name, mode),
    "",
    `# /${name}`,
    "",
    ...body,
    "",
    "Request: $ARGUMENTS",
    "",
  ].join("\n");
};

const headerMarkerMode = (content, plugin, name) => {
  const lines = content.split("\n");
  const closing = lines.indexOf("---", 1);
  if (lines[0] !== "---" || closing === -1) return null;
  return lines[closing + 1]?.match(new RegExp(`^<!-- ${plugin}-alias target=${plugin}:${name} mode=(skill|path) -->$`))?.[1] ?? null;
};

const inspectSlot = (skillsDir, plugin, name) => {
  const directory = join(skillsDir, name);
  const directoryStats = lstat(directory);
  if (directoryStats === undefined) return { state: "vacant" };
  if (!directoryStats.isDirectory()) return { state: "foreign" };
  const file = join(directory, "SKILL.md");
  const fileStats = lstat(file);
  if (fileStats === undefined) return { state: readdirSync(directory).length === 0 ? "vacant" : "foreign" };
  if (!fileStats.isFile()) return { state: "foreign" };
  const content = readFileSync(file, "utf8");
  const mode = headerMarkerMode(content, plugin, name);
  if (mode === null) return { state: "foreign" };
  const bakedPath = mode === "path" ? content.match(bakedPathLine)?.[1] : undefined;
  return { bakedPath, content, directory, file, keepsOtherFiles: readdirSync(directory).some((entry) => entry !== "SKILL.md"), state: "owned" };
};

const ownedAliases = (skillsDir, plugin) => {
  const owned = new Map();
  for (const entry of entries(skillsDir)) {
    if (!validName.test(entry.name)) continue;
    const slot = inspectSlot(skillsDir, plugin, entry.name);
    if (slot.state === "owned") owned.set(entry.name, slot);
  }
  return owned;
};

const projectSkills = (cwd, home, ownScope) => {
  const found = new Map();
  const stop = realPath(home);
  for (let directory = realPath(cwd); directory !== stop; directory = dirname(directory)) {
    const scope = join(directory, ".claude");
    if (scope !== ownScope) {
      for (const entry of entries(join(scope, "skills"))) if (!found.has(entry.name)) found.set(entry.name, join(scope, "skills", entry.name));
      for (const entry of entries(join(scope, "commands"))) {
        const name = entry.name.replace(/\.md$/, "");
        if (entry.name.endsWith(".md") && !found.has(name)) found.set(name, join(scope, "commands", entry.name));
      }
    }
    if (dirname(directory) === directory) break;
  }
  return found;
};

const blockFor = (context, name, slot) => {
  const { options, personalCommands, plugin, projects, skillsDir } = context;
  if (slot.state === "foreign") return { reason: "foreign", detail: `${join(skillsDir, name)} is not a ${plugin} alias; left untouched` };
  const command = join(personalCommands, `${name}.md`);
  if (lstat(command) !== undefined) return { reason: "foreign", detail: `${command} is a personal command a same-name skill would shadow; left untouched` };
  if (options.skip.includes(name)) return { reason: "skipped", detail: `skipped by --skip; rerun with --clear ${name} to restore it` };
  if (options.replace.includes(name)) return null;
  if (reservedKind.has(name)) return { reason: "reserved", detail: `would replace the Claude Code ${reservedKind.get(name)} /${name}; rerun with --replace ${name} to take it` };
  if (!projects.has(name)) return null;
  const hidden = `the project skill at ${projects.get(name)}`;
  return {
    reason: "project",
    detail: slot.state === "owned" ? `the installed alias stays and hides ${hidden} here; --skip ${name} removes it` : `would replace ${hidden}; rerun with --replace ${name} to take it`,
  };
};

const targetDetail = (plugin, target) => `${plugin}:${target.name} (${target.mode === "path" ? `path ${target.path}` : "skill"})`;
const removalAction = (slot) => (slot.keepsOtherFiles ? "kept-dir" : "removed");

const removeAlias = (slot) => {
  unlinkSync(slot.file);
  if (readdirSync(slot.directory).length === 0) rmdirSync(slot.directory);
};

const planRows = (context) => {
  const { command, owned, plugin, pluginRoot, skillsDir, targets } = context;
  const rows = [];
  if (command === "uninstall") {
    for (const [name, slot] of owned) rows.push({ action: removalAction(slot), detail: slot.directory, name, slot });
    return rows;
  }
  for (const target of targets.values()) {
    const { name } = target;
    const slot = owned.get(name) ?? inspectSlot(skillsDir, plugin, name);
    const block = blockFor(context, name, slot);
    const content = aliasContent(plugin, pluginRoot, target);
    if (block !== null && block.reason !== "project" && slot.state === "owned") {
      rows.push(command === "install"
        ? { action: removalAction(slot), detail: `${block.reason}: ${block.detail}`, name, slot }
        : { action: block.reason, detail: `${block.detail}; the installed alias goes on the next install`, name });
    } else if (block !== null) rows.push({ action: block.reason, detail: block.detail, name });
    else if (command === "install") {
      const same = slot.state === "owned" && slot.content === content;
      rows.push({ action: same ? "unchanged" : "written", content, detail: targetDetail(plugin, target), name });
    } else if (slot.state === "vacant") rows.push({ action: "missing", detail: targetDetail(plugin, target), name });
    else if (slot.bakedPath !== undefined && lstat(slot.bakedPath) === undefined) rows.push({ action: "root-missing", detail: `${slot.bakedPath} no longer exists; rerun install`, name });
    else rows.push({ action: slot.content === content ? "installed" : "stale", detail: targetDetail(plugin, target), name });
  }
  for (const [name, slot] of owned) {
    if (targets.has(name)) continue;
    const detail = `no ${plugin}:${name} in ${pluginRoot}`;
    rows.push(command === "install" ? { action: removalAction(slot), detail: `orphan: ${detail}`, name, slot } : { action: "orphan", detail: `${detail}; install removes it`, name });
  }
  return rows;
};

const readOptionsStore = (path) => {
  try {
    const store = JSON.parse(readFileSync(path, "utf8"));
    if (store === null || typeof store !== "object" || Array.isArray(store)) throw new Error("not a JSON object");
    return store;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`cannot read ${path} (${error.message}); fix or delete it`);
  }
};

const normalizeOptions = (entry) => {
  const names = (list) => (Array.isArray(list) ? [...new Set(list.filter((name) => typeof name === "string" && validName.test(name)))].sort() : []);
  return { replace: names(entry?.replace), skip: names(entry?.skip) };
};

const applyEdits = (saved, edits) => {
  const replace = new Set(saved.replace);
  const skip = new Set(saved.skip);
  for (const { operation, names } of edits) {
    for (const name of names) {
      if (operation !== "replace") replace.delete(name);
      if (operation !== "skip") skip.delete(name);
      if (operation === "replace") replace.add(name);
      if (operation === "skip") skip.add(name);
    }
  }
  return { replace: [...replace].sort(), skip: [...skip].sort() };
};

const summarize = (command, dryRun, rows, skillsDir) => {
  const counts = actionOrder.map((action) => [action, rows.filter((row) => row.action === action).length]).filter(([, count]) => count > 0);
  const text = counts.length > 0 ? counts.map(([action, count]) => `${count} ${action}`).join(", ") : "nothing";
  return `${command}${dryRun ? " (dry run)" : ""}: ${text} in ${skillsDir}`;
};

const main = (argv) => {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage);
    return;
  }
  const home = process.env.HOME || homedir();
  const pluginRoot = resolve(args.pluginRoot ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  const skillsDir = resolve(args.skillsDir ?? join(home, ".claude", "skills"));
  const plugin = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")).name;
  if (typeof plugin !== "string" || !validName.test(plugin)) throw new Error(`${pluginRoot}/.claude-plugin/plugin.json has no valid name`);

  const targets = readTargets(pluginRoot);
  for (const { operation, names } of args.edits) {
    for (const name of names) if (!targets.has(name)) console.error(`install-aliases: warning: --${operation} ${name}: no ${plugin} skill or command has that name`);
  }

  const optionsPath = join(home, ".vistack", "aliases.json");
  const optionsKey = realPath(skillsDir);
  const store = readOptionsStore(optionsPath);
  const saved = normalizeOptions(store[optionsKey]);
  const options = applyEdits(saved, args.edits);
  const rows = planRows({
    command: args.command,
    options,
    owned: ownedAliases(skillsDir, plugin),
    personalCommands: join(dirname(skillsDir), "commands"),
    plugin,
    pluginRoot,
    projects: projectSkills(process.cwd(), home, realPath(dirname(skillsDir))),
    skillsDir,
    targets,
  });

  if (!args.dryRun && args.command !== "status") {
    for (const row of rows) {
      if (row.action === "written") writeAtomic(join(skillsDir, row.name, "SKILL.md"), row.content, skillsDir);
      if (row.slot !== undefined) removeAlias(row.slot);
    }
    if (args.command === "install" && JSON.stringify(options) !== JSON.stringify(saved)) {
      writeAtomic(optionsPath, `${JSON.stringify({ ...store, [optionsKey]: options }, null, 2)}\n`, dirname(optionsPath));
    }
  }
  for (const row of rows) console.log(`${row.action}\t/${row.name}\t${row.detail}`);
  console.log(summarize(args.command, args.dryRun, rows, skillsDir));
};

try {
  main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`${usage}\n\ninstall-aliases: ${error.message}`);
    process.exitCode = 2;
  } else {
    console.error(`install-aliases: ${error.message}`);
    process.exitCode = 1;
  }
}
