#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);

export const usage = [
  "usage: node comments.mjs [--base <ref>] [--diff <file>|-] [--json]",
  "  Lists every comment on an added line: prune (remove it unless the policy keeps it), jsdoc (a utility-file JSDoc block, allowed),",
  "  directive (machine-read, exempt). Without --diff it reads the working tree against",
  "  merge-base(<base>, HEAD) plus untracked files; <base> defaults to origin/HEAD, then origin/main, then main.",
  "  --diff reads a unified diff from a file, or from stdin with -, and makes no git calls.",
  "exit codes: 0 no prune candidates; 1 prune candidates found; 2 usage or git error",
].join("\n");

export const directiveMarkers = [
  "eslint-", "@ts-", "tslint:", "stylelint-", "biome-ignore", "deno-lint-ignore", "prettier-ignore",
  "istanbul ignore", "c8 ignore", "v8 ignore", "@flow", "@jsx", "@jsxImportSource", "/// <reference",
  "webpackChunkName", "webpackPrefetch", "@vite-ignore", "@__PURE__", "#__PURE__", "@license", "@preserve",
  "SPDX-License-Identifier", "Copyright", "@generated", "DO NOT EDIT", "noqa", "type: ignore", "pylint:",
  "mypy:", "pyright:", "fmt: off", "fmt: on", "isort:", "-*- coding", "nolint", "go:build", "go:generate",
  "go:embed", "+build", "#pragma", "rubocop:", "frozen_string_literal", "swiftlint:", "NOSONAR",
  "ktlint-disable", "shellcheck", "syntax=docker", "cspell:", "@refresh",
];

const cLike = { line: ["//"], block: [["/*", "*/"]] };
const hash = { line: ["#"], block: [] };
const dash = { line: ["--"], block: [] };
const markup = { line: [], block: [["<!--", "-->"]] };
const component = { line: ["//"], block: [["/*", "*/"], ["<!--", "-->"]] };
const cLikeExtensions = [
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts", "java", "kt", "kts", "swift", "go", "rs", "c", "h",
  "cc", "cpp", "hpp", "cs", "scala", "dart", "groovy", "gradle", "scss", "less",
];
const hashExtensions = ["py", "rb", "sh", "bash", "zsh", "yml", "yaml", "toml", "r", "ex", "exs", "tf", "pl", "mk"];
const syntaxByExtension = new Map([
  ...cLikeExtensions.map((extension) => [extension, cLike]),
  ...hashExtensions.map((extension) => [extension, hash]),
  ...["sql", "lua", "hs"].map((extension) => [extension, dash]),
  ...["html", "xml"].map((extension) => [extension, markup]),
  ...["vue", "svelte"].map((extension) => [extension, component]),
  ["css", { line: [], block: [["/*", "*/"]] }],
  ["php", { line: ["//", "#"], block: [["/*", "*/"]] }],
]);
const hashBasenames = /^(?:Dockerfile(?:\..+)?|Makefile|GNUmakefile)$/;
const typeScriptExtensions = new Set(["ts", "tsx", "mts", "cts"]);
const utilityBasename = /\.utils?\.[cm]?[jt]sx?$/;
const skippedDirectories = new Set(["node_modules", "dist", "build", "vendor", ".git"]);
const lockfileName = /(?:\.lock|-lock\.(?:json|ya?ml))$|^npm-shrinkwrap\.json$/;
const minifiedName = /\.min\.[^.]+$/;
const jsdocTags = ["@example", "@author", "@remarks"];
const typeBraces = /@\w+\s*\{[^}]+\}/;
const textLimit = 100;

class UsageError extends Error {}

const extensionOf = (path) => extname(basename(path)).slice(1).toLowerCase();

export const isSkippedPath = (path) => {
  const segments = path.split("/");
  const name = segments.at(-1);
  const insideSkipped = segments.slice(0, -1).some((segment) => skippedDirectories.has(segment));
  return insideSkipped || lockfileName.test(name) || minifiedName.test(name);
};

export const syntaxFor = (path) => {
  if (isSkippedPath(path)) return null;
  if (hashBasenames.test(basename(path))) return hash;
  return syntaxByExtension.get(extensionOf(path)) ?? null;
};

export const isUtilityFile = (path) =>
  utilityBasename.test(basename(path)) || path.split("/").slice(0, -1).includes("utils");

