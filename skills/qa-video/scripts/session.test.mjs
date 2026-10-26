import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { after, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  OtpTimeout, SessionError, makeOtpHelper, otpTimeoutExit, pathsFor, readStorageState, runLogin, runtimeRedactor, saveStorageState, writeOtpAnswer,
} from "./session.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "qa-video.mjs");
const scratch = mkdtempSync(join(tmpdir(), "qa-video-session-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const sentinel = "sentinel-7f3a9c";
const code = "731942";
const posix = process.platform !== "win32";
const modeOf = (path) => statSync(path).mode & 0o777;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const fresh = (name) => {
  const directory = join(scratch, name);
  mkdirSync(directory, { recursive: true });
  return directory;
};

// A fake clock: each sleep advances time instead of waiting, and onSleep plays the asker.
const helperFor = (dir, { onSleep = () => {}, timeoutSeconds = 5, redact } = {}) => {
  let time = Date.parse("2026-10-26T12:00:00.000Z");
  const lines = [];
  const sleeps = [];
  const otp = makeOtpHelper({
    dir, target: "https://qa.example.com/account?token=abc", timeoutSeconds, ...(redact ? { redact } : {}), pollMs: 1000,
    now: () => time, sleep: async (ms) => { sleeps.push(ms); time += ms; onSleep(sleeps.length); }, log: (line) => lines.push(line),
  });
  return { otp, lines, sleeps };
};

describe("otp helper", () => {
  test("pathsFor names the request, the answer, and the default storage state", () => {
    assert.deepEqual(pathsFor("/lane"), { request: join("/lane", "otp-request.json"), answer: join("/lane", "otp.txt"), storageState: join("/lane", "auth.json") });
  });

  test("writes the request, returns the code from otp.txt, deletes it, and redacts it", async () => {
    const dir = fresh("answered");
    const paths = pathsFor(dir);
    writeFileSync(paths.answer, "000000\n");
    const redact = runtimeRedactor({ QA_PASSWORD: sentinel });
    let seen;
    const { otp, lines, sleeps } = helperFor(dir, {
      redact,
      onSleep: (count) => {
        if (count === 1) {
          seen = readJson(paths.request);
          writeFileSync(paths.answer, "");
        }
        if (count === 2) writeOtpAnswer(dir, `${code} \t\n`);
      },
    });
    const value = await otp({ hint: `the code sent to the account's email, not ${sentinel}` });
    assert.equal(value, code, "trailing whitespace is trimmed and the stale 000000 was not read");
    assert.deepEqual(Object.keys(seen), ["target", "hint", "requestedAt", "timeoutSeconds"]);
    assert.deepEqual(seen, { target: "https://qa.example.com", hint: "the code sent to the account's email, not [redacted]", requestedAt: "2026-10-26T12:00:00.000Z", timeoutSeconds: 5 });
    assert.deepEqual(sleeps, [1000, 1000], "an empty otp.txt reads as not written yet");
    assert.ok(!existsSync(paths.answer), "otp.txt is deleted once read");
    assert.deepEqual(readJson(paths.request), { ...seen, answeredAt: "2026-10-26T12:00:02.000Z" });
    assert.deepEqual(lines, [`OTP needed for https://qa.example.com: write the code to ${paths.answer} (waiting up to 5 s)`]);
    assert.equal(redact(`code ${code} and ${sentinel} rejected`), "code [redacted] and [redacted] rejected");
    assert.equal(otp.timedOut, null);
  });

  test("a timeout writes timedOutAt, leaves no otp.txt, and rejects with the OTP exit code", async () => {
    const dir = fresh("timeout");
    const { otp, sleeps } = helperFor(dir, { timeoutSeconds: 2.5, onSleep: () => writeFileSync(pathsFor(dir).answer, "  \n") });
    await assert.rejects(otp(), (error) => error instanceof OtpTimeout && error.exitCode === otpTimeoutExit && /within 2\.5 s/.test(error.message));
    assert.equal(otpTimeoutExit, 3);
    assert.deepEqual(sleeps, [1000, 1000, 500]);
    assert.ok(!existsSync(pathsFor(dir).answer));
    const request = readJson(pathsFor(dir).request);
    assert.deepEqual(Object.keys(request), ["target", "hint", "requestedAt", "timeoutSeconds", "timedOutAt"]);
    assert.equal(request.timedOutAt, "2026-10-26T12:00:02.500Z");
    assert.ok(otp.timedOut instanceof OtpTimeout);
  });

  test("an unparseable target writes null and the line still names the file", async () => {
    const dir = fresh("no-target");
    const lines = [];
    const otp = makeOtpHelper({ dir, target: undefined, timeoutSeconds: 1, sleep: async () => writeOtpAnswer(dir, code), log: (line) => lines.push(line) });
    assert.equal(await otp(), code);
    assert.equal(readJson(pathsFor(dir).request).target, null);
    assert.match(lines[0], /^OTP needed for the target: write the code to .*otp\.txt \(waiting up to 1 s\)$/);
  });
});

describe("storage state", () => {
  const state = { cookies: [{ name: "session", value: sentinel }], origins: [] };
  const fakeContext = (closed = []) => ({ storageState: async () => state, newPage: async () => ({}), close: async () => { closed.push(true); } });

  test("saveStorageState writes 0600, creates parents, and narrows an existing file", { skip: !posix && "POSIX modes" }, async () => {
    const path = join(scratch, "state", "deep", "auth.json");
    assert.deepEqual(await saveStorageState(fakeContext(), path), state);
    assert.equal(modeOf(path), 0o600);
    assert.deepEqual(readStorageState(path), state, "the state is saved unredacted");
    writeFileSync(path, "{}", { mode: 0o644 });
    await saveStorageState(fakeContext(), path);
    assert.equal(modeOf(path), 0o600);
  });

  test("readStorageState returns undefined for a missing path and throws on a corrupt file", () => {
    assert.equal(readStorageState(join(scratch, "missing.json")), undefined);
    assert.equal(readStorageState(undefined), undefined);
    const corrupt = join(scratch, "corrupt.json");
    writeFileSync(corrupt, "{not json");
    assert.throws(() => readStorageState(corrupt), (error) => error instanceof SessionError && error.exitCode === 2);
  });

  test("runLogin closes its context and reports a failed login, or the timeout the login swallowed", async () => {
    const closed = [];
    const browser = { newContext: async () => fakeContext(closed) };
    const otp = Object.assign(async () => code, { timedOut: null });
    const login = async () => { throw new Error("bad password"); };
    await assert.rejects(runLogin({ browser, login, otp }), (error) => error instanceof SessionError && error.message === "login failed: bad password");
    otp.timedOut = new OtpTimeout("no code");
    await assert.rejects(runLogin({ browser, login, otp }), (error) => error === otp.timedOut);
    const answered = Object.assign(async () => code, { timedOut: null });
    assert.deepEqual(await runLogin({ browser, login: async ({ otp: given }) => assert.equal(given, answered), otp: answered }), state);
    assert.equal(closed.length, 3);
  });
});

const runCli = (args, extraEnv = {}) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: scratch, env: { ...process.env, QA_PASSWORD: sentinel, ...extraEnv } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => done({ status, stdout, stderr }));
  });

