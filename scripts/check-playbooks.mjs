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