const unquotePath = (text) => {
  if (!text.startsWith('"') || !text.endsWith('"')) return text;
  const escapes = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '"': 34, "\\": 92 };
  const bytes = [];
  for (let index = 1; index < text.length - 1; index += 1) {
    const character = text[index];
    if (character !== "\\") {
      bytes.push(...Buffer.from(character, "utf8"));
      continue;
    }
    const octal = text.slice(index + 1, index + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      index += 3;
    } else {
      const next = text[index + 1];
      bytes.push(escapes[next] ?? next.charCodeAt(0));
      index += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
};

const newSidePath = (header) => {
  const raw = header.slice(4).replace(/\t.*$/, "");
  if (raw === "/dev/null") return null;
  const path = unquotePath(raw);
  return path.startsWith("b/") ? path.slice(2) : path;
};

export const parseAddedLines = (diffText) => {
  const files = new Map();
  let current = null;
  let remainingOld = 0;
  let remainingNew = 0;
  let newLine = 0;
  for (const raw of String(diffText).split("\n")) {
    if (remainingOld > 0 || remainingNew > 0) {
      const marker = raw[0] ?? " ";
      if (marker === "\\") continue;
      if (marker === "+") {
        current?.push({ line: newLine, text: raw.slice(1).replace(/\r$/, "") });
        newLine += 1;
        remainingNew -= 1;
      } else if (marker === "-") {
        remainingOld -= 1;
      } else {
        newLine += 1;
        remainingOld -= 1;
        remainingNew -= 1;
      }
      continue;
    }
    if (raw.startsWith("diff --git ")) {
      current = null;
    } else if (raw.startsWith("+++ ")) {
      const path = newSidePath(raw);
      current = path === null ? null : (files.get(path) ?? files.set(path, []).get(path));
    } else {
      const hunk = raw.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunk) {
        remainingOld = hunk[1] === undefined ? 1 : Number(hunk[1]);
        newLine = Number(hunk[2]);
        remainingNew = hunk[3] === undefined ? 1 : Number(hunk[3]);
      }
    }
  }
  return files;
};

const closingQuoteIndex = (text, start) => {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === text[start]) return index;
  }
  return -1;
};

const followsWhitespace = (text, index) => index === 0 || /\s/.test(text[index - 1]);

const findMarker = (text, syntax) => {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "'" || text[index] === '"' || text[index] === "`") {
      const closing = closingQuoteIndex(text, index);
      if (closing !== -1) {
        index = closing;
        continue;
      }
    }
    const block = syntax.block.find(([open]) => text.startsWith(open, index) && text[index - 1] !== "\\");
    if (block) return { index, open: block[0], close: block[1] };
    const line = followsWhitespace(text, index) && syntax.line.find((marker) => text.startsWith(marker, index));
    if (line) return { index, open: line, close: null };
  }
  return null;
};

const isDirective = (text) => {
  const lowered = text.toLowerCase();
  return directiveMarkers.some((marker) => lowered.includes(marker.toLowerCase()));
};

const jsdocIssues = (path, text) => {
  const issues = jsdocTags.filter((tag) => new RegExp(`${tag}\\b`).test(text));
  if (typeScriptExtensions.has(extensionOf(path)) && typeBraces.test(text)) issues.push("{Type}");
  return issues;
};

const toItem = (path, { line, endLine, text, isJsdoc }) => {
  if (isDirective(text)) return { path, line, endLine, kind: "directive", text };
  if (isJsdoc && isUtilityFile(path)) return { path, line, endLine, kind: "jsdoc", text, issues: jsdocIssues(path, text) };
  return { path, line, endLine, kind: "prune", text };
};

export const classifyFile = (path, addedLines) => {
  const syntax = syntaxFor(path);
  if (!syntax) return [];
  const items = [];
  let openBlock = null;
  let previousLine = null;
  const finishBlock = () => {
    items.push(toItem(path, openBlock));
    openBlock = null;
  };
  for (const { line, text } of addedLines) {
    if (openBlock && line !== previousLine + 1) finishBlock();
    previousLine = line;
    if (openBlock) {
      openBlock.endLine = line;
      openBlock.text += `\n${text.trim()}`;
      if (text.includes(openBlock.close)) finishBlock();
      continue;
    }
    if (line === 1 && text.trimStart().startsWith("#!")) {
      items.push({ path, line, endLine: line, kind: "directive", text: text.trim() });
      continue;
    }
    const marker = findMarker(text, syntax);
    if (!marker) continue;
    const comment = text.slice(marker.index).trim();
    const isJsdoc = marker.open === "/*" && comment.startsWith("/**") && !comment.startsWith("/**/");
    const found = { line, endLine: line, text: comment, close: marker.close, isJsdoc };
    if (marker.close === null || comment.includes(marker.close, marker.open.length)) items.push(toItem(path, found));
    else openBlock = found;
  }
  if (openBlock) finishBlock();
  return items;
};