const waitFor = async (path) => {
  for (let tries = 0; !existsSync(path); tries += 1) {
    if (tries > 600) throw new Error(`${path} never appeared`);
    await delay(50);
  }
};

const noCode = (out, ...texts) => {
  for (const text of texts) assert.ok(!text.includes(code), "the OTP leaked into process output");
  for (const file of readdirSync(out)) assert.ok(!readFileSync(join(out, file), "latin1").includes(code), `the OTP leaked into ${file}`);
};

// Stands in for Playwright: logs each newContext's options and writes PNG and WebM magic bytes.
const fakePlaywright = `import { appendFileSync, writeFileSync } from "node:fs";
const page = {
  screenshot: async ({ path }) => writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  video: () => ({ saveAs: async (path) => writeFileSync(path, Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) }),
};
const context = { newPage: async () => page, storageState: async () => ({ cookies: [{ name: "session", value: "granted" }], origins: [] }), close: async () => {} };
const browser = { newContext: async (options) => { appendFileSync(process.env.FAKE_LOG, JSON.stringify(options ?? {}) + "\\n"); return context; }, close: async () => {} };
export const chromium = { executablePath: () => "/nowhere", launch: async () => browser };
`;

const loginScenario = `import { writeFileSync } from "node:fs";
export const login = async ({ otp }) => {
  writeFileSync(process.env.LOGIN_MARKER, "ran");
  if (!process.env.LOGIN_OTP) return;
  const code = await otp({ hint: "the code sent to the account's email" });
  if (process.env.LOGIN_OTP === "reject") throw new Error("code " + code + " rejected");
};
export default async ({ step }) => { await step("one", async () => {}); };
`;

