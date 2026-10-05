import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "qa-video.mjs");
const scratch = mkdtempSync(join(tmpdir(), "qa-video-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const sentinel = "sentinel-7f3a9c";
const webmMagic = [0x1a, 0x45, 0xdf, 0xa3];
const pngMagic = [0x89, 0x50, 0x4e, 0x47];
const manifestKeys = ["version", "scenario", "target", "head", "recorded_at", "mode", "browser", "playwright", "size", "duration", "video", "steps", "outputs", "warnings"];
const stepKeys = ["name", "caption", "start", "end", "result", "screenshot", "error", "sensitive"];

const runCli = (args, extraEnv = {}) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: scratch, env: { ...process.env, QA_PASSWORD: sentinel, ...extraEnv } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => done({ status, stdout, stderr }));
  });

const startsWith = (path, bytes) => bytes.every((byte, index) => readFileSync(path)[index] === byte);
const write = (name, content) => {
  const path = join(scratch, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
};
const allFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? allFiles(join(directory, entry.name)) : [join(directory, entry.name)]));
const assertNoSentinel = (directory, ...texts) => {
  for (const text of texts) assert.ok(!text.includes(sentinel), "the sentinel leaked into process output");
  for (const file of allFiles(directory)) assert.ok(!readFileSync(file, "latin1").includes(sentinel), `the sentinel leaked into ${file}`);
};

const syntheticEvidence = (folder, duration = 2) => {
  const directory = join(scratch, folder);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "demo.webm"), Buffer.from([...webmMagic, 0, 0, 0, 0]));
  writeFileSync(join(directory, "demo-one.png"), Buffer.from([...pngMagic, 0x0d, 0x0a, 0x1a, 0x0a]));
  writeFileSync(join(directory, "demo-two.png"), Buffer.from([...pngMagic, 0x0d, 0x0a, 0x1a, 0x0a]));
  const manifest = {
    version: 1, scenario: "demo", target: null, head: null, recorded_at: "2026-10-02T00:00:00.000Z", mode: "context", browser: "chromium", playwright: "1.0.0",
    size: { width: 640, height: 360 }, duration, video: "demo.webm",
    steps: [
      { name: "one", caption: "50% done", start: 0.25, end: 1.5, result: "pass", screenshot: "demo-one.png", error: null, sensitive: false },
      { name: "two", caption: "@home", start: 1.5, end: 1.9, result: "fail", screenshot: "demo-two.png", error: "nope", sensitive: false },
    ],
    outputs: { webm: { path: "demo.webm", bytes: 8, status: "produced" } }, warnings: [],
  };
  const manifestPath = join(directory, "demo.manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { directory, manifestPath };
};

// Stands in for ffmpeg and magick: lists full capabilities, logs argv, and writes outputs per FAKE_MODE.
const fakeTool = `#!/usr/bin/env node
const { appendFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const lists = {
  "-encoders": " ------\\n V....D libx264  H.264\\n V....D gif  GIF\\n",
  "-filters": " ... fps  V->V  x\\n ... palettegen  V->V  x\\n ... paletteuse  VV->V  x\\n ..C scale  V->V  x\\n ... split  V->N  x\\n",
  "-decoders": " ------\\n VFS..D png  PNG\\n",
  "-demuxers": " ---\\n D   concat  Virtual concatenation script\\n",
};
if (args[0] === "-version") { console.log("ffmpeg version 9.9-fake"); process.exit(0); }
if (lists[args[1]]) { process.stdout.write(lists[args[1]]); process.exit(0); }
appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + "\\n");
const output = args.at(-1);
const mode = process.env.FAKE_MODE;
if (mode === "fail") { process.stderr.write("x".repeat(600) + " encoder rejected " + process.env.QA_PASSWORD + "\\n"); process.exit(1); }
const head = output.endsWith(".gif") ? Buffer.from("GIF89a") : output.endsWith(".png") ? Buffer.from([0x89, 0x50, 0x4e, 0x47]) : Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);
const small = mode === "shrink" && args.includes("-b:v");
writeFileSync(output, Buffer.concat([head, Buffer.alloc(small ? 100 : 2 * 1024 * 1024)]));
`;

