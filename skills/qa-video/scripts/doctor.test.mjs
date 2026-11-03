import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { brokenTool, cliRunner, fakeCache, fakeTool, isolated, makeScratch, stubPlaywright, writer } from "./fixtures.mjs";

const scratch = makeScratch("qa-video-doctor-test-");
const runCli = cliRunner(scratch);
const write = writer(scratch);
const posix = process.platform !== "win32";
const doctorKeys = ["ok", "node", "playwright", "ffmpeg", "ffprobe", "imagemagick", "outputs", "hints", "browsers", "recorder", "encoders"];

const doctor = async (args, extraEnv, options) => {
  const result = await runCli(["doctor", ...args], { ...isolated, ...extraEnv }, options);
  return { ...result, report: JSON.parse(result.stdout) };
};

describe("doctor", () => {
  test("from a directory outside any project it names every candidate it tried and how to point at Playwright", async () => {
    const outside = join(scratch, "outside", "lane");
    const globals = join(scratch, "globals");
    mkdirSync(outside, { recursive: true });
    mkdirSync(globals, { recursive: true });
    const { status, report } = await doctor([], { NODE_PATH: join(scratch, "node-path"), QA_VIDEO_GLOBAL_MODULES: globals }, { cwd: outside });
    assert.equal(status, 1);
    assert.deepEqual(Object.keys(report), doctorKeys);
    assert.equal(report.ok, false);
    assert.equal(report.playwright.found, false);
    assert.equal(report.playwright.resolvedFrom, null);
    const tried = report.playwright.candidatesTried;
    assert.ok(tried.some((candidate) => candidate.from === "cwd" && candidate.path === outside), JSON.stringify(tried));
    assert.ok(tried.some((candidate) => candidate.from === "repo-root" && candidate.path === null));
    assert.ok(tried.some((candidate) => candidate.from === "project-root" && candidate.path === null));
    assert.ok(tried.some((candidate) => candidate.from === "node-path" && candidate.path === join(scratch, "node-path")));
    assert.ok(tried.some((candidate) => candidate.from === "global" && candidate.path === globals));
    assert.deepEqual(report.recorder, { ok: false, reason: `Playwright not found from ${outside}` });
    const hint = report.hints[0];
    for (const needle of [outside, "QA_VIDEO_PLAYWRIGHT", "--playwright"]) assert.ok(hint.includes(needle), `${needle} missing from ${hint}`);
  });

  test("an explicit --playwright that does not resolve stops there, even with Playwright in the cwd", async () => {
    const project = join(scratch, "explicit");
    stubPlaywright(join(project, "node_modules"));
    const { report } = await doctor(["--playwright", join(scratch, "nowhere")], {}, { cwd: project });
    assert.equal(report.playwright.found, false);
    assert.equal(report.playwright.source, "flag");
    assert.deepEqual(report.playwright.candidatesTried.map((candidate) => [candidate.from, candidate.path]), [["flag", join(scratch, "nowhere")]]);
    assert.match(report.hints[0], /--playwright/);
  });

  test("a revision mismatch between the loaded Playwright and the browsers cache shows before record", async () => {
    const project = join(scratch, "mismatch");
    const cache = fakeCache(join(scratch, "mismatch-cache"), ["chromium-1000", "chromium_headless_shell-1000", "ffmpeg-1009", "ffmpeg-1011"]);
    const playwright = stubPlaywright(join(project, "node_modules"));
    const { status, report } = await doctor([], { PLAYWRIGHT_BROWSERS_PATH: cache, STUB_RECORDER: "nolaunch" }, { cwd: project });
    assert.equal(status, 1);
    assert.equal(report.playwright.found, true);
    assert.equal(report.playwright.version, "9.9.9");
    assert.equal(report.playwright.resolvedFrom, "cwd");
    assert.equal(report.browsers.cache, cache);
    assert.deepEqual(report.browsers.chromium, { expected: "9999", present: false, missing: ["chromium-9999", "chromium_headless_shell-9999"] });
    assert.equal(report.browsers.ffmpeg.expected, "1009");
    assert.equal(report.browsers.ffmpeg.present, true);
    assert.equal(report.browsers.ffmpeg.path, join(cache, "ffmpeg-1009", process.platform === "darwin" ? "ffmpeg-mac" : process.platform === "win32" ? "ffmpeg-win64.exe" : "ffmpeg-linux"));
    assert.match(report.playwright.browser.launch, /^browserType\.launch: Executable doesn't exist/);
    assert.deepEqual(report.recorder, { ok: false, reason: `the browser did not launch: ${report.playwright.browser.launch}` });
    assert.ok(report.hints.some((hint) => hint.includes("chromium-9999") && hint.includes(`node "${join(playwright, "cli.js")}" install chromium`)), report.hints.join("\n"));
  });

  test("the recorder probe reports the recordVideo failure text; a working one makes ok true", async () => {
    const project = join(scratch, "recorder");
    const cache = fakeCache(join(scratch, "recorder-cache"), ["chromium-9999", "chromium_headless_shell-9999", "ffmpeg-1009"]);
    stubPlaywright(join(project, "node_modules"));
    const broken = await doctor([], { PLAYWRIGHT_BROWSERS_PATH: cache, STUB_RECORDER: "noffmpeg" }, { cwd: project });
    assert.equal(broken.report.playwright.browser.launch, "ok");
    assert.deepEqual(broken.report.recorder, { ok: false, reason: "browser.newContext: Executable doesn't exist at /stub/ffmpeg-1009/ffmpeg-mac" });
    assert.equal(broken.report.ok, false);
    const silent = await doctor([], { PLAYWRIGHT_BROWSERS_PATH: cache, STUB_RECORDER: "novideo" }, { cwd: project });
    assert.equal(silent.status, 1);
    assert.deepEqual(silent.report.recorder, { ok: false, reason: "recordVideo wrote no video file" });
    assert.equal(silent.report.outputs.webm, false);
    const working = await doctor([], { PLAYWRIGHT_BROWSERS_PATH: cache }, { cwd: project });
    assert.equal(working.status, 0);
    assert.deepEqual(working.report.recorder, { ok: true, reason: null });
    assert.equal(working.report.ok, true);
    assert.equal(working.report.outputs.webm, true);
    assert.deepEqual(working.report.browsers.chromium, { expected: "9999", present: true, missing: [] });
  });

  test("PLAYWRIGHT_BROWSERS_PATH=0 reads the cache inside playwright-core", async () => {
    const project = join(scratch, "local-browsers");
    const playwright = stubPlaywright(join(project, "node_modules"));
    const local = fakeCache(join(playwright, "node_modules", "playwright-core", ".local-browsers"), ["ffmpeg-1009"]);
    const { report } = await doctor([], { PLAYWRIGHT_BROWSERS_PATH: "0" }, { cwd: project });
    assert.equal(report.browsers.cache, local);
    assert.equal(report.browsers.ffmpeg.present, true);
    assert.equal(report.browsers.chromium.present, false);
  });

  test("with PATH reduced to node, ffmpeg and ImageMagick are found in the tool directories", { skip: !posix && "the fake tools are POSIX scripts" }, async () => {
    const homebrew = join(scratch, "homebrew", "bin");
    for (const tool of ["ffmpeg", "ffprobe", "magick"]) write(`homebrew/bin/${tool}`, fakeTool, 0o755);
    const { report } = await doctor([], { QA_VIDEO_TOOL_DIRS: homebrew });
    assert.equal(report.ffmpeg.path, join(homebrew, "ffmpeg"));
    assert.equal(report.ffmpeg.error, null);
    assert.equal(report.ffprobe.path, join(homebrew, "ffprobe"));
    assert.equal(report.imagemagick.path, join(homebrew, "magick"));
    assert.deepEqual(report.encoders, { mp4: true, gif: true, slideshow: true, sheet: true, reasons: { mp4: null, gif: null, slideshow: null, sheet: null } });
  });

  test("an FFMPEG_PATH that exits 1 is reported as failing, with its exit code and stderr", { skip: !posix && "the fake tools are POSIX scripts" }, async () => {
    const broken = write("broken/ffmpeg", brokenTool, 0o755);
    const { report } = await doctor([], { FFMPEG_PATH: broken });
    assert.equal(report.ffmpeg.path, broken);
    assert.equal(report.ffmpeg.error, "-version exited 1: dyld: Library not loaded: libx265.so");
    assert.equal(report.encoders.mp4, false);
    assert.match(report.encoders.reasons.mp4, /^ffmpeg at .+ failed: -version exited 1: dyld/);
    assert.ok(report.hints.some((hint) => hint.includes("failed") && hint.includes(broken)));
  });

  test("a missing ffmpeg says so in the encoder reasons", async () => {
    const { report } = await doctor([]);
    assert.equal(report.ffmpeg.path, null);
    assert.match(report.ffmpeg.error, /^ffmpeg not found on PATH/);
    assert.match(report.encoders.reasons.gif, /^ffmpeg not found/);
    assert.match(report.encoders.reasons.sheet, /^ImageMagick not found/);
  });
});
