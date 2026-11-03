import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  budgetKbps, buildCaptions, checkManifest, errorText, gifArgs, labelText, montageArgs, mp4Args, outputsAvailable, parseFfmpegDuration, redact, redactDeep,
  slideshowArgs, slideshowList, slugify,
} from "./media.mjs";
import { outputReport, pickAttachment, unavailableReason } from "./outputs.mjs";
import { findMagick, probeFfmpeg, runTool } from "./toolchain.mjs";

class ManifestError extends Error {
  exitCode = 2;
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export const bytesOf = (path) => (existsSync(path) ? statSync(path).size : 0);

export const writeJsonAtomic = (path, value, env) => {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(redactDeep(value, env), null, 2)}\n`);
  renameSync(temporary, path);
};

const readManifest = (path) => {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ManifestError(`cannot read manifest ${path}: ${error.code ?? errorText(error)}`);
  }
  if (!isObject(manifest) || typeof manifest.scenario !== "string" || !Array.isArray(manifest.steps)) throw new ManifestError(`${path} is not a qa-video manifest`);
  return manifest;
};

const inside = (directory, path) => {
  const target = resolve(directory, path);
  const offset = relative(directory, target);
  return offset !== "" && !offset.startsWith("..") && !isAbsolute(offset) ? target : null;
};

export const finish = async (options, { env, emit }) => {
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

  const video = inside(directory, manifest.video ?? "");
  const videoProblem = !video || !existsSync(video) ? `video ${manifest.video} is missing` : bytesOf(video) === 0 ? `video ${manifest.video} is empty` : null;
  if (!videoProblem) settle("webm", manifest.video, "; re-record a shorter scenario, or attach the gif (finish --gif)");
  else outputs.webm = { path: manifest.video ?? null, bytes: 0, status: "failed", reason: outputs.webm?.status === "failed" ? outputs.webm.reason : videoProblem };

  const requested = ["mp4", "gif", "slideshow", "sheet"].filter((key) => options[key]);
  const ffmpeg = requested.some((key) => key !== "sheet") ? await probeFfmpeg(options.ffmpeg, env) : null;
  const magick = options.sheet ? findMagick(options.magick, env) : null;
  const available = outputsAvailable({ webm: true, ffmpeg: ffmpeg?.capabilities, imagemagick: Boolean(magick?.path) });
  const shots = manifest.steps
    .map((step, index) => ({ step, index, path: typeof step.screenshot === "string" ? inside(directory, step.screenshot) : null }))
    .filter((shot) => shot.path && existsSync(shot.path));
  const targets = { mp4: `${name}.mp4`, gif: `${name}.gif`, slideshow: `${name}-slideshow.mp4`, sheet: `${name}-sheet.png` };

  for (const key of requested) {
    const file = targets[key];
    if (!available[key]) {
      outputs[key] = { path: file, bytes: 0, status: "skipped", reason: unavailableReason(key, { ffmpeg, magick }) };
      continue;
    }
    if ((key === "mp4" || key === "gif") && videoProblem) {
      outputs[key] = { path: file, bytes: 0, status: "failed", reason: videoProblem };
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

  writeJsonAtomic(manifestPath, { ...manifest, outputs }, env);
  emit({ manifest: manifestPath, outputs, attach: pickAttachment(outputs) });
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

export const check = async (options, { emit }) => {
  const manifestPath = resolve(options.manifest);
  const directory = dirname(manifestPath);
  let text = "";
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch (error) {
    text = `cannot read ${manifestPath}: ${error.code ?? errorText(error)}`;
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
  const outputs = isObject(manifest) ? outputReport(manifest.outputs, facts, options.maxMb) : {};
  emit({ ...result, outputs, attach: isObject(manifest) ? pickAttachment(outputs) : null });
  return result.ok ? 0 : 1;
};
