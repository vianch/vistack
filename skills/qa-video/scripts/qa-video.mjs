#!/usr/bin/env node
// Records QA screen evidence with Playwright, then derives captions, mp4, gif, a slideshow, and a contact sheet.
// stdout carries one JSON document (or help text); diagnostics go to stderr. Exit 0 ok, 1 evidence failure, 2 usage or setup error.

import { execFile } from "node:child_process";
import { accessSync, closeSync, constants, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import {
  UsageError, budgetKbps, buildCaptions, checkManifest, compareVersions, formatCommands, formatUsage, gifArgs, labelText, montageArgs, mp4Args,
  outputsAvailable, parseArgs, parseFfmpegCapabilities, parseFfmpegDuration, parseFfmpegVersion, parseSize, publicUrl, redact, redactDeep, slideshowArgs,
  slideshowList, slugify,
} from "./media.mjs";

const program = "qa-video.mjs";
const installHint = "npm i -D playwright && npx playwright install chromium (or set QA_VIDEO_PLAYWRIGHT)";
const browsers = ["chromium", "firefox", "webkit"];
const env = process.env;

class SetupError extends Error {}
class StepFailed extends Error {}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const message = (error) => String(error?.message ?? error).replace(/\x1b\[[0-9;]*m/g, "");
const clip = (text, limit) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
const emit = (value) => process.stdout.write(`${JSON.stringify(redactDeep(value, env), null, 2)}\n`);
const say = (text) => process.stderr.write(`qa-video: ${redact(text, env)}\n`);
const bytesOf = (path) => (existsSync(path) ? statSync(path).size : 0);

const writeJsonAtomic = (path, value) => {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(redactDeep(value, env), null, 2)}\n`);
  renameSync(temporary, path);
};

const which = (name) => {
  const extensions = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        if (statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return null;
};

const locate = (value) => (/[\\/]/.test(value) ? (existsSync(resolve(value)) ? resolve(value) : null) : which(value));

const runTool = (file, args) =>
  new Promise((done) => {
    execFile(file, args, { maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout ?? ""), stderr: String(stderr || (error ? message(error) : "")) });
    });
  });

const packageDirOf = (file) => {
  for (let directory = dirname(file); directory !== dirname(directory); directory = dirname(directory)) {
    if (existsSync(join(directory, "package.json"))) return directory;
  }
  return null;
};

const resolvePlaywright = async (flag) => {
  const source = flag ? "flag" : env.QA_VIDEO_PLAYWRIGHT ? "env" : "cwd";
  const candidates = source === "cwd" ? ["playwright", "@playwright/test", "playwright-core"] : [resolve(flag ?? env.QA_VIDEO_PLAYWRIGHT)];
  const requireFrom = createRequire(source === "cwd" ? join(process.cwd(), "package.json") : import.meta.url);
  const result = { found: false, path: null, version: null, source, screencast: false, api: null, reason: null };
  let entry = null;
  for (const id of candidates) {
    try {
      entry = requireFrom.resolve(id);
      break;
    } catch {}
  }
  if (!entry) return { ...result, reason: source === "cwd" ? `not installed in ${process.cwd()}` : `cannot resolve ${candidates[0]}` };
  result.path = packageDirOf(entry);
  try {
    result.version = JSON.parse(readFileSync(join(result.path, "package.json"), "utf8")).version ?? null;
    const module = await import(pathToFileURL(entry).href);
    result.api = module.chromium ? module : module.default;
  } catch (error) {
    return { ...result, reason: `cannot load ${entry}: ${message(error)}` };
  }
  if (!result.api?.chromium) return { ...result, api: null, reason: `${entry} exports no browser types` };
  return { ...result, found: true, screencast: compareVersions(result.version, "1.59.0") >= 0 };
};

const probeFfmpeg = async (flag) => {
  const path = flag ? locate(flag) ?? resolve(flag) : env.FFMPEG_PATH || which("ffmpeg");
  if (!path) return null;
  const version = await runTool(path, ["-version"]);
  if (version.code !== 0) return { path, version: null, capabilities: parseFfmpegCapabilities(), error: clip(version.stderr.trim(), 200) };
  const [encoders, filters, decoders, demuxers] = await Promise.all(["-encoders", "-filters", "-decoders", "-demuxers"].map((list) => runTool(path, ["-hide_banner", list])));
  return {
    path,
    version: parseFfmpegVersion(version.stdout),
    capabilities: parseFfmpegCapabilities({ encoders: encoders.stdout, filters: filters.stdout, decoders: decoders.stdout, demuxers: demuxers.stdout }),
  };
};

const findMagick = (flag) => {
  if (flag) {
    const path = locate(flag);
    return path ? { flavor: /^magick/i.test(basename(path)) ? "magick" : "montage", path } : null;
  }
  const magick = which("magick");
  if (magick) return { flavor: "magick", path: magick };
  const montage = which("montage");
  return montage ? { flavor: "montage", path: montage } : null;
};

const bundledFfmpeg = () => {
  const cacheRoot = env.PLAYWRIGHT_BROWSERS_PATH
    || (process.platform === "darwin" ? join(homedir(), "Library", "Caches", "ms-playwright")
      : process.platform === "win32" ? join(env.LOCALAPPDATA ?? homedir(), "ms-playwright") : join(homedir(), ".cache", "ms-playwright"));
  try {
    const found = readdirSync(cacheRoot).find((entry) => entry.startsWith("ffmpeg-"));
    return found ? join(cacheRoot, found) : null;
  } catch {
    return null;
  }
};

const toolInstall = (tools) => {
  if (process.platform === "darwin") return `brew install ${tools.join(" ")}`;
  if (process.platform === "linux") return `sudo apt-get install ${tools.join(" ")}`;
  return `install ${tools.join(" and ")} and put them on PATH`;
};

const doctor = async (options) => {
  const playwright = await resolvePlaywright(options.playwright);
  let executable = null;
  try {
    executable = playwright.api?.[options.browser]?.executablePath() ?? null;
  } catch {}
  const browser = { name: options.browser, executable, exists: Boolean(executable && existsSync(executable)), launch: null };
  // Headless runs use a separate headless-shell binary, so only a real launch proves the recorder can start.
  if (playwright.api?.[options.browser]) {
    try {
      const probe = await playwright.api[options.browser].launch({ headless: true, timeout: 30000 });
      await probe.close();
      browser.launch = "ok";
    } catch (error) {
      browser.launch = clip(message(error).split("\n")[0], 300);
    }
  }
  const ffmpeg = await probeFfmpeg(options.ffmpeg);
  const capabilities = ffmpeg?.capabilities ?? parseFfmpegCapabilities();
  const magick = findMagick(options.magick);
  const outputs = outputsAvailable({ webm: playwright.found && browser.launch === "ok", ffmpeg: capabilities, imagemagick: Boolean(magick) });
  const hints = [];
  if (!playwright.found) hints.push(`Playwright ${playwright.reason}: ${installHint}`);
  else if (browser.launch !== "ok") hints.push(`the ${options.browser} build for Playwright ${playwright.version} does not launch (${browser.launch}): npx playwright install ${options.browser}`);
  const missing = [...(outputs.mp4 && outputs.gif && outputs.slideshow ? [] : ["ffmpeg"]), ...(magick ? [] : ["imagemagick"])];
  if (missing.length) hints.push(`for mp4, gif, slideshow, and sheet outputs: ${toolInstall(missing)}`);
  const bundled = bundledFfmpeg();
  if (!ffmpeg && bundled) hints.push(`the ffmpeg bundled with Playwright (${bundled}) is a minimal build without libx264 or gif and is not usable for finish`);
  emit({
    ok: outputs.webm,
    node: process.version,
    playwright: { found: playwright.found, path: playwright.path, version: playwright.version, source: playwright.source, screencast: playwright.screencast, browser },
    ffmpeg: { path: ffmpeg?.path ?? null, version: ffmpeg?.version ?? null, ...capabilities },
    ffprobe: { path: (ffmpeg && locate(join(dirname(ffmpeg.path), "ffprobe"))) || which("ffprobe") },
    imagemagick: { flavor: magick?.flavor ?? null, path: magick?.path ?? null },
    outputs,
    hints,
  });
  return outputs.webm ? 0 : 1;
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

const record = async (options) => {
  const size = parseSize(options.size);
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(options.url ?? "")) throw new UsageError("--url must not carry credentials; read them from process.env in the scenario");
  const scenarioPath = resolve(options.scenario);
  if (!existsSync(scenarioPath)) throw new SetupError(`scenario not found: ${options.scenario}`);
  const name = slugify(options.name ?? basename(scenarioPath, extname(scenarioPath)));
  if (!name) throw new SetupError("the scenario name slugifies to nothing; pass --name");
  let scenario;
  try {
    scenario = await import(pathToFileURL(scenarioPath).href);
  } catch (error) {
    throw new SetupError(`cannot load scenario ${options.scenario}: ${message(error)}`);
  }
  if (typeof scenario.default !== "function") throw new SetupError("the scenario module has no default export function");
  if (scenario.login !== undefined && typeof scenario.login !== "function") throw new SetupError("the scenario login export is not a function");
  if (scenario.contextOptions !== undefined && !isObject(scenario.contextOptions)) throw new SetupError("the scenario contextOptions export is not an object");
  const out = resolve(options.out);
  const files = { video: join(out, `${name}.webm`), manifest: join(out, `${name}.manifest.json`), tmp: join(out, `.video-tmp-${name}`) };
  const priorHead = recordedHead(files.manifest);
  if (priorHead && options.head && !sameHead(priorHead, options.head)) {
    throw new SetupError(`${files.manifest} is evidence for head ${priorHead}; record head ${options.head} into its own directory, <state-root>/qa/<slug>/<slice-or-pr>/<head7>/`);
  }
  const playwright = await resolvePlaywright(options.playwright);
  if (!playwright.found) throw new SetupError(`Playwright ${playwright.reason}. Install: ${installHint}`);
  const browserType = playwright.api[options.browser];
  if (!browserType) throw new SetupError(`Playwright ${playwright.version} has no ${options.browser} browser type`);

  mkdirSync(out, { recursive: true });
  rmSync(files.video, { force: true });
  const baseURL = options.url ?? null;
  const shared = { ...(scenario.contextOptions ?? {}), ...(baseURL ? { baseURL } : {}) };
  const session = { mode: null, t0: 0, startedAt: null, steps: [], warnings: [], stopped: false, scenarioError: false, actions: false, overlays: false };
  const elapsed = () => Number(((performance.now() - session.t0) / 1000).toFixed(3));
  const attempt = async (label, action) => {
    try {
      await action();
      return true;
    } catch (error) {
      session.warnings.push(`${label}: ${clip(redact(message(error), env), 500)}`);
      return false;
    }
  };
  let browser;
  let context;
  let page;
  let storageState;
  const openRecorded = async (recordVideo) => {
    context = await browser.newContext({ ...shared, viewport: size, ...(storageState ? { storageState } : {}), ...(recordVideo ? { recordVideo: { dir: files.tmp, size } } : {}) });
    page = await context.newPage();
  };
  try {
    browser = await browserType.launch({ headless: !options.headed });
    if (scenario.login) {
      const loginContext = await browser.newContext(shared);
      try {
        await scenario.login({ page: await loginContext.newPage(), baseURL, context: loginContext });
        storageState = await loginContext.storageState();
      } catch (error) {
        throw new SetupError(`login failed: ${message(error)}`);
      } finally {
        await loginContext.close().catch(() => {});
      }
    }
    if (options.mode !== "context") {
      await openRecorded(false);
      if (typeof page.screencast?.start === "function") {
        try {
          await page.screencast.start({ path: files.video, size });
          session.mode = "screencast";
        } catch (error) {
          if (options.mode === "screencast") throw new SetupError(`page.screencast.start failed: ${message(error)}`);
          session.warnings.push(`page.screencast.start failed, recorded with recordVideo instead: ${clip(message(error), 300)}`);
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
    throw error instanceof SetupError ? error : new SetupError(`cannot start ${options.browser}: ${message(error)}`);
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
      error = clip(redact(message(caught), env), 500);
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
      session.warnings.push(`scenario error outside a step: ${clip(redact(message(error), env), 500)}`);
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
  writeJsonAtomic(files.manifest, manifest);
  const failed = session.steps.filter((recorded) => recorded.result === "fail").length;
  emit({ manifest: files.manifest, video: videoBytes > 0 ? files.video : null, steps: session.steps.length, passed: session.steps.length - failed, failed });
  return failed || session.scenarioError || session.steps.length === 0 || videoBytes === 0 ? 1 : 0;
};

const readManifest = (path) => {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new SetupError(`cannot read manifest ${path}: ${error.code ?? message(error)}`);
  }
  if (!isObject(manifest) || typeof manifest.scenario !== "string" || !Array.isArray(manifest.steps)) throw new SetupError(`${path} is not a qa-video manifest`);
  return manifest;
};

const inside = (directory, path) => {
  const target = resolve(directory, path);
  const offset = relative(directory, target);
  return offset !== "" && !offset.startsWith("..") && !isAbsolute(offset) ? target : null;
};

const finish = async (options) => {
  const manifestPath = resolve(options.manifest);
  const manifest = readManifest(manifestPath);
  const directory = dirname(manifestPath);
  const name = slugify(manifest.scenario) || "evidence";
  const maxBytes = options.maxMb * 1024 * 1024;
  const outputs = { ...(isObject(manifest.outputs) ? manifest.outputs : {}) };
  const at = (file) => join(directory, file);
  let failed = false;
  const settle = (key, file, note) => {
    const bytes = bytesOf(at(file));
    outputs[key] = bytes > maxBytes ? { path: file, bytes, status: "over-budget", reason: `${(bytes / 1048576).toFixed(1)} MB is over --max-mb ${options.maxMb}${note ?? ""}` } : { path: file, bytes, status: "produced" };
  };
  const run = async (key, file, tool, args) => {
    const result = await runTool(tool, args);
    if (result.code === 0) return result;
    outputs[key] = { path: file, bytes: 0, status: "failed", reason: redact(result.stderr, env).trim().slice(-400) };
    failed = true;
    return null;
  };

  const captions = buildCaptions(manifest.steps);
  for (const kind of ["vtt", "srt"]) {
    writeFileSync(at(`${name}.${kind}`), redact(captions[kind], env));
    settle(kind, `${name}.${kind}`);
  }

  const requested = ["mp4", "gif", "slideshow", "sheet"].filter((key) => options[key]);
  const ffmpeg = requested.some((key) => key !== "sheet") ? await probeFfmpeg(options.ffmpeg) : null;
  const magick = options.sheet ? findMagick(options.magick) : null;
  const available = outputsAvailable({ webm: true, ffmpeg: ffmpeg?.capabilities, imagemagick: Boolean(magick) });
  const video = inside(directory, manifest.video ?? "");
  const shots = manifest.steps
    .map((step, index) => ({ step, index, path: typeof step.screenshot === "string" ? inside(directory, step.screenshot) : null }))
    .filter((shot) => shot.path && existsSync(shot.path));
  const targets = { mp4: `${name}.mp4`, gif: `${name}.gif`, slideshow: `${name}-slideshow.mp4`, sheet: `${name}-sheet.png` };
  const needs = { mp4: "an ffmpeg with libx264", gif: "an ffmpeg with the gif encoder and palettegen, paletteuse, split, fps, scale", slideshow: "an ffmpeg with libx264, the png decoder, and the concat demuxer", sheet: "ImageMagick (magick or montage)" };

  for (const key of requested) {
    const file = targets[key];
    if (!available[key]) {
      const tool = key === "sheet" ? (options.magick ? `ImageMagick not found at ${options.magick}` : "ImageMagick not found on PATH")
        : !ffmpeg ? "ffmpeg not found (pass --ffmpeg, set FFMPEG_PATH, or put it on PATH)" : `ffmpeg at ${ffmpeg.path} lacks the needed encoders or filters`;
      outputs[key] = { path: file, bytes: 0, status: "skipped", reason: `${tool}; ${key} needs ${needs[key]}` };
      continue;
    }
    if ((key === "mp4" || key === "gif") && !(video && existsSync(video))) {
      outputs[key] = { path: file, bytes: 0, status: "failed", reason: `video ${manifest.video} is missing` };
      failed = true;
      continue;
    }
    if ((key === "slideshow" || key === "sheet") && shots.length === 0) {
      outputs[key] = { path: file, bytes: 0, status: "skipped", reason: "no step screenshots on disk" };
      continue;
    }
    if (key === "mp4") {
      const first = await run(key, file, ffmpeg.path, mp4Args({ input: video, output: at(file) }));
      if (!first) continue;
      // The recorder keeps writing frames after stop(), so the file can outlast the manifest's duration.
      const seconds = Math.max(Number(manifest.duration) || 0, parseFfmpegDuration(first.stderr) ?? 0);
      const kbps = bytesOf(at(file)) > maxBytes ? budgetKbps(maxBytes, seconds) : null;
      if (kbps && !(await run(key, file, ffmpeg.path, mp4Args({ input: video, output: at(file), kbps })))) continue;
      settle(key, file, kbps ? ` after one re-encode at ${kbps} kbps` : "");
    } else if (key === "gif") {
      if (await run(key, file, ffmpeg.path, gifArgs({ input: video, output: at(file), fps: options.gifFps, width: options.gifWidth }))) settle(key, file);
    } else if (key === "slideshow") {
      const list = at(`${name}.slideshow.txt`);
      writeFileSync(list, slideshowList(shots.map((shot) => shot.path), options.hold));
      if (await run(key, file, ffmpeg.path, slideshowArgs({ list, output: at(file) }))) settle(key, file);
    } else {
      const images = shots.map((shot) => ({ path: shot.path, label: redact(labelText(shot.index + 1, shot.step), env) }));
      if (await run(key, file, magick.path, montageArgs({ images, output: at(file), flavor: magick.flavor }))) settle(key, file);
    }
  }

  writeJsonAtomic(manifestPath, { ...manifest, outputs });
  emit({ manifest: manifestPath, outputs });
  return failed ? 1 : 0;
};

const fileFacts = (path) => {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { exists: false };
    const head = Buffer.alloc(12);
    const descriptor = openSync(path, "r");
    try {
      return { exists: true, bytes: stat.size, head: [...head.subarray(0, readSync(descriptor, head, 0, 12, 0))] };
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return { exists: false };
  }
};

const check = async (options) => {
  const manifestPath = resolve(options.manifest);
  const directory = dirname(manifestPath);
  let text = "";
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch (error) {
    text = `cannot read ${manifestPath}: ${error.code ?? message(error)}`;
  }
  let manifest = text;
  try {
    manifest = JSON.parse(text);
  } catch {}
  const facts = {};
  if (isObject(manifest)) {
    const paths = [manifest.video, ...(Array.isArray(manifest.steps) ? manifest.steps.map((step) => step?.screenshot) : []), ...Object.values(isObject(manifest.outputs) ? manifest.outputs : {}).map((output) => output?.path)];
    for (const path of paths.filter((item) => typeof item === "string" && item !== "")) {
      const target = inside(directory, path);
      facts[path] = target ? fileFacts(target) : { exists: false };
    }
  }
  const result = checkManifest(manifest, facts, { maxBytes: options.maxMb * 1024 * 1024 });
  emit(result);
  return result.ok ? 0 : 1;
};

const path = (describe) => ({ type: "string", placeholder: "path", describe });
const commands = {
  doctor: {
    summary: "Report which recorder, encoders, and outputs work on this machine",
    run: doctor,
    spec: {
      playwright: path("Playwright module path or package directory (else QA_VIDEO_PLAYWRIGHT, else the cwd's node_modules)"),
      browser: { type: "string", default: "chromium", values: browsers, placeholder: "name", describe: "Browser to check: chromium, firefox, or webkit" },
      ffmpeg: path("ffmpeg binary (else FFMPEG_PATH, else ffmpeg on PATH)"),
      magick: path("ImageMagick magick or montage binary (else magick, then montage, on PATH)"),
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
      playwright: path("Playwright module path or package directory (else QA_VIDEO_PLAYWRIGHT, else the cwd's node_modules)"),
    },
  },
  finish: {
    summary: "Write captions and the requested derived outputs next to a recorded manifest",
    run: finish,
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
      ffmpeg: path("ffmpeg binary (else FFMPEG_PATH, else ffmpeg on PATH)"),
      magick: path("ImageMagick magick or montage binary (else magick, then montage, on PATH)"),
    },
  },
  check: {
    summary: "Verify a manifest against the files on disk",
    run: check,
    spec: {
      manifest: { type: "string", required: true, placeholder: "path", describe: "Manifest to verify" },
      "max-mb": { type: "number", default: 10, describe: "Warn when an output is over this many MB" },
    },
  },
};

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "--help" || command === "-h" || command === "help" || command === undefined) {
    process.stdout.write(formatCommands(program, commands));
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
    say(usage || error instanceof SetupError ? message(error) : error?.stack ?? message(error));
    emit({ ok: false, error: message(error), ...(usage ? { usage: `node ${program} ${entry ? `${command} ` : ""}--help` } : {}) });
    return 2;
  }
};

const code = await main();
process.exitCode = code;
setTimeout(() => process.exit(code), 2000).unref();
