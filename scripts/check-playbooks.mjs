#!/usr/bin/env node

import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repositoryRoot = resolve(scriptDirectory, "..");
const skillsRoot = join(repositoryRoot, "skills");
const routerPath = join(skillsRoot, "vistack", "SKILL.md");
const errors = [];

const read = async (path) => readFile(path, "utf8");
const display = (path) => relative(repositoryRoot, path);
const fail = (path, message) => errors.push(`${display(path)}: ${message}`);

const validName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const frontmatter = (content, path) => {
  if (!content.startsWith("---\n")) {
    fail(path, "missing frontmatter");
    return null;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    fail(path, "frontmatter is not closed");
    return null;
  }
  const fields = new Map();
  for (const line of content.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([a-z][a-z-]*):\s*(.*)$/);
    if (match) fields.set(match[1], match[2].replace(/^['"]|['"]$/g, ""));
  }
  for (const field of ["name", "description"]) {
    if (!fields.has(field) || fields.get(field) === "") fail(path, `frontmatter lacks ${field}`);
  }
  return fields;
};

const skillDirectories = await readdir(skillsRoot, { withFileTypes: true });
for (const entry of skillDirectories) {
  if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
  const path = join(skillsRoot, entry.name, "SKILL.md");
  try {
    const fields = frontmatter(await read(path), path);
    if (!fields) continue;
    if (!validName.test(entry.name)) fail(path, `directory name is invalid: ${entry.name}`);
    if (fields.get("name") !== entry.name) {
      fail(path, `frontmatter name does not match directory: ${fields.get("name")}`);
    }
  } catch {
    fail(path, "missing SKILL.md");
  }
}

const playbooksDirectory = join(skillsRoot, "vistack", "playbooks");
const playbookEntries = await readdir(playbooksDirectory, { withFileTypes: true });
const playbookNames = new Set();
for (const entry of playbookEntries) {
  if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
  const path = join(playbooksDirectory, entry.name);
  const name = entry.name.slice(0, -3);
  playbookNames.add(name);
  const content = await read(path);
  if (!content.startsWith(`# Playbook: ${name}\n`)) fail(path, "H1 does not match filename");
  const steps = [...content.matchAll(/^(\d+)\.\s+/gm)].map((match) => Number(match[1]));
  if (steps.length === 0) fail(path, "has no numbered steps");
  steps.forEach((step, index) => {
    if (step !== index + 1) fail(path, `steps are not contiguous at ${step}`);
  });
  if (!content.includes("## Steps\n")) fail(path, "missing Steps heading");
  if (/\u2013|\u2014|[\u2018\u2019\u201c\u201d]/u.test(content)) {
    fail(path, "contains a long dash or curly quote");
  }
}

const router = await read(routerPath);
const routes = [...router.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((match) => match[1]);
for (const name of routes) {
  if (!playbookNames.has(name)) fail(routerPath, `route has no playbook: ${name}`);
}
for (const name of playbookNames) {
  if (!routes.includes(name)) fail(routerPath, `playbook is not routed: ${name}`);
}

const pathReferences = new Set();
for (const root of [join(repositoryRoot, "skills"), join(repositoryRoot, "docs"), join(repositoryRoot, "agents")]) {
  const files = await walk(root);
  for (const path of files) {
    const content = await read(path);
    for (const match of content.matchAll(/`((?:skills|docs|agents)\/[a-zA-Z0-9_./-]+)`/g)) {
      pathReferences.add(match[1]);
    }
  }
}
for (const reference of pathReferences) {
  if (reference.endsWith("/")) continue;
  const path = join(repositoryRoot, reference);
  if (!await exists(path)) fail(routerPath, `referenced path does not exist: ${reference}`);
}

// Lints for mistakes agents repeated in this repo. Each error names the fix. An exception goes
// on the offending line: `lint-ok: <rule>; <reason>; expires YYYY-MM-DD; approved-by <name>`.
const lintRoots = ["agents", "commands", "docs", "integrations", "laya", "scripts", "skills"];
const lintFiles = [join(repositoryRoot, "CLAUDE.md"), join(repositoryRoot, "README.md")];
for (const root of lintRoots) {
  // laya/tests/ feeds the retired names to the code that rejects them; this file lists them.
  lintFiles.push(...await walkFiles(join(repositoryRoot, root), [".md", ".py", ".js", ".mjs"], ["laya/tests", "scripts/check-playbooks.mjs"]));
}
const lintException = /lint-ok: ([a-z-]+); [^;]+; expires (\d{4}-\d{2}-\d{2}); approved-by \S+/;
const excepted = (line, rule, path, number) => {
  const match = line.match(lintException);
  if (!match || match[1] !== rule) return false;
  if (new Date(match[2]) < new Date()) fail(path, `line ${number}: lint-ok for ${rule} expired on ${match[2]}`);
  return true;
};

const ladderSource = await read(join(repositoryRoot, "laya", "engine.py"));
const ladder = [...(ladderSource.match(/^LADDER = \(([^)]*)\)/m)?.[1] ?? "").matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
if (ladder.length === 0) fail(join(repositoryRoot, "laya", "engine.py"), "LADDER tuple not found");
const ladderNames = ladder.map((tier) => tier[0].toUpperCase() + tier.slice(1));
const retired = [
  [/\b(?:nimble|tev1)\b/i, "an earlier Ollama decision model, no longer supported; the supported models are OLLAMA_MODELS in laya/ollama_models.py"],
  [/laya[-_]mlx|\bMLXBackend\b|convaiinnovations/i, "the Laya-MLX tier was removed; the tiers are LADDER in laya/engine.py"],
  [/clef[-_]server|clef-(?:start|stop)|Cloudflare\/clef-flash|setup --clef/i, "the Hugging Face Clef server was removed; clef-flash runs on Ollama (OLLAMA_MODELS in laya/ollama_models.py)"],
  [/\bkev\b|kev[-_]url|host[-_]llm|laya-setup/i, "the Kev and host-CLI tiers were removed; the tiers are LADDER in laya/engine.py"],
  [/VISTACK_LAYA_(?:MODEL|PYTHON|HOST|KEV|CLEF|WORKDIR)\b/, "an obsolete variable; laya/config.py reports leftovers under `obsolete`"],
];

for (const path of lintFiles) {
  const content = await read(path);
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    for (const [pattern, fix] of retired) {
      const match = line.match(pattern);
      if (match && !excepted(line, "retired", path, index + 1)) fail(path, `line ${index + 1}: \`${match[0]}\`: ${fix}`);
    }
  });
  if (!path.endsWith(".md")) continue;

  // A tier list in a command description must name exactly the tiers in LADDER.
  const description = display(path).startsWith("commands/decisions-") ? content.match(/^description: "[^"]*\(([^)]*)\)/m) : null;
  if (description && description[1].split(/,\s*/).join(",") !== ladderNames.join(",")) {
    fail(path, `description lists (${description[1]}); LADDER in laya/engine.py is (${ladderNames.join(", ")})`);
  }

  // `node --test <dir>` loads the directory as a module on Node 24 and runs no tests.
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/node --test((?:\s+[^\s`]+)+)/g)) {
      const directory = match[1].trim().split(/\s+/).find((argument) => !argument.startsWith("-") && !argument.includes("*") && !/\.[cm]?[jt]s$/.test(argument));
      if (directory && !excepted(line, "node-test", path, index + 1)) {
        fail(path, `line ${index + 1}: \`node --test ${directory}\` runs no tests on Node 24; use scripts/verify.sh or \`node --test ${directory.replace(/\/$/, "")}/*.test.mjs\``);
      }
    }
  });

  // "from the plugin root" names where the script path resolves, never the working directory.
  const units = [];
  let paragraph = null;
  lines.forEach((line, index) => {
    const row = line.trimStart().startsWith("|");
    if (row || line.trim() === "") {
      if (paragraph) units.push(paragraph);
      paragraph = null;
      if (row) units.push({ number: index + 1, text: line });
    } else if (paragraph) {
      paragraph.text += ` ${line.trim()}`;
    } else {
      paragraph = { number: index + 1, text: line.trim() };
    }
  });
  if (paragraph) units.push(paragraph);
  for (const { number, text } of units) {
    for (const sentence of text.split(/(?<=[.;!?])\s+/)) {
      if (/from the plugin root/i.test(sentence) && !/resolv/i.test(sentence) && !excepted(sentence, "plugin-root", path, number)) {
        fail(path, `line ${number}: "${sentence.slice(0, 70)}..." reads as a working-directory change; say the path resolves from the plugin root while the working directory stays in the consuming repository (skills/vistack/SKILL.md, Host adapter)`);
      }
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exitCode = 1;
} else {
  console.log(`PASS ${playbookNames.size} playbooks and ${skillDirectories.filter((entry) => entry.isDirectory()).length} skills`);
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

async function walkFiles(directory, extensions, skipped) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (skipped.includes(display(path)) || entry.name === "__pycache__" || entry.name === "node_modules") continue;
    if (entry.isDirectory()) files.push(...await walkFiles(path, extensions, skipped));
    else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) files.push(path);
  }
  return files;
}
