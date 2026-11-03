#!/usr/bin/env node
// Records QA screen evidence with Playwright, then derives captions, mp4, gif, a slideshow, and a contact sheet.
// stdout carries one JSON document (or help text); diagnostics go to stderr. Exit 0 ok, 1 evidence failure, 2 usage or setup error, 3 no OTP before --otp-timeout.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { doctorReport } from "./doctor.mjs";
import { bytesOf, check, finish, writeJsonAtomic } from "./evidence.mjs";
import { UsageError, clip, errorText, formatCommands, formatUsage, parseArgs, parseSize, publicUrl, redact, redactDeep, slugify } from "./media.mjs";
import { installHint, resolvePlaywright } from "./resolve.mjs";
import { makeOtpHelper, pathsFor, readStorageState, runLogin, runtimeRedactor } from "./session.mjs";

const program = "qa-video.mjs";
const browsers = ["chromium", "firefox", "webkit"];
// A copy, so an OTP added to the redaction set never reaches a child process.
const env = { ...process.env };

class SetupError extends Error {}
class StepFailed extends Error {}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const emit = (value) => process.stdout.write(`${JSON.stringify(redactDeep(value, env), null, 2)}\n`);
const say = (text) => process.stderr.write(`qa-video: ${redact(text, env)}\n`);
const io = { env, emit };

const doctor = async (options) => {
  const report = await doctorReport(options, env);
  emit(report);
  return report.ok ? 0 : 1;
};

const recordedHead = (path) => {
  try {
    const head = JSON.parse(readFileSync(path, "utf8"))?.head;
    return typeof head === "string" && head ? head : null;
  } catch {
    return null;
  }
};

const sameHead = (left, right) => left.startsWith(right) || right.startsWith(left);

const loadScenario = async (options) => {
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(options.url ?? "")) throw new UsageError("--url must not carry credentials; read them from process.env in the scenario");
  const scenarioPath = resolve(options.scenario);
  if (!existsSync(scenarioPath)) throw new SetupError(`scenario not found: ${options.scenario}`);
  let scenario;
  try {
    scenario = await import(pathToFileURL(scenarioPath).href);
  } catch (error) {
    throw new SetupError(`cannot load scenario ${options.scenario}: ${errorText(error)}`);
  }
  if (scenario.login !== undefined && typeof scenario.login !== "function") throw new SetupError("the scenario login export is not a function");
  if (scenario.contextOptions !== undefined && !isObject(scenario.contextOptions)) throw new SetupError("the scenario contextOptions export is not an object");
  return { scenario, scenarioPath, shared: { ...(scenario.contextOptions ?? {}), ...(options.url ? { baseURL: options.url } : {}) } };
};

const otpFor = (options, dir) => makeOtpHelper({ dir, target: options.url, timeoutSeconds: options.otpTimeout, redact: runtimeRedactor(env) });

const login = async (options) => {
  const { scenario, shared } = await loadScenario(options);
  if (!scenario.login) throw new SetupError("the scenario has no login export");
  const out = resolve(options.out);
  const savePath = resolve(options.saveStorageState ?? pathsFor(out).storageState);
  const playwright = await resolvePlaywright(options.playwright, { env });
  if (!playwright.found) throw new SetupError(`Playwright ${playwright.reason}. Install: ${installHint}`);
  mkdirSync(out, { recursive: true });
  let browser;
  try {
    browser = await playwright.api.chromium.launch({ headless: true });
    await runLogin({ browser, contextOptions: shared, login: scenario.login, baseURL: options.url, otp: otpFor(options, out), savePath });
  } catch (error) {
    throw error?.exitCode ? error : new SetupError(`cannot start chromium: ${errorText(error)}`);
  } finally {
    await browser?.close().catch(() => {});
  }
  emit({ ok: true, path: savePath });
  return 0;
};