describe("login and record --storage-state through the CLI", () => {
  const fake = join(scratch, "fake-playwright");
  mkdirSync(fake, { recursive: true });
  writeFileSync(join(fake, "package.json"), JSON.stringify({ name: "playwright", version: "1.50.0", type: "module", main: "index.js" }));
  writeFileSync(join(fake, "index.js"), fakePlaywright);
  const scenario = join(scratch, "login-flow.mjs");
  writeFileSync(scenario, loginScenario);
  const url = "http://127.0.0.1:9/app?bypass=x";
  const lane = (name) => {
    const out = fresh(name);
    const marker = join(out, "login-ran");
    const log = join(scratch, `${name}.log`);
    writeFileSync(log, "");
    const contexts = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return { out, marker, contexts, env: { QA_VIDEO_PLAYWRIGHT: fake, FAKE_LOG: log, LOGIN_MARKER: marker } };
  };

  test("--help shows the new flags and login requires --url", async () => {
    const help = await runCli(["login", "--help"]);
    assert.equal(help.status, 0);
    for (const flag of ["scenario", "out", "url", "save-storage-state", "otp-timeout", "playwright"]) assert.match(help.stdout, new RegExp(`--${flag}\\b`), flag);
    const record = await runCli(["record", "--help"]);
    for (const flag of ["storage-state", "otp-timeout"]) assert.match(record.stdout, new RegExp(`--${flag}\\b`), flag);
    assert.match((await runCli(["--help"])).stdout, /^  login\s/m);
    const missing = await runCli(["login", "--scenario", scenario, "--out", "x"]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /--url is required/);
    assert.equal((await runCli(["login", "--scenario", scenario, "--out", "x", "--url", url, "--otp-timeout", "0"])).status, 2);
  });

  test("record --storage-state without Playwright fails for Playwright, not for the flag", async () => {
    const result = await runCli(["record", "--scenario", scenario, "--out", fresh("no-playwright"), "--storage-state", join(scratch, "nowhere.json"), "--otp-timeout", "5"], { QA_VIDEO_PLAYWRIGHT: join(scratch, "nowhere") });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /npm i -D playwright && npx playwright install chromium/);
    assert.doesNotMatch(result.stderr, /unknown argument/);
  });

  test("login answers the OTP from otp.txt, saves auth.json 0600, and record --storage-state skips login", async () => {
    const { out, marker, contexts, env } = lane("login-ok");
    const paths = pathsFor(out);
    const running = runCli(["login", "--scenario", scenario, "--out", out, "--url", url, "--otp-timeout", "20"], { ...env, LOGIN_OTP: "accept" });
    await waitFor(paths.request);
    assert.deepEqual(Object.keys(readJson(paths.request)), ["target", "hint", "requestedAt", "timeoutSeconds"]);
    writeOtpAnswer(out, `${code}\n`);
    const result = await running;
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, path: paths.storageState });
    assert.ok(result.stderr.includes(`OTP needed for http://127.0.0.1:9: write the code to ${paths.answer} (waiting up to 20 s)`), result.stderr);
    const request = readJson(paths.request);
    assert.equal(request.target, "http://127.0.0.1:9");
    assert.equal(request.timeoutSeconds, 20);
    assert.ok(request.answeredAt);
    assert.ok(!existsSync(paths.answer));
    if (posix) assert.equal(modeOf(paths.storageState), 0o600);
    assert.deepEqual(readJson(paths.storageState).cookies, [{ name: "session", value: "granted" }]);
    assert.equal(contexts()[0].baseURL, url);
    noCode(out, result.stdout, result.stderr);

    rmSync(marker);
    const recorded = await runCli(["record", "--scenario", scenario, "--out", out, "--url", url, "--storage-state", paths.storageState], env);
    assert.equal(recorded.status, 0, recorded.stderr);
    assert.ok(!existsSync(marker), "record ran login despite --storage-state");
    const recordedContexts = contexts().slice(1);
    assert.ok(recordedContexts.length > 0 && recordedContexts.every((options) => options.storageState?.cookies?.[0]?.value === "granted"));
    assert.deepEqual(readJson(join(out, "login-flow.manifest.json")).warnings, []);
  });

  test("record falls back to login when --storage-state is missing, and says so", async () => {
    const { out, marker, env } = lane("fallback");
    const result = await runCli(["record", "--scenario", scenario, "--out", out, "--storage-state", join(out, "auth.json")], env);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(marker));
    assert.ok(!existsSync(join(out, "auth.json")), "record writes no storage state");
    assert.deepEqual(readJson(join(out, "login-flow.manifest.json")).warnings, [`storage state ${join(out, "auth.json")} not found; ran login`]);
  });

  test("a login that throws exits 2 with the OTP redacted; no answer exits 3 from login and record", async () => {
    const { out, env } = lane("login-reject");
    const running = runCli(["login", "--scenario", scenario, "--out", out, "--url", url], { ...env, LOGIN_OTP: "reject" });
    await waitFor(pathsFor(out).request);
    writeOtpAnswer(out, code);
    const rejected = await running;
    assert.equal(rejected.status, 2);
    assert.equal(JSON.parse(rejected.stdout).error, "login failed: code [redacted] rejected");
    assert.ok(!existsSync(pathsFor(out).storageState));
    noCode(out, rejected.stdout, rejected.stderr);

    const quiet = lane("login-timeout");
    const timedOut = await runCli(["login", "--scenario", scenario, "--out", quiet.out, "--url", url, "--otp-timeout", "1"], { ...quiet.env, LOGIN_OTP: "accept" });
    assert.equal(timedOut.status, otpTimeoutExit, timedOut.stderr);
    assert.match(JSON.parse(timedOut.stdout).error, /no code arrived in .*otp\.txt within 1 s/);
    assert.ok(readJson(pathsFor(quiet.out).request).timedOutAt);
    assert.ok(!existsSync(pathsFor(quiet.out).answer));
    assert.ok(!existsSync(pathsFor(quiet.out).storageState));

    const recording = lane("record-timeout");
    const recordTimedOut = await runCli(["record", "--scenario", scenario, "--out", recording.out, "--url", url, "--otp-timeout", "1"], { ...recording.env, LOGIN_OTP: "accept" });
    assert.equal(recordTimedOut.status, otpTimeoutExit, recordTimedOut.stderr);
    assert.ok(readJson(pathsFor(recording.out).request).timedOutAt);
  });
});

