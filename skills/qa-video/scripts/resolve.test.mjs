import assert from "node:assert/strict";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { fakeCache, makeScratch, stubPlaywright, writer } from "./fixtures.mjs";
import { browsersCacheRoot, browsersReport, bundledFfmpeg, globalModuleDirs, resolvePlaywright } from "./resolve.mjs";

const scratch = makeScratch("qa-video-resolve-test-");
const write = writer(scratch);
const quiet = { NODE_PATH: "", QA_VIDEO_GLOBAL_MODULES: "" };
const resolveFrom = (cwd, env = {}, flag) => {
  mkdirSync(cwd, { recursive: true });
  return resolvePlaywright(flag, { env: { ...quiet, ...env }, cwd });
};
const browsersJson = (revisions) => ({ browsers: Object.entries(revisions).map(([name, revision]) => ({ name, revision })) });

describe("resolvePlaywright", () => {
  test("an evidence directory finds the repository root through .claude or .codex", async () => {
    stubPlaywright(join(scratch, "repo", "node_modules"));
    const claude = await resolveFrom(join(scratch, "repo", ".claude", "state", "qa", "slug", "pr-7", "abc1234"));
    assert.deepEqual({ found: claude.found, version: claude.version, resolvedFrom: claude.resolvedFrom }, { found: true, version: "9.9.9", resolvedFrom: "repo-root" });
    assert.ok(claude.candidatesTried.some((candidate) => candidate.from === "repo-root" && candidate.path === join(scratch, "repo", "node_modules") && candidate.outcome === "found playwright"));
    mkdirSync(join(scratch, "codex-repo", ".codex"), { recursive: true });
    stubPlaywright(join(scratch, "codex-repo", "node_modules"));
    assert.equal((await resolveFrom(join(scratch, "codex-repo", ".codex", "vistack", "state", "qa", "s", "p", "h"))).resolvedFrom, "repo-root");
  });

  test("the package a project declares wins over a hoisted transitive copy in the same node_modules", async () => {
    write("project/package.json", JSON.stringify({ devDependencies: { "@playwright/test": "1.62.1" } }));
    stubPlaywright(join(scratch, "project", "node_modules"), { version: "1.56.1" });
    stubPlaywright(join(scratch, "project", "node_modules"), { name: "@playwright/test", version: "1.62.1" });
    const result = await resolveFrom(join(scratch, "project", "e2e"));
    assert.deepEqual({ version: result.version, resolvedFrom: result.resolvedFrom, path: result.path }, { version: "1.62.1", resolvedFrom: "project-root", path: join(scratch, "project", "node_modules", "@playwright", "test") });
  });

  test("the declared package wins over a nearer transitive copy that no package.json declares", async () => {
    write("transitive/package.json", JSON.stringify({ devDependencies: { "@playwright/test": "1.62.1" } }));
    stubPlaywright(join(scratch, "transitive", "node_modules"), { name: "@playwright/test", version: "1.62.1" });
    stubPlaywright(join(scratch, "transitive", "pkg", "node_modules"), { version: "1.56.1" });
    const result = await resolveFrom(join(scratch, "transitive", "pkg"));
    assert.deepEqual({ version: result.version, resolvedFrom: result.resolvedFrom }, { version: "1.62.1", resolvedFrom: "project-root" });
    assert.deepEqual(result.candidatesTried.slice(0, 2), [
      { from: "cwd", path: join(scratch, "transitive", "pkg", "node_modules"), outcome: `skipped playwright: ${join(scratch, "transitive", "package.json")} declares @playwright/test` },
      { from: "project-root", path: join(scratch, "transitive", "node_modules"), outcome: `found @playwright/test, declared by ${join(scratch, "transitive", "package.json")}` },
    ]);
  });

  test("a declared package hoisted above the declaring package.json is found from there", async () => {
    write("mono/apps/web/package.json", JSON.stringify({ devDependencies: { playwright: "1.62.1" } }));
    stubPlaywright(join(scratch, "mono", "node_modules"), { version: "1.62.1" });
    stubPlaywright(join(scratch, "mono", "apps", "web", "e2e", "node_modules"), { name: "playwright-core", version: "1.56.1", core: false });
    const result = await resolveFrom(join(scratch, "mono", "apps", "web", "e2e"));
    assert.deepEqual({ version: result.version, resolvedFrom: result.resolvedFrom, path: result.path }, { version: "1.62.1", resolvedFrom: "project-root", path: join(scratch, "mono", "node_modules", "playwright") });
  });

  test("with nothing declared, the nearest node_modules wins, whatever the package name", async () => {
    stubPlaywright(join(scratch, "chain", "node_modules"), { version: "1.56.1" });
    stubPlaywright(join(scratch, "chain", "pkg", "node_modules"), { name: "playwright-core", version: "1.62.1", core: false });
    const result = await resolveFrom(join(scratch, "chain", "pkg"));
    assert.deepEqual({ version: result.version, resolvedFrom: result.resolvedFrom }, { version: "1.62.1", resolvedFrom: "cwd" });
  });

  test("a project that declares Playwright without installing it stops there and says so", async () => {
    write("declared/package.json", JSON.stringify({ dependencies: { playwright: "1.62.1" } }));
    stubPlaywright(join(scratch, "declared", "lane", "node_modules"), { name: "playwright-core", version: "1.56.1", core: false });
    const result = await resolveFrom(join(scratch, "declared", "lane"), { QA_VIDEO_GLOBAL_MODULES: join(scratch, "global") });
    assert.equal(result.found, false);
    const manifest = join(scratch, "declared", "package.json");
    assert.deepEqual(result.candidatesTried.at(-1), { from: "project-root", path: manifest, outcome: `declares playwright, but no node_modules at or above ${join(scratch, "declared")} holds it` });
    assert.equal(result.reason, `not found from ${join(scratch, "declared", "lane")}: ${manifest} declares playwright, but it is not installed; install the project's dependencies`);
    assert.ok(!result.candidatesTried.some((candidate) => candidate.from === "global"), "an undeclared global copy was tried");
  });

  test("an explicit flag or QA_VIDEO_PLAYWRIGHT that does not resolve is final", async () => {
    stubPlaywright(join(scratch, "explicit", "node_modules"));
    const flagged = await resolveFrom(join(scratch, "explicit"), {}, join(scratch, "nowhere"));
    assert.deepEqual({ found: flagged.found, source: flagged.source, resolvedFrom: flagged.resolvedFrom }, { found: false, source: "flag", resolvedFrom: null });
    assert.deepEqual(flagged.candidatesTried.map((candidate) => [candidate.from, candidate.path]), [["flag", join(scratch, "nowhere")]]);
    assert.match(flagged.reason, /^cannot resolve /);
    const viaEnv = await resolveFrom(join(scratch, "explicit"), { QA_VIDEO_PLAYWRIGHT: join(scratch, "nowhere") });
    assert.deepEqual([viaEnv.found, viaEnv.source, viaEnv.candidatesTried.length], [false, "env", 1]);
    const good = await resolveFrom(join(scratch, "explicit"), {}, join(scratch, "explicit", "node_modules", "playwright"));
    assert.deepEqual([good.found, good.resolvedFrom], [true, "flag"]);
  });

  test("NODE_PATH, then the global module directories, are tried last", async () => {
    stubPlaywright(join(scratch, "node-path"));
    stubPlaywright(join(scratch, "global"), { name: "playwright-core", core: false });
    const outside = join(scratch, "outside");
    assert.equal((await resolveFrom(outside, { NODE_PATH: join(scratch, "node-path") })).resolvedFrom, "node-path");
    const global = await resolveFrom(outside, { QA_VIDEO_GLOBAL_MODULES: join(scratch, "global") });
    assert.equal(global.resolvedFrom, "global");
    assert.deepEqual(global.candidatesTried.find((candidate) => candidate.from === "node-path"), { from: "node-path", path: null, outcome: "NODE_PATH is empty" });
  });
});

