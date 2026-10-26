// One-time-password handoff and saved browser sessions for qa-video.mjs login and record.
// The script writes otp-request.json, the asker writes otp.txt, the script reads and deletes it. Nothing here imports Playwright.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { redact } from "./media.mjs";

export const otpTimeoutExit = 3;

const message = (error) => String(error?.message ?? error).replace(/\x1b\[[0-9;]*m/g, "");

// exitCode tells qa-video.mjs to exit with it and print the message without a stack.
export class SessionError extends Error {
  exitCode = 2;
}

export class OtpTimeout extends Error {
  exitCode = otpTimeoutExit;
}

export const pathsFor = (dir) => ({ request: join(dir, "otp-request.json"), answer: join(dir, "otp.txt"), storageState: join(dir, "auth.json") });

export const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

// A temp file renamed over the target: readers never see half a file, and the mode is the temp's even when the target existed.
const writeAtomic = (path, text, mode = 0o666) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { mode });
  renameSync(temporary, path);
};

export const writeOtpRequest = (dir, request) => writeAtomic(pathsFor(dir).request, `${JSON.stringify(request, null, 2)}\n`);

export const writeOtpAnswer = (dir, code) => writeAtomic(pathsFor(dir).answer, `${code}\n`, 0o600);

// An empty file is an answer still being written, so it reads as no answer yet.
const readAnswer = (path) => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
};

// Values added with .add() join the credential-named variables that redact() already scrubs.
// Pass a copy of process.env: a key added to process.env itself would reach every child process.
export const runtimeRedactor = (env) => {
  const scrub = (text) => redact(text, env);
  scrub.add = (value) => {
    if (value) env[`QA_VIDEO_RUNTIME_SECRET_${Object.keys(env).length}`] = value;
  };
  return scrub;
};

export const makeOtpHelper = ({
  dir, target, timeoutSeconds = 300, redact: scrub = runtimeRedactor({}), pollMs = 1000, now = Date.now, sleep = delay,
  log = (line) => process.stderr.write(`${line}\n`),
}) => {
  const paths = pathsFor(dir);
  const origin = originOf(target);
  const stamp = () => new Date(now()).toISOString();
  const otp = async ({ hint } = {}) => {
    const request = { target: origin, hint: scrub(String(hint ?? "")), requestedAt: stamp(), timeoutSeconds };
    // A code left from an earlier login would otherwise be read as this login's answer.
    rmSync(paths.answer, { force: true });
    writeOtpRequest(dir, request);
    log(`OTP needed for ${origin ?? "the target"}: write the code to ${paths.answer} (waiting up to ${timeoutSeconds} s)`);
    const deadline = now() + timeoutSeconds * 1000;
    for (;;) {
      const code = readAnswer(paths.answer);
      if (code) {
        rmSync(paths.answer, { force: true });
        scrub.add(code);
        writeOtpRequest(dir, { ...request, answeredAt: stamp() });
        return code;
      }
      if (now() >= deadline) break;
      await sleep(Math.max(0, Math.min(pollMs, deadline - now())));
    }
    rmSync(paths.answer, { force: true });
    writeOtpRequest(dir, { ...request, timedOutAt: stamp() });
    otp.timedOut = new OtpTimeout(`no code arrived in ${paths.answer} within ${timeoutSeconds} s`);
    throw otp.timedOut;
  };
  otp.timedOut = null;
  return otp;
};

// The state holds live session cookies: owner-only mode, and never passed through redaction, which would corrupt them.
export const saveStorageState = async (context, path) => {
  const state = await context.storageState();
  writeAtomic(path, JSON.stringify(state), 0o600);
  return state;
};

export const readStorageState = (path) => {
  if (!path || !existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new SessionError(`cannot read storage state ${path}: ${message(error)}`);
  }
};

// Runs the scenario's login in its own context, which is never recorded, and returns its storage state.
export const runLogin = async ({ browser, contextOptions, login, baseURL, otp, savePath }) => {
  const context = await browser.newContext(contextOptions);
  try {
    await login({ page: await context.newPage(), baseURL, context, otp });
    return savePath ? await saveStorageState(context, savePath) : await context.storageState();
  } catch (error) {
    // A login that catches the timeout and throws its own error still exits as a timeout.
    throw otp.timedOut ?? new SessionError(`login failed: ${message(error)}`);
  } finally {
    await context.close().catch(() => {});
  }
};
