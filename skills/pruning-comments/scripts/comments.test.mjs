import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyFile,
  collectComments,
  directiveMarkers,
  exitCodeFor,
  formatText,
  isUtilityFile,
  parseAddedLines,
  parseArgs,
  syntaxFor,
} from "./comments.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "comments.mjs");
const scratch = mkdtempSync(join(tmpdir(), "comments-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const added = (...texts) => texts.map((text, index) => ({ line: index + 1, text }));
const kinds = (path, ...texts) =>
  classifyFile(path, added(...texts)).map(({ line, endLine, kind }) => [line, endLine, kind]);

describe("classifyFile", () => {
  test("a whole-line comment is prune", () => {
    assert.deepEqual(kinds("src/a.ts", "const a = 1;", "// add one", "a + 1;"), [[2, 2, "prune"]]);
  });

  test("a trailing comment is found after code", () => {
    const [item] = classifyFile("src/a.ts", added('const url = "http://x.test"; // fetch it'));
    assert.equal(item.kind, "prune");
    assert.equal(item.text, "// fetch it");
  });

  test("markers inside strings are not comments", () => {
    assert.deepEqual(kinds("src/a.ts", 'const s = "a // b";', "const t = 'c /* d */';", "const u = `e // f`;"), []);
    assert.deepEqual(kinds("app.py", 's = "a # b"', "u = 'http://x'"), []);
  });

  test("a URL outside a string is not a comment", () => {
    assert.deepEqual(kinds("src/link.tsx", "<a>https://example.com/docs</a>"), []);
    assert.deepEqual(kinds("run.sh", "curl https://example.com/a#frag", 'echo "$#" ${#name}'), []);
  });

  test("an unclosed quote does not hide a later comment", () => {
    assert.deepEqual(kinds("src/lib.rs", "fn f<'a>(x: &'a str) {} // borrow"), [[1, 1, "prune"]]);
  });

  test("a block spanning lines is one item with an end line", () => {
    assert.deepEqual(kinds("src/a.ts", "/* first", "   second", "*/", "run();"), [[1, 3, "prune"]]);
  });

  test("a block opened and closed on one line is one item", () => {
    assert.deepEqual(kinds("src/a.ts", "run(/* inline */ 1);"), [[1, 1, "prune"]]);
  });

  test("a hunk gap resets an open block", () => {
    const lines = [
      { line: 1, text: "/* open" },
      { line: 10, text: " * continued" },
      { line: 11, text: "*/" },
    ];
    assert.deepEqual(classifyFile("src/a.ts", lines).map(({ line, endLine }) => [line, endLine]), [[1, 1]]);
  });
});

describe("jsdoc", () => {
  const doc = ["/**", " * Formats a date.", " * @param date - the date", " * @returns the label", " */"];

  test("a JSDoc block in a utility file is allowed", () => {
    const [item] = classifyFile("src/date.utils.ts", added(...doc, "export const format = (date) => date;"));
    assert.deepEqual([item.line, item.endLine, item.kind, item.issues], [1, 5, "jsdoc", []]);
    assert.equal(classifyFile("src/utils/money.ts", added(...doc))[0].kind, "jsdoc");
    assert.equal(classifyFile("lib/text.util.mjs", added(...doc))[0].kind, "jsdoc");
  });

  test("a JSDoc block outside a utility file is prune", () => {
    assert.deepEqual(kinds("src/date.ts", ...doc), [[1, 5, "prune"]]);
  });

  test("shape issues name the extra tags and TypeScript type braces", () => {
    const lines = added("/**", " * Pads.", " * @param {string} text - input", " * @example pad('a')", " */");
    assert.deepEqual(classifyFile("src/text.utils.ts", lines)[0].issues, ["@example", "{Type}"]);
    assert.deepEqual(classifyFile("src/text.utils.js", lines)[0].issues, ["@example"]);
  });

  test("an empty block is not JSDoc", () => {
    assert.equal(classifyFile("src/a.utils.ts", added("run(/**/);"))[0].kind, "prune");
  });

  test("utility detection", () => {
    assert.equal(isUtilityFile("src/a.utils.tsx"), true);
    assert.equal(isUtilityFile("src/utils/a.ts"), true);
    assert.equal(isUtilityFile("src/utilsx/a.ts"), false);
    assert.equal(isUtilityFile("src/futils.ts"), false);
  });
});

describe("directives", () => {
  test("machine-read comments are directive", () => {
    assert.deepEqual(kinds("src/a.ts", "// eslint-disable-next-line no-console"), [[1, 1, "directive"]]);
    assert.deepEqual(kinds("main.go", "//go:build linux"), [[1, 1, "directive"]]);
    assert.deepEqual(kinds("app.py", "import os  # noqa: F401"), [[1, 1, "directive"]]);
    assert.deepEqual(kinds("src/a.ts", 'import(/* webpackChunkName: "x" */ "./x");'), [[1, 1, "directive"]]);
  });

  test("a shebang is a directive only on the first line", () => {
    assert.deepEqual(kinds("bin/run.mjs", "#!/usr/bin/env node", "#!not-a-marker-here"), [[1, 1, "directive"]]);
    assert.deepEqual(kinds("run.sh", "#!/bin/sh"), [[1, 1, "directive"]]);
  });

  test("the marker list is one exported constant", () => {
    assert.ok(directiveMarkers.includes("eslint-"));
    assert.ok(directiveMarkers.includes("SPDX-License-Identifier"));
  });
});

describe("languages", () => {
  test("hash languages", () => {
    for (const path of ["app.py", "lib.rb", "deploy.yml", "Dockerfile", "Dockerfile.dev", "Makefile", "rules.mk", "main.tf"]) {
      assert.deepEqual(kinds(path, "# explain"), [[1, 1, "prune"]], path);
    }
  });

  test("dash and markup languages", () => {
    assert.deepEqual(kinds("query.sql", "select 1 -- pick rows"), [[1, 1, "prune"]]);
    assert.deepEqual(kinds("index.html", "<!-- header -->"), [[1, 1, "prune"]]);
    assert.deepEqual(kinds("App.vue", "<!-- top", "-->", "const a = 1; // note"), [[1, 2, "prune"], [3, 3, "prune"]]);
    assert.deepEqual(kinds("site.css", "a { color: red; } // not css"), []);
    assert.deepEqual(kinds("site.css", "/* theme */"), [[1, 1, "prune"]]);
    assert.deepEqual(kinds("index.php", "$a = 1; # note"), [[1, 1, "prune"]]);
  });

  test("skipped paths and extensions", () => {
    for (const path of ["README.md", "notes.mdx", "pnpm-lock.yaml", "yarn.lock", "dist/app.js", "node_modules/x/a.js", "app.min.js", "vendor/a.go", "data.json"]) {
      assert.equal(syntaxFor(path), null, path);
    }
    assert.deepEqual(kinds("docs/a.md", "<!-- x -->"), []);
  });
});

describe("parseAddedLines", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,2 +1,3 @@",
    " keep();",
    "-old();",
    "+// new",
    "+run();",
    "\\ No newline at end of file",
    "diff --git a/gone.ts b/gone.ts",
    "--- a/gone.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-// gone",
    'diff --git "a/sp ace.ts" "b/sp ace.ts"',
    '+++ "b/sp ace.ts"',
    "@@ -0,0 +5 @@",
    "+// quoted",
  ].join("\n");

  test("keeps added lines with new-side numbers per file", () => {
    const files = parseAddedLines(diff);
    assert.deepEqual([...files.keys()], ["src/a.ts", "sp ace.ts"]);
    assert.deepEqual(files.get("src/a.ts"), [{ line: 2, text: "// new" }, { line: 3, text: "run();" }]);
    assert.deepEqual(files.get("sp ace.ts"), [{ line: 5, text: "// quoted" }]);
  });

  test("formats items and picks the exit code", () => {
    const items = collectComments(parseAddedLines(diff));
    assert.equal(formatText(items), "src/a.ts:2  prune  // new\nsp ace.ts:5  prune  // quoted\n2 prune, 0 jsdoc, 0 directive");
    assert.equal(exitCodeFor(items), 1);
    assert.equal(exitCodeFor([]), 0);
  });

  test("argument rules", () => {
    assert.deepEqual(parseArgs(["--diff", "-", "--json"]), { json: true, help: false, diff: "-" });
    assert.throws(() => parseArgs(["--base", "main", "--diff", "x"]), /not both/);
    assert.throws(() => parseArgs(["--wat"]), /unexpected argument --wat/);
  });
});