describe("globalModuleDirs", () => {
  test("covers the node prefix, npm prefixes, Homebrew, and the legacy home folders without spawning npm", () => {
    const dirs = globalModuleDirs({ npm_config_prefix: "/p" }, { platform: "darwin", execPath: "/n/bin/node", home: "/h" });
    for (const dir of ["/p/lib/node_modules", "/n/lib/node_modules", "/h/.npm-global/lib/node_modules", "/opt/homebrew/lib/node_modules", "/usr/local/lib/node_modules", "/h/.node_modules", "/h/.node_libraries"]) {
      assert.ok(dirs.includes(dir), `${dir} missing from ${dirs.join(", ")}`);
    }
    assert.ok(globalModuleDirs({ APPDATA: "C:/a" }, { platform: "win32", execPath: "C:/n/node.exe", home: "C:/h" }).includes(join("C:/a", "npm", "node_modules")));
    assert.deepEqual(globalModuleDirs({ QA_VIDEO_GLOBAL_MODULES: "" }), []);
  });
});

describe("browsers cache", () => {
  test("follows PLAYWRIGHT_BROWSERS_PATH, 0 included, and each platform's default", () => {
    const base = { coreDir: "/core", home: "/h", cwd: "/w" };
    assert.deepEqual(browsersCacheRoot({ ...base, env: {}, platform: "darwin" }), { cache: "/h/Library/Caches/ms-playwright", from: "default", reason: null });
    assert.equal(browsersCacheRoot({ ...base, env: {}, platform: "linux" }).cache, "/h/.cache/ms-playwright");
    assert.equal(browsersCacheRoot({ ...base, env: { XDG_CACHE_HOME: "/x" }, platform: "linux" }).cache, "/x/ms-playwright");
    assert.equal(browsersCacheRoot({ ...base, env: { LOCALAPPDATA: "/l" }, platform: "win32" }).cache, join("/l", "ms-playwright"));
    assert.deepEqual(browsersCacheRoot({ ...base, env: { PLAYWRIGHT_BROWSERS_PATH: "0" } }), { cache: "/core/.local-browsers", from: "PLAYWRIGHT_BROWSERS_PATH=0", reason: null });
    assert.equal(browsersCacheRoot({ ...base, coreDir: null, env: { PLAYWRIGHT_BROWSERS_PATH: "0" } }).cache, null);
    assert.equal(browsersCacheRoot({ ...base, env: { PLAYWRIGHT_BROWSERS_PATH: "rel", INIT_CWD: "/init" } }).cache, "/init/rel");
    assert.deepEqual(browsersCacheRoot({ ...base, env: { PLAYWRIGHT_BROWSERS_PATH: "/elsewhere" }, executable: "/real/cache/chromium-1234/chrome-mac/Chromium" }), { cache: "/real/cache", from: "executablePath", reason: null });
  });

  test("bundledFfmpeg takes the revision browsers.json expects, else the newest present, and says which", () => {
    const cache = fakeCache(join(scratch, "ffmpeg-cache"), ["ffmpeg-1009", "ffmpeg-1011", "ffmpeg_mac12_special-1010"]);
    assert.equal(readdirSync(cache).sort()[0], "ffmpeg-1009", "the wrong revision must sort first so a first-directory pick fails");
    const notFirst = bundledFfmpeg(cache, browsersJson({ ffmpeg: "1011" }), "linux");
    assert.deepEqual(notFirst, { expected: "1011", present: true, path: join(cache, "ffmpeg-1011", "ffmpeg-linux"), missing: [], note: null });
    const notNewest = bundledFfmpeg(cache, browsersJson({ ffmpeg: "1009" }), "linux");
    assert.equal(notNewest.path, join(cache, "ffmpeg-1009", "ffmpeg-linux"));
    const absent = bundledFfmpeg(cache, browsersJson({ ffmpeg: "1020" }), "darwin");
    assert.deepEqual(absent, { expected: "1020", present: false, path: null, missing: ["ffmpeg-1020"], note: null });
    const fallback = bundledFfmpeg(cache, null, "win32");
    assert.equal(fallback.path, join(cache, "ffmpeg-1011", "ffmpeg-win64.exe"));
    assert.match(fallback.note, /browsers\.json unavailable; picked the newest present ffmpeg-1011/);
    const override = { browsers: [{ name: "ffmpeg", revision: "1011", revisionOverrides: { mac12: "1010" } }] };
    assert.equal(bundledFfmpeg(fakeCache(join(scratch, "special-cache"), ["ffmpeg_mac12_special-1010"]), override, "darwin").present, true);
    assert.equal(bundledFfmpeg(fakeCache(join(scratch, "unfinished-cache"), []), browsersJson({ ffmpeg: "1009" }), "darwin").present, false);
  });

  test("browsersReport compares what the loaded Playwright expects with what the cache holds", async () => {
    const project = join(scratch, "report");
    stubPlaywright(join(project, "node_modules"), { name: "@playwright/test", revisions: { chromium: "1234", "chromium-headless-shell": "1234", ffmpeg: "1011" } });
    const cache = fakeCache(join(scratch, "report-cache"), ["chromium-1234", "ffmpeg-1011"]);
    write("report-cache/chromium_headless_shell-1234/partial-download", "");
    const playwright = await resolveFrom(project);
    const report = browsersReport({ playwright, browser: "chromium", executable: null, env: { PLAYWRIGHT_BROWSERS_PATH: cache }, cwd: project });
    assert.equal(report.manifest, join(project, "node_modules", "@playwright", "test", "node_modules", "playwright-core", "browsers.json"));
    assert.deepEqual(report.chromium, { expected: "1234", present: false, missing: ["chromium_headless_shell-1234"] });
    assert.equal(report.ffmpeg.present, true);
    assert.equal(report.reason, null);
    const unknown = browsersReport({ playwright: { found: false, path: null }, browser: "chromium", executable: null, env: { PLAYWRIGHT_BROWSERS_PATH: cache }, cwd: project });
    assert.deepEqual(unknown.chromium, { expected: null, present: null, missing: [] });
    assert.match(unknown.reason, /Playwright not found/);
    assert.match(unknown.ffmpeg.note, /newest present ffmpeg-1011/);
  });
});