const record = async (options) => {
  const size = parseSize(options.size);
  const { scenario, scenarioPath, shared } = await loadScenario(options);
  const name = slugify(options.name ?? basename(scenarioPath, extname(scenarioPath)));
  if (!name) throw new SetupError("the scenario name slugifies to nothing; pass --name");
  if (typeof scenario.default !== "function") throw new SetupError("the scenario module has no default export function");
  let storageState = readStorageState(options.storageState && resolve(options.storageState));
  const out = resolve(options.out);
  const files = { video: join(out, `${name}.webm`), manifest: join(out, `${name}.manifest.json`), tmp: join(out, `.video-tmp-${name}`) };
  const priorHead = recordedHead(files.manifest);
  if (priorHead && options.head && !sameHead(priorHead, options.head)) {
    throw new SetupError(`${files.manifest} is evidence for head ${priorHead}; record head ${options.head} into its own directory, <state-root>/qa/<slug>/<slice-or-pr>/<head7>/`);
  }
  const playwright = await resolvePlaywright(options.playwright, { env });
  if (!playwright.found) throw new SetupError(`Playwright ${playwright.reason}. Install: ${installHint}`);
  const browserType = playwright.api[options.browser];
  if (!browserType) throw new SetupError(`Playwright ${playwright.version} has no ${options.browser} browser type`);

  mkdirSync(out, { recursive: true });
  rmSync(files.video, { force: true });
  const baseURL = options.url ?? null;
  const session = { mode: null, t0: 0, startedAt: null, steps: [], warnings: [], stopped: false, scenarioError: false, actions: false, overlays: false };
  if (options.storageState && !storageState) session.warnings.push(`storage state ${options.storageState} not found${scenario.login ? "; ran login" : ""}`);
  const elapsed = () => Number(((performance.now() - session.t0) / 1000).toFixed(3));
  const attempt = async (label, action) => {
    try {
      await action();
      return true;
    } catch (error) {
      session.warnings.push(`${label}: ${clip(redact(errorText(error), env), 500)}`);
      return false;
    }
  };
  let browser;
  let context;
  let page;
  const openRecorded = async (recordVideo) => {
    context = await browser.newContext({ ...shared, viewport: size, ...(storageState ? { storageState } : {}), ...(recordVideo ? { recordVideo: { dir: files.tmp, size } } : {}) });
    page = await context.newPage();
  };
  try {
    browser = await browserType.launch({ headless: !options.headed });
    if (scenario.login && !storageState) storageState = await runLogin({ browser, contextOptions: shared, login: scenario.login, baseURL, otp: otpFor(options, out) });
    if (options.mode !== "context") {
      await openRecorded(false);
      if (typeof page.screencast?.start === "function") {
        try {
          await page.screencast.start({ path: files.video, size });
          session.mode = "screencast";
        } catch (error) {
          if (options.mode === "screencast") throw new SetupError(`page.screencast.start failed: ${errorText(error)}`);
          session.warnings.push(`page.screencast.start failed, recorded with recordVideo instead: ${clip(errorText(error), 300)}`);
        }
      } else if (options.mode === "screencast") {
        throw new SetupError(`Playwright ${playwright.version} has no page.screencast (added in 1.59); use --mode context`);
      }
      if (!session.mode) await context.close();
    }
    if (!session.mode) {
      await openRecorded(true);
      session.mode = "context";
    }
    session.t0 = performance.now();
    session.startedAt = new Date().toISOString();
  } catch (error) {
    await browser?.close().catch(() => {});
    rmSync(files.tmp, { recursive: true, force: true });
    throw error instanceof SetupError || error?.exitCode ? error : new SetupError(`cannot start ${options.browser}: ${errorText(error)}`);
  }

  const step = async (stepName, action, { caption, sensitive = false } = {}) => {
    if (session.stopped) throw new StepFailed("a previous step failed");
    const slug = slugify(stepName) || `step-${session.steps.length + 1}`;
    if (session.steps.some((recorded) => recorded.name === slug)) throw new Error(`duplicate step name ${slug}`);
    if (typeof action !== "function") throw new Error(`step ${slug} has no function`);
    const start = elapsed();
    const quiet = sensitive && session.actions;
    if (quiet) await attempt(`step ${slug}: hideActions`, () => page.screencast.hideActions());
    let value;
    let error = null;
    try {
      value = await action();
    } catch (caught) {
      error = clip(redact(errorText(caught), env), 500);
    }
    let screenshot = `${name}-${slug}.png`;
    // hideOverlays leaves the action cursor in place, so actions are hidden separately for the PNG.
    if (session.overlays) await attempt(`step ${slug}: hideOverlays`, () => page.screencast.hideOverlays?.());
    if (session.actions && !quiet) await attempt(`step ${slug}: hideActions`, () => page.screencast.hideActions());
    if (!(await attempt(`step ${slug}: screenshot`, () => page.screenshot({ path: join(out, screenshot) })))) screenshot = null;
    if (session.overlays) await attempt(`step ${slug}: showOverlays`, () => page.screencast.showOverlays?.());
    if (session.actions) await attempt(`step ${slug}: showActions`, () => page.screencast.showActions({ position: "top-right" }));
    const end = elapsed();
    session.steps.push({ name: slug, caption: String(caption ?? stepName), start, end, result: error ? "fail" : "pass", screenshot, error, sensitive: Boolean(sensitive) });
    if (error) {
      session.stopped = true;
      throw new StepFailed(error);
    }
    return value;
  };

  let duration = 0;
  try {
    if (options.actions || options.titleCard) {
      if (session.mode !== "screencast") session.warnings.push("--actions and --title-card need screencast mode (Playwright 1.59+); recorded without them");
      else {
        if (options.actions) session.actions = await attempt("showActions", () => page.screencast.showActions({ position: "top-right" }));
        if (options.titleCard) {
          const description = [options.head, publicUrl(baseURL)].filter(Boolean).join(" · ");
          const shownAt = performance.now();
          // Newer Playwright resolves showChapter after the card fades, so only the remainder of 1600 ms is waited out.
          if (await attempt("showChapter", () => page.screencast.showChapter(name, { description, duration: 1500 }))) await sleep(Math.max(0, 1600 - (performance.now() - shownAt)));
        }
        session.overlays = true;
      }
    }
    await scenario.default({ page, step, baseURL, context });
  } catch (error) {
    if (!(error instanceof StepFailed)) {
      session.scenarioError = true;
      session.warnings.push(`scenario error outside a step: ${clip(redact(errorText(error), env), 500)}`);
    }
  } finally {
    duration = elapsed();
    if (session.mode === "screencast") await attempt("screencast.stop", () => page.screencast.stop());
    await attempt("context.close", () => context.close());
    if (session.mode === "context") await attempt("video.saveAs", () => page.video().saveAs(files.video));
    rmSync(files.tmp, { recursive: true, force: true });
    await browser.close().catch(() => {});
  }

  const videoBytes = bytesOf(files.video);
  if (session.steps.length === 0) session.warnings.push("the scenario recorded no steps");
  const manifest = {
    version: 1, scenario: name, target: publicUrl(baseURL), head: options.head ?? null, recorded_at: session.startedAt, mode: session.mode,
    browser: options.browser, playwright: playwright.version, size, duration, video: `${name}.webm`, steps: session.steps,
    outputs: { webm: videoBytes > 0 ? { path: `${name}.webm`, bytes: videoBytes, status: "produced" } : { path: `${name}.webm`, bytes: 0, status: "failed", reason: "the recorder wrote no video" } },
    warnings: session.warnings,
  };
  writeJsonAtomic(files.manifest, manifest, env);
  const failed = session.steps.filter((recorded) => recorded.result === "fail").length;
  emit({ manifest: files.manifest, video: videoBytes > 0 ? files.video : null, steps: session.steps.length, passed: session.steps.length - failed, failed });
  return failed || session.scenarioError || session.steps.length === 0 || videoBytes === 0 ? 1 : 0;
};