describe("command line", () => {
  const repo = join(scratch, "repo");
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const run = (args, input) => spawnSync(process.execPath, [script, ...args], { cwd: repo, input, encoding: "utf8" });

  mkdirSync(join(repo, "src"), { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(repo, "src/a.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-q", "--no-verify", "-m", "init");

  test("exit 0 when added lines carry no comment", () => {
    writeFileSync(join(repo, "src/a.ts"), "export const a = 1;\nexport const b = 2;\n");
    const result = run(["--base", "main"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "0 prune, 0 jsdoc, 0 directive\n");
  });

  test("exit 1 lists tracked and untracked comments, with the default base", () => {
    writeFileSync(join(repo, "src/a.ts"), "export const a = 1;\n// explain b\nexport const b = 2;\n");
    writeFileSync(join(repo, "src/new.py"), "# note\nx = 1\n");
    const result = run([]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^src\/a\.ts:2  prune  \/\/ explain b$/m);
    assert.match(result.stdout, /^src\/new\.py:1  prune  # note$/m);
    const json = JSON.parse(run(["--json"]).stdout);
    assert.deepEqual(json.map(({ path, line, kind }) => [path, line, kind]), [["src/a.ts", 2, "prune"], ["src/new.py", 1, "prune"]]);
  });

  test("exit 2 on a bad base or a bad argument", () => {
    const badBase = run(["--base", "nope"]);
    assert.equal(badBase.status, 2);
    assert.match(badBase.stderr, /merge-base/);
    const badFlag = run(["--wat"]);
    assert.equal(badFlag.status, 2);
    assert.match(badFlag.stderr, /exit codes: 0 no prune candidates/);
  });

  test("--diff - reads stdin", () => {
    const input = "+++ b/x.ts\n@@ -0,0 +1 @@\n+// from stdin\n";
    const result = run(["--diff", "-"], input);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "x.ts:1  prune  // from stdin\n1 prune, 0 jsdoc, 0 directive\n");
  });
});