export const collectComments = (addedLinesByPath) =>
  [...addedLinesByPath].flatMap(([path, lines]) => classifyFile(path, lines));

export const countKinds = (items) => {
  const counts = { prune: 0, jsdoc: 0, directive: 0 };
  for (const { kind } of items) counts[kind] += 1;
  return counts;
};

const firstLineOf = (text) => {
  const line = text.split("\n")[0].trim();
  return line.length > textLimit ? `${line.slice(0, textLimit - 1)}…` : line;
};

export const formatText = (items) => {
  const { prune, jsdoc, directive } = countKinds(items);
  const rows = items.map(({ path, line, endLine, kind, text }) => {
    const range = endLine === line ? `${line}` : `${line}-${endLine}`;
    return `${path}:${range}  ${kind}  ${firstLineOf(text)}`;
  });
  return [...rows, `${prune} prune, ${jsdoc} jsdoc, ${directive} directive`].join("\n");
};

export const exitCodeFor = (items) => (items.some(({ kind }) => kind === "prune") ? 1 : 0);

export const parseArgs = (argv) => {
  const options = { json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    const takesValue = (flag === "--base" || flag === "--diff") && value !== undefined;
    if (flag === "--json") {
      options.json = true;
    } else if (flag === "--help" || flag === "-h") {
      options.help = true;
    } else if (takesValue && (!value.startsWith("-") || (flag === "--diff" && value === "-"))) {
      options[flag.slice(2)] = value;
      index += 1;
    } else {
      throw new UsageError(`unexpected argument ${flag}`);
    }
  }
  if (options.base !== undefined && options.diff !== undefined) throw new UsageError("use --base or --diff, not both");
  return options;
};

const runGit = (args, cwd) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw new Error(`cannot run git: ${result.error.code ?? result.error.message}`);
  return result;
};

const gitOutput = (args, cwd) => {
  const result = runGit(args, cwd);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr || result.stdout).trim()}`);
  return result.stdout;
};

const resolveBase = (explicitBase, root) => {
  if (explicitBase) return explicitBase;
  const remoteHead = runGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], root);
  if (remoteHead.status === 0 && remoteHead.stdout.trim()) return remoteHead.stdout.trim();
  return runGit(["rev-parse", "--verify", "--quiet", "origin/main"], root).status === 0 ? "origin/main" : "main";
};

const untrackedAddedLines = (root) => {
  const files = new Map();
  const paths = gitOutput(["ls-files", "--others", "--exclude-standard", "-z"], root).split("\0").filter(Boolean);
  for (const path of paths) {
    if (!syntaxFor(path)) continue;
    let content;
    try {
      content = readFileSync(join(root, path), "utf8");
    } catch {
      continue;
    }
    if (content.includes("\0")) continue;
    const lines = content.split("\n");
    if (lines.at(-1) === "") lines.pop();
    files.set(path, lines.map((text, index) => ({ line: index + 1, text: text.replace(/\r$/, "") })));
  }
  return files;
};

export const addedLinesFromGit = (cwd, base) => {
  const root = gitOutput(["rev-parse", "--show-toplevel"], cwd).trim();
  const mergeBase = gitOutput(["merge-base", resolveBase(base, root), "HEAD"], root).trim();
  const diffArgs = ["diff", "--unified=0", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", mergeBase];
  const files = parseAddedLines(gitOutput(diffArgs, root));
  for (const [path, lines] of untrackedAddedLines(root)) files.set(path, lines);
  return files;
};

const main = () => {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage}\n`);
      return;
    }
    const files = options.diff === undefined
      ? addedLinesFromGit(process.cwd(), options.base)
      : parseAddedLines(readFileSync(options.diff === "-" ? 0 : options.diff, "utf8"));
    const items = collectComments(files);
    process.stdout.write(`${options.json ? JSON.stringify(items, null, 2) : formatText(items)}\n`);
    process.exitCode = exitCodeFor(items);
  } catch (error) {
    const help = error instanceof UsageError ? `\n${usage}` : "";
    process.stderr.write(`comments: ${error?.message ?? error}${help}\n`);
    process.exitCode = 2;
  }
};

const invokedDirectly = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(scriptPath);
  } catch {
    return false;
  }
};

if (invokedDirectly()) main();
