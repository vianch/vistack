import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after } from "node:test";
import { fileURLToPath } from "node:url";

export const script = join(dirname(fileURLToPath(import.meta.url)), "qa-video.mjs");
export const sentinel = "sentinel-7f3a9c";
export const webmMagic = [0x1a, 0x45, 0xdf, 0xa3];
export const pngMagic = [0x89, 0x50, 0x4e, 0x47];
export const noTools = { PATH: dirname(process.execPath), FFMPEG_PATH: "", QA_VIDEO_TOOL_DIRS: "" };
export const isolated = { ...noTools, NODE_PATH: "", QA_VIDEO_GLOBAL_MODULES: "", QA_VIDEO_PLAYWRIGHT: "", PLAYWRIGHT_BROWSERS_PATH: "" };

export const makeScratch = (prefix = "qa-video-test-") => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

export const cliRunner = (cwd) => (args, extraEnv = {}, options = {}) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: options.cwd ?? cwd, env: { ...process.env, QA_PASSWORD: sentinel, ...extraEnv } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => done({ status, stdout, stderr }));
  });

export const writer = (root) => (name, content, mode) => {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, mode ? { mode } : undefined);
  return path;
};

export const startsWith = (path, bytes) => bytes.every((byte, index) => readFileSync(path)[index] === byte);

const allFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? allFiles(join(directory, entry.name)) : [join(directory, entry.name)]));

export const assertNoSentinel = (directory, ...texts) => {
  for (const text of texts) assert.ok(!text.includes(sentinel), "the sentinel leaked into process output");
  for (const file of allFiles(directory)) assert.ok(!readFileSync(file, "latin1").includes(sentinel), `the sentinel leaked into ${file}`);
};

export const syntheticEvidence = (root, folder, { duration = 2, webmBytes = 0 } = {}) => {
  const directory = join(root, folder);
  mkdirSync(directory, { recursive: true });
  const webm = Buffer.concat([Buffer.from([...webmMagic, 0, 0, 0, 0]), Buffer.alloc(webmBytes)]);
  writeFileSync(join(directory, "demo.webm"), webm);
  writeFileSync(join(directory, "demo-one.png"), Buffer.from([...pngMagic, 0x0d, 0x0a, 0x1a, 0x0a]));
  writeFileSync(join(directory, "demo-two.png"), Buffer.from([...pngMagic, 0x0d, 0x0a, 0x1a, 0x0a]));
  const manifest = {
    version: 1, scenario: "demo", target: null, head: null, recorded_at: "2026-10-02T00:00:00.000Z", mode: "context", browser: "chromium", playwright: "1.0.0",
    size: { width: 640, height: 360 }, duration, video: "demo.webm",
    steps: [
      { name: "one", caption: "50% done", start: 0.25, end: 1.5, result: "pass", screenshot: "demo-one.png", error: null, sensitive: false },
      { name: "two", caption: "@home", start: 1.5, end: 1.9, result: "fail", screenshot: "demo-two.png", error: "nope", sensitive: false },
    ],
    outputs: { webm: { path: "demo.webm", bytes: webm.length, status: "produced" } }, warnings: [],
  };
  const manifestPath = join(directory, "demo.manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { directory, manifestPath };
};

export const fakeTool = `#!/usr/bin/env node
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

export const brokenTool = "#!/bin/sh\necho \"dyld: Library not loaded: libx265.so\" >&2\necho \"second line\" >&2\nexit 1\n";

const stubPlaywrightIndex = `const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const mode = () => process.env.STUB_RECORDER || "ok";
const browserType = {
  executablePath: () => process.env.STUB_EXECUTABLE || "/nonexistent/chromium",
  launch: async () => {
    if (mode() === "nolaunch") throw new Error("browserType.launch: Executable doesn't exist at /stub/chromium_headless_shell-9999/chrome\\n=== logs ===");
    return {
      close: async () => {},
      newContext: async ({ recordVideo } = {}) => {
        if (mode() === "noffmpeg") throw new Error("browser.newContext: Executable doesn't exist at /stub/ffmpeg-1009/ffmpeg-mac");
        const file = join(recordVideo.dir, "probe.webm");
        return {
          newPage: async () => ({ goto: async () => {}, video: () => ({ path: async () => file }) }),
          close: async () => {
            if (mode() === "novideo") return;
            mkdirSync(recordVideo.dir, { recursive: true });
            writeFileSync(file, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
          },
        };
      },
    };
  },
};
module.exports = { chromium: browserType, firefox: browserType, webkit: browserType };
`;

export const stubPlaywright = (modulesDir, { name = "playwright", version = "9.9.9", revisions = { chromium: "9999", "chromium-headless-shell": "9999", ffmpeg: "1009" }, core = true } = {}) => {
  const make = writer(modulesDir);
  make(`${name}/package.json`, JSON.stringify({ name, version, main: "index.js", dependencies: core ? { "playwright-core": version } : {} }));
  make(`${name}/index.js`, stubPlaywrightIndex);
  make(`${name}/cli.js`, "");
  if (core) {
    const browsers = Object.entries(revisions).map(([browser, revision]) => ({ name: browser, revision, installByDefault: true }));
    make(`${name}/node_modules/playwright-core/package.json`, JSON.stringify({ name: "playwright-core", version, main: "index.js" }));
    make(`${name}/node_modules/playwright-core/browsers.json`, JSON.stringify({ browsers }));
  }
  return join(modulesDir, name);
};

export const fakeCache = (cache, directories) => {
  for (const directory of directories) writer(cache)(`${directory}/INSTALLATION_COMPLETE`, "");
  return cache;
};