describe("qa-video CLI without a browser", () => {
  test("--help lists commands and each command's flags, exit 0", async () => {
    const top = await runCli(["--help"]);
    assert.equal(top.status, 0);
    for (const command of ["doctor", "record", "finish", "check"]) {
      assert.match(top.stdout, new RegExp(`^  ${command}\\s`, "m"));
      const help = await runCli([command, "--help"]);
      assert.equal(help.status, 0, help.stderr);
      assert.match(help.stdout, new RegExp(`^usage: qa-video\\.mjs ${command}`));
    }
    const record = await runCli(["record", "--help"]);
    for (const flag of ["scenario", "out", "name", "url", "head", "size", "browser", "headed", "mode", "actions", "title-card", "playwright"]) {
      assert.match(record.stdout, new RegExp(`--${flag}\\b`), flag);
    }
  });

  test("usage errors exit 2 with JSON on stdout", async () => {
    const usageErrors = [
      [], ["bogus"], ["record", "--out", "x"], ["finish", "--manifest", "m.json", "--nope"], ["record", "--scenario", "s.mjs", "--out", "o", "--size", "big"],
      ["record", "--scenario", "s.mjs", "--out", "o", "--url", `https://qa:${sentinel}@preview.example.com`],
    ];
    for (const args of usageErrors) {
      const result = await runCli(args);
      assert.equal(result.status, 2, args.join(" "));
      assert.ok(!result.stdout.includes(sentinel) && !result.stderr.includes(sentinel));
    }
    const result = await runCli(["check", "--max-mb"]);
    assert.equal(JSON.parse(result.stdout).ok, false);
    assert.match(result.stderr, /--max-mb needs a value/);
  });

  test("doctor returns its JSON report", async () => {
    const result = await runCli(["doctor"], { PATH: dirname(process.execPath), FFMPEG_PATH: "" });
    const report = JSON.parse(result.stdout);
    assert.equal(result.status, report.ok ? 0 : 1);
    assert.deepEqual(Object.keys(report), ["ok", "node", "playwright", "ffmpeg", "ffprobe", "imagemagick", "outputs", "hints"]);
    assert.deepEqual(Object.keys(report.playwright.browser), ["name", "executable", "exists", "launch"]);
    assert.equal(report.ffmpeg.path, null);
    assert.deepEqual(report.outputs, { webm: report.ok, vtt: true, srt: true, mp4: false, gif: false, slideshow: false, sheet: false });
    assert.ok(report.hints.some((hint) => /ffmpeg/.test(hint)));
  });

  test("record setup errors exit 2", async () => {
    const noDefault = write("setup/no-default.mjs", "export const login = async () => {};\n");
    assert.equal((await runCli(["record", "--scenario", "setup/missing.mjs", "--out", "setup/out"])).status, 2);
    assert.equal((await runCli(["record", "--scenario", noDefault, "--out", "setup/out"])).status, 2);
    const missingPlaywright = await runCli(["record", "--scenario", write("setup/ok.mjs", "export default async () => {};\n"), "--out", "setup/out"], { QA_VIDEO_PLAYWRIGHT: join(scratch, "nowhere") });
    assert.equal(missingPlaywright.status, 2);
    assert.match(missingPlaywright.stderr, /npm i -D playwright && npx playwright install chromium/);
  });

  test("record refuses an --out that holds another head's evidence and keeps its video", async () => {
    const out = join(scratch, "heads", "abc1234");
    const video = write("heads/abc1234/demo.webm", Buffer.from([...webmMagic, 0, 0, 0, 0]));
    write("heads/abc1234/demo.manifest.json", JSON.stringify({ version: 1, scenario: "demo", head: "abc1234", steps: [] }));
    const scenario = write("heads/demo.mjs", "export default async () => {};\n");
    const nowhere = { QA_VIDEO_PLAYWRIGHT: join(scratch, "nowhere") };
    const refused = await runCli(["record", "--scenario", scenario, "--out", out, "--head", "def5678"], nowhere);
    assert.equal(refused.status, 2);
    assert.match(JSON.parse(refused.stdout).error, /is evidence for head abc1234; record head def5678 into its own directory/);
    assert.ok(startsWith(video, webmMagic), "the earlier head's video was deleted");
    const sameHead = await runCli(["record", "--scenario", scenario, "--out", out, "--head", "abc1234def0"], nowhere);
    assert.doesNotMatch(JSON.parse(sameHead.stdout).error, /is evidence for head/);
  });

  test("finish writes captions and skips mp4 without ffmpeg; check passes it and fails a corrupted copy", async () => {
    const { directory, manifestPath } = syntheticEvidence("synthetic");
    const finished = await runCli(["finish", "--manifest", manifestPath, "--mp4", "--gif", "--sheet"], { PATH: dirname(process.execPath), FFMPEG_PATH: "" });
    assert.equal(finished.status, 0, finished.stderr);
    const { outputs } = JSON.parse(finished.stdout);
    assert.equal(outputs.vtt.status, "produced");
    assert.equal(outputs.srt.status, "produced");
    assert.equal(outputs.mp4.status, "skipped");
    assert.match(outputs.mp4.reason, /ffmpeg not found/);
    assert.equal(outputs.gif.status, "skipped");
    assert.match(outputs.sheet.reason, /ImageMagick not found/);
    assert.equal(readFileSync(join(directory, "demo.vtt"), "utf8"), "WEBVTT\n\n1\n00:00:00.250 --> 00:00:01.500\n1. 50% done (PASS)\n\n2\n00:00:01.500 --> 00:00:01.900\n2. @home (FAIL)\n\n");
    assert.deepEqual(JSON.parse(readFileSync(manifestPath, "utf8")).outputs, outputs);

    const checked = await runCli(["check", "--manifest", manifestPath]);
    assert.equal(checked.status, 0, checked.stdout);
    assert.deepEqual(JSON.parse(checked.stdout), { ok: true, errors: [], warnings: ["1 step failed"], steps: 2, passed: 1, failed: 1 });

    writeFileSync(join(directory, "demo.vtt"), "tampered");
    const tampered = await runCli(["check", "--manifest", manifestPath]);
    assert.equal(tampered.status, 1);
    assert.match(JSON.parse(tampered.stdout).errors.join("\n"), /output vtt demo\.vtt is 8 bytes/);
    writeFileSync(join(directory, "broken.manifest.json"), "{not json");
    assert.equal((await runCli(["check", "--manifest", join(directory, "broken.manifest.json")])).status, 1);
  });
  test("finish drives ffmpeg and ImageMagick by argv: one budget re-encode, over-budget, redacted failures", { skip: process.platform === "win32" && "the fake tools are POSIX scripts" }, async () => {
    const bin = join(scratch, "fakebin");
    mkdirSync(bin, { recursive: true });
    for (const tool of ["ffmpeg", "magick"]) writeFileSync(join(bin, tool), fakeTool, { mode: 0o755 });
    const log = join(scratch, "fake.log");
    const calls = () => readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const toolEnv = (mode) => ({ PATH: `${bin}:${dirname(process.execPath)}`, FFMPEG_PATH: "", FAKE_LOG: log, FAKE_MODE: mode });

    const { directory, manifestPath } = syntheticEvidence("it's here", 8);
    writeFileSync(log, "");
    const shrink = await runCli(["finish", "--manifest", manifestPath, "--mp4", "--max-mb", "1"], toolEnv("shrink"));
    assert.equal(shrink.status, 0, shrink.stderr);
    assert.deepEqual(JSON.parse(shrink.stdout).outputs.mp4, { path: "demo.mp4", bytes: 108, status: "produced" });
    const [first, second] = calls();
    assert.ok(first.includes("-crf") && !first.includes("-b:v"));
    assert.deepEqual(second.slice(7, 13), ["-b:v", "964k", "-maxrate", "964k", "-bufsize", "1928k"]);

    writeFileSync(log, "");
    const big = await runCli(["finish", "--manifest", manifestPath, "--mp4", "--gif", "--slideshow", "--sheet", "--max-mb", "1"], toolEnv("big"));
    assert.equal(big.status, 0, big.stderr);
    const { outputs } = JSON.parse(big.stdout);
    assert.equal(outputs.mp4.status, "over-budget");
    assert.match(outputs.mp4.reason, /after one re-encode at 964 kbps/);
    assert.equal(outputs.gif.status, "over-budget");
    assert.equal(outputs.slideshow.status, "over-budget");
    assert.equal(outputs.sheet.status, "over-budget");
    const logged = calls();
    assert.equal(logged.filter((args) => args.at(-1).endsWith("demo.gif")).length, 1, "the gif must not retry");
    const sheet = logged.find((args) => args[0] === "montage");
    assert.deepEqual(sheet.slice(1, 7), ["-label", "1. 50%% done (PASS)", join(directory, "demo-one.png"), "-label", "2. @home (FAIL)", join(directory, "demo-two.png")]);
    const quoted = directory.replace(/'/g, "'\\''");
    assert.equal(
      readFileSync(join(directory, "demo.slideshow.txt"), "utf8"),
      `file '${quoted}/demo-one.png'\nduration 2\nfile '${quoted}/demo-two.png'\nduration 2\nfile '${quoted}/demo-two.png'\n`,
    );
    const checked = JSON.parse((await runCli(["check", "--manifest", manifestPath, "--max-mb", "1"])).stdout);
    assert.equal(checked.ok, true, checked.errors.join("\n"));
    assert.equal(checked.warnings.filter((warning) => /over the attachment budget/.test(warning)).length, 4);

    const failed = await runCli(["finish", "--manifest", manifestPath, "--gif"], toolEnv("fail"));
    assert.equal(failed.status, 1);
    const gif = JSON.parse(failed.stdout).outputs.gif;
    assert.equal(gif.status, "failed");
    assert.ok(gif.reason.length <= 400 && gif.reason.endsWith("encoder rejected [redacted]"), gif.reason);
    assertNoSentinel(directory, failed.stdout, failed.stderr);
  });
});

const fixtureApp = () => {
  const homeVisits = [];
  const server = createServer((request, response) => {
    const signedIn = /(?:^|;\s*)session=granted(?:;|$)/.test(request.headers.cookie ?? "");
    const page = (body) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>fixture</title><body style="font:20px sans-serif;padding:24px">${body}</body>`);
    };
    if (request.method === "POST" && request.url === "/login") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const granted = new URLSearchParams(body).get("password") === sentinel;
        response.writeHead(303, { location: granted ? "/welcome" : "/login", ...(granted ? { "set-cookie": "session=granted; Path=/; HttpOnly" } : {}) });
        response.end();
      });
      return;
    }
    if (request.url === "/login") return page(`<form method="post" action="/login"><label>Email <input name="email" type="email"></label><label>Password <input id="password" name="password" type="password"></label><button>Sign in</button></form>`);
    if (request.url === "/welcome") return page("<p>welcome</p>");
    if (request.url === "/") {
      homeVisits.push(signedIn);
      return page(`<h1 id="status">${signedIn ? "signed in" : "signed out"}</h1><button id="toggle" onclick="document.getElementById('state').textContent='on'">Toggle</button> <span id="state">off</span>`);
    }
    response.writeHead(404);
    response.end();
  });
  return { server, homeVisits };
};

const passingScenario = `
export const contextOptions = { locale: "en-US" };
export const login = async ({ page }) => {
  await page.goto("/login");
  await page.fill("#password", process.env.QA_PASSWORD);
  await page.click("button");
  await page.waitForURL("**/welcome");
};
export default async ({ page, step }) => {
  await step("Open home", async () => { await page.goto("/"); }, { caption: "Home page loads" });
  await step("Signed in", async () => {
    const status = await page.textContent("#status");
    if (status !== "signed in") throw new Error("expected signed in, saw " + status);
  }, { caption: "The session carried over from login" });
  const value = await step("Toggle", async () => {
    await page.click("#toggle");
    await page.waitForSelector("#state:text('on')");
    return "toggled";
  }, { caption: "Toggle switches on", sensitive: true });
  if (value !== "toggled") throw new Error("step did not return the function's value");
};
`;

const failingScenario = `
export default async ({ page, step }) => {
  await step("Open home", async () => { await page.goto("/"); });
  await step("Boom", async () => { throw new Error("token " + process.env.QA_PASSWORD + " rejected"); }, { caption: "Fails on purpose" });
  await step("Never", async () => {});
};
`;

describe("qa-video record end to end", async () => {
  const doctor = JSON.parse((await runCli(["doctor"])).stdout);
  const skip = !process.env.QA_VIDEO_PLAYWRIGHT
    ? "set QA_VIDEO_PLAYWRIGHT to a Playwright package to run the recording tests"
    : !doctor.playwright.found
      ? `QA_VIDEO_PLAYWRIGHT does not resolve: ${doctor.hints[0]}`
      : doctor.playwright.browser.launch !== "ok"
        ? `the chromium build for Playwright ${doctor.playwright.version} does not launch (npx playwright install chromium, or point PLAYWRIGHT_BROWSERS_PATH at one)`
        : false;
  const { server, homeVisits } = fixtureApp();
  let baseURL;
  before(async () => {
    await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
    baseURL = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  const recordPassing = async (mode, extra = []) => {
    const out = join(scratch, `e2e-${mode}`);
    const scenario = write(`scenarios/${mode}-flow.mjs`, passingScenario);
    homeVisits.length = 0;
    const result = await runCli(["record", "--scenario", scenario, "--out", out, "--url", baseURL, "--head", "abc1234", "--size", "641x361", "--mode", mode, ...extra]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const summary = JSON.parse(result.stdout);
    const name = `${mode}-flow`;
    assert.deepEqual(summary, { manifest: join(out, `${name}.manifest.json`), video: join(out, `${name}.webm`), steps: 3, passed: 3, failed: 0 });
    const manifest = JSON.parse(readFileSync(summary.manifest, "utf8"));
    assert.deepEqual(Object.keys(manifest), manifestKeys);
    assert.equal(manifest.mode, mode);
    assert.equal(manifest.target, baseURL);
    assert.deepEqual(manifest.size, { width: 641, height: 361 });
    assert.ok(startsWith(summary.video, webmMagic), "the video is not WebM");
    assert.deepEqual(manifest.outputs.webm, { path: `${name}.webm`, bytes: statSync(summary.video).size, status: "produced" });
    assert.deepEqual(manifest.steps.map((step) => step.name), ["open-home", "signed-in", "toggle"]);
    assert.equal(manifest.steps[2].sensitive, true);
    let previous = 0;
    for (const step of manifest.steps) {
      assert.deepEqual(Object.keys(step), stepKeys);
      assert.equal(step.result, "pass");
      assert.ok(step.start >= previous && step.start <= step.end && step.end <= manifest.duration, JSON.stringify(step));
      previous = step.start;
      assert.ok(startsWith(join(out, step.screenshot), pngMagic), step.screenshot);
    }
    assert.ok(homeVisits.length > 0 && homeVisits.every(Boolean), "the recorded context did not carry the login cookie");
    assert.deepEqual(readdirSync(out).sort(), [`${name}-open-home.png`, `${name}-signed-in.png`, `${name}-toggle.png`, `${name}.manifest.json`, `${name}.webm`]);
    assertNoSentinel(out, result.stdout, result.stderr);
    return { out, manifest, summary };
  };

  test("context mode records a webm, a PNG per step, and the manifest", { skip, timeout: 120000 }, async () => {
    const { summary, out } = await recordPassing("context");
    const finished = await runCli(["finish", "--manifest", summary.manifest, "--mp4"], { PATH: dirname(process.execPath), FFMPEG_PATH: "" });
    assert.equal(finished.status, 0, finished.stderr);
    assert.equal(JSON.parse(finished.stdout).outputs.mp4.status, "skipped");
    const checked = await runCli(["check", "--manifest", summary.manifest]);
    assert.equal(checked.status, 0, checked.stdout);
    const corrupted = join(out, "corrupted.manifest.json");
    copyFileSync(summary.manifest, corrupted);
    writeFileSync(join(out, "context-flow-copy.webm"), "not a video");
    const broken = JSON.parse(readFileSync(corrupted, "utf8"));
    writeFileSync(corrupted, JSON.stringify({ ...broken, video: "context-flow-copy.webm", steps: [...broken.steps, broken.steps[0]] }));
    const failedCheck = await runCli(["check", "--manifest", corrupted]);
    assert.equal(failedCheck.status, 1);
    const { errors } = JSON.parse(failedCheck.stdout);
    assert.ok(errors.includes("video context-flow-copy.webm is not a WebM file"), errors.join("\n"));
    assert.ok(errors.includes("duplicate step name open-home"), errors.join("\n"));
    assertNoSentinel(out, finished.stdout, checked.stdout);
  });

  test("screencast mode records with actions and a title card", { skip: skip || (!doctor.playwright.screencast && "this Playwright has no page.screencast"), timeout: 120000 }, async () => {
    const { manifest } = await recordPassing("screencast", ["--actions", "--title-card"]);
    assert.deepEqual(manifest.warnings, []);
    assert.ok(manifest.steps[0].start >= 1.6, "the title card did not precede the first step");
  });

  test("a failing step exits 1 and still writes the video, screenshot, and manifest", { skip, timeout: 120000 }, async () => {
    const out = join(scratch, "e2e-failing");
    const result = await runCli(["record", "--scenario", write("scenarios/failing.mjs", failingScenario), "--out", out, "--url", baseURL, "--mode", "context"]);
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { manifest: join(out, "failing.manifest.json"), video: join(out, "failing.webm"), steps: 2, passed: 1, failed: 1 });
    const manifest = JSON.parse(readFileSync(join(out, "failing.manifest.json"), "utf8"));
    assert.deepEqual(manifest.steps.map((step) => [step.name, step.result]), [["open-home", "pass"], ["boom", "fail"]]);
    assert.equal(manifest.steps[1].error.split("\n")[0], "token [redacted] rejected");
    assert.ok(startsWith(join(out, "failing-boom.png"), pngMagic));
    assert.ok(startsWith(join(out, "failing.webm"), webmMagic));
    const checked = JSON.parse((await runCli(["check", "--manifest", join(out, "failing.manifest.json")])).stdout);
    assert.deepEqual({ ok: checked.ok, failed: checked.failed, warnings: checked.warnings }, { ok: true, failed: 1, warnings: ["1 step failed"] });
    assertNoSentinel(out, result.stdout, result.stderr);
  });
});