const path = (describe) => ({ type: "string", placeholder: "path", describe });
const playwrightFlag = path("Playwright module path or package directory (else QA_VIDEO_PLAYWRIGHT, else node_modules from the cwd up, NODE_PATH, and global installs)");
const ffmpegFlag = path("ffmpeg binary (else FFMPEG_PATH, else ffmpeg on PATH or in QA_VIDEO_TOOL_DIRS)");
const magickFlag = path("ImageMagick magick or montage binary (else magick, then montage, on PATH or in QA_VIDEO_TOOL_DIRS)");
const otpTimeout = { type: "number", default: 300, placeholder: "seconds", describe: "Seconds otp() waits for <out>/otp.txt; exit 3 when no code arrives" };
const commands = {
  doctor: {
    summary: "Report which recorder, encoders, and outputs work on this machine",
    run: doctor,
    spec: {
      playwright: playwrightFlag,
      browser: { type: "string", default: "chromium", values: browsers, placeholder: "name", describe: "Browser to check: chromium, firefox, or webkit" },
      ffmpeg: ffmpegFlag,
      magick: magickFlag,
    },
  },
  login: {
    summary: "Run only the scenario's login, take its OTP from <out>/otp.txt, and save the session for record --storage-state",
    run: login,
    spec: {
      scenario: { type: "string", required: true, placeholder: "file.mjs", describe: "Scenario module: login export async ({ page, baseURL, context, otp })" },
      out: { type: "string", required: true, placeholder: "dir", describe: "Directory for otp-request.json, otp.txt, and auth.json" },
      url: { type: "string", required: true, placeholder: "baseURL", describe: "Target base URL, passed to login and the context" },
      "save-storage-state": path("Where the session is written, mode 0600 (default <out>/auth.json)"),
      "otp-timeout": otpTimeout,
      playwright: playwrightFlag,
    },
  },
  record: {
    summary: "Run a scenario module in a browser and record a webm, one PNG per step, and a manifest",
    run: record,
    spec: {
      scenario: { type: "string", required: true, placeholder: "file.mjs", describe: "Scenario module: default export async ({ page, step, baseURL, context })" },
      out: { type: "string", required: true, placeholder: "dir", describe: "Directory for the webm, step PNGs, and manifest" },
      name: { type: "string", placeholder: "slug", describe: "Evidence name (default: the scenario file name, slugified)" },
      url: { type: "string", placeholder: "baseURL", describe: "Target base URL, passed to the scenario and the context" },
      head: { type: "string", placeholder: "sha", describe: "Commit the evidence was recorded against" },
      size: { type: "string", default: "1280x720", placeholder: "WxH", describe: "Viewport and video size" },
      browser: { type: "string", default: "chromium", values: browsers, placeholder: "name", describe: "chromium, firefox, or webkit" },
      headed: { type: "boolean", describe: "Show the browser window" },
      mode: { type: "string", default: "auto", values: ["auto", "screencast", "context"], placeholder: "mode", describe: "auto (screencast when Playwright has it), screencast, or context (recordVideo)" },
      actions: { type: "boolean", describe: "Annotate actions in the video (screencast mode)" },
      "title-card": { type: "boolean", describe: "Open the video with a title card naming the scenario, head, and URL (screencast mode)" },
      "storage-state": path("Session saved by login; the scenario's login is skipped (a missing file runs it)"),
      "otp-timeout": otpTimeout,
      playwright: playwrightFlag,
    },
  },
  finish: {
    summary: "Write captions and the requested derived outputs next to a recorded manifest",
    run: (options) => finish(options, io),
    spec: {
      manifest: { type: "string", required: true, placeholder: "path", describe: "Manifest written by record" },
      mp4: { type: "boolean", describe: "H.264 mp4 of the video (needs libx264)" },
      gif: { type: "boolean", describe: "Animated gif of the video (needs the gif encoder and palette filters)" },
      slideshow: { type: "boolean", describe: "mp4 slideshow of the step PNGs (needs libx264 and the concat demuxer)" },
      sheet: { type: "boolean", describe: "Labeled contact sheet PNG of the step PNGs (needs ImageMagick)" },
      "max-mb": { type: "number", default: 10, describe: "Attachment budget per output in MB" },
      "gif-width": { type: "number", default: 800, describe: "Gif width in pixels" },
      "gif-fps": { type: "number", default: 10, describe: "Gif frames per second" },
      hold: { type: "number", default: 2, describe: "Seconds each PNG holds in the slideshow" },
      ffmpeg: ffmpegFlag,
      magick: magickFlag,
    },
  },
  check: {
    summary: "Verify a manifest against the files on disk",
    run: (options) => check(options, io),
    spec: {
      manifest: { type: "string", required: true, placeholder: "path", describe: "Manifest to verify" },
      "max-mb": { type: "number", default: 10, describe: "Warn when an output is over this many MB" },
    },
  },
};

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "--help" || command === "-h" || command === "help" || command === undefined) {
    process.stdout.write(`${formatCommands(program, commands)}Exit 3: no OTP arrived before --otp-timeout (login, record).\n`);
    return command === undefined ? 2 : 0;
  }
  const entry = commands[command];
  try {
    if (!entry) throw new UsageError(`unknown command ${command}; expected ${Object.keys(commands).join(", ")}`);
    const options = parseArgs(rest, entry.spec);
    if (options.help) {
      process.stdout.write(formatUsage(program, command, entry));
      return 0;
    }
    return await entry.run(options);
  } catch (error) {
    const usage = error instanceof UsageError;
    say(usage || error instanceof SetupError || error?.exitCode ? errorText(error) : error?.stack ?? errorText(error));
    emit({ ok: false, error: errorText(error), ...(usage ? { usage: `node ${program} ${entry ? `${command} ` : ""}--help` } : {}) });
    return error?.exitCode ?? 2;
  }
};

const code = await main();
process.exitCode = code;
setTimeout(() => process.exit(code), 2000).unref();