// Password at /login, then the one-time code at /login/verify, as the example login expects.
const otpApp = () => createServer((request, response) => {
  const page = (body) => response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>otp</title><body>${body}</body>`);
  const go = (location, cookie) => response.writeHead(303, { location, ...(cookie ? { "set-cookie": `${cookie}; Path=/` } : {}) }).end();
  if (request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const form = new URLSearchParams(body);
      if (request.url === "/login") return go(form.get("password") === sentinel ? "/login/verify" : "/login");
      return form.get("code") === code ? go("/welcome", "session=granted") : go("/login/verify");
    });
    return;
  }
  if (request.url === "/login") return page(`<form method="post" action="/login"><label>Email <input name="email"></label><label>Password <input name="password" type="password"></label><button>Sign in</button></form>`);
  if (request.url === "/login/verify") return page(`<form method="post" action="/login/verify"><label>One-time code <input name="code"></label><button>Verify</button></form>`);
  return page(`<h1>${/session=granted/.test(request.headers.cookie ?? "") ? "signed in" : "signed out"}</h1>`);
});

describe("the example login in a real browser", async () => {
  const doctor = process.env.QA_VIDEO_PLAYWRIGHT ? JSON.parse((await runCli(["doctor"])).stdout) : null;
  const skip = !doctor ? "set QA_VIDEO_PLAYWRIGHT to a Playwright package to run the recording tests"
    : doctor.playwright.browser.launch !== "ok" && `chromium does not launch: ${doctor.hints[0]}`;

  test("login takes the OTP from otp.txt, then record --storage-state records signed in", { skip, timeout: 120000 }, async () => {
    const server = otpApp();
    await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
    try {
      const baseURL = `http://127.0.0.1:${server.address().port}`;
      const out = fresh("browser");
      const example = pathToFileURL(join(here, "..", "assets", "scenario.example.mjs")).href;
      const scenario = join(scratch, "browser-flow.mjs");
      writeFileSync(scenario, `export { contextOptions, login } from ${JSON.stringify(example)};
export default async ({ page, step }) => {
  await step("home", async () => {
    await page.goto("/");
    const status = await page.textContent("h1");
    if (status !== "signed in") throw new Error("saw " + status);
  });
};
`);
      const paths = pathsFor(out);
      const running = runCli(["login", "--scenario", scenario, "--out", out, "--url", baseURL]);
      await waitFor(paths.request);
      assert.equal(readJson(paths.request).hint, "the code sent to the account's email");
      writeOtpAnswer(out, code);
      const loggedIn = await running;
      assert.equal(loggedIn.status, 0, loggedIn.stderr);
      if (posix) assert.equal(modeOf(paths.storageState), 0o600);
      // A login that ran again would wait for a code nobody writes and exit 3.
      const recorded = await runCli(["record", "--scenario", scenario, "--out", out, "--url", baseURL, "--mode", "context", "--storage-state", paths.storageState, "--otp-timeout", "5"]);
      assert.equal(recorded.status, 0, `${recorded.stdout}\n${recorded.stderr}`);
      assert.deepEqual(readJson(join(out, "browser-flow.manifest.json")).steps.map((step) => step.result), ["pass"]);
      noCode(out, loggedIn.stdout, loggedIn.stderr, recorded.stdout, recorded.stderr);
    } finally {
      server.close();
    }
  });
});
