// Settings come from the env copy each caller passes, never from process.env.

import { execFile } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { basename, delimiter, dirname, extname, join, resolve } from "node:path";

import { clip, errorText, firstLine, parseFfmpegCapabilities, parseFfmpegVersion } from "./media.mjs";

const usualToolDirs = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"];
const ffmpegLists = ["-encoders", "-filters", "-decoders", "-demuxers"];

export const toolDirs = (env, platform = process.platform) => {
  if (env.QA_VIDEO_TOOL_DIRS !== undefined) return env.QA_VIDEO_TOOL_DIRS.split(delimiter).filter(Boolean);
  return platform === "win32" ? [] : usualToolDirs;
};

export const envValue = (env, name) => env[name] ?? env[Object.keys(env).find((key) => key.toUpperCase() === name)];

export const executableNames = (name, platform, env) => {
  if (platform !== "win32") return [name];
  const extensions = (envValue(env, "PATHEXT") ?? ".EXE;.CMD").split(";").filter(Boolean).map((extension) => extension.toLowerCase());
  return extensions.includes(extname(name).toLowerCase()) ? [name] : extensions.map((extension) => `${name}${extension}`);
};

const isExecutableFile = (path) => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const executableIn = (directory, name, env, platform = process.platform) =>
  executableNames(name, platform, env).map((file) => join(directory, file)).find(isExecutableFile) ?? null;

export const which = (name, env, platform = process.platform) => {
  for (const directory of [...(envValue(env, "PATH") ?? "").split(delimiter).filter(Boolean), ...toolDirs(env, platform)]) {
    const found = executableIn(directory, name, env, platform);
    if (found) return found;
  }
  return null;
};

const isPath = (value) => /[\\/]/.test(value);

export const locate = (value, env, platform = process.platform) => (isPath(value) ? (existsSync(resolve(value)) ? resolve(value) : null) : which(value, env, platform));

const searchedText = (env) => {
  const directories = toolDirs(env);
  return `on PATH${directories.length ? ` or in ${directories.join(", ")}` : ""}`;
};

export const runTool = (file, args) =>
  new Promise((done) => {
    execFile(file, args, { maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout ?? ""), stderr: String(stderr || (error ? errorText(error) : "")) });
    });
  });

const probeFailure = (args, result) => clip(`${args} exited ${result.code}: ${firstLine(result.stderr) || "no output"}`, 300);

export const probeFfmpeg = async (flag, env) => {
  const [label, wanted] = flag ? ["--ffmpeg", flag] : env.FFMPEG_PATH ? ["FFMPEG_PATH", env.FFMPEG_PATH] : [null, "ffmpeg"];
  const path = locate(wanted, env);
  const nothing = { path, version: null, capabilities: parseFfmpegCapabilities() };
  if (!path) {
    const error = label ? `${label} ${wanted} not found${isPath(wanted) ? "" : ` ${searchedText(env)}`}` : `ffmpeg not found ${searchedText(env)} (pass --ffmpeg, set FFMPEG_PATH, or put it on PATH)`;
    return { ...nothing, state: "missing", error };
  }
  const version = await runTool(path, ["-version"]);
  if (version.code !== 0) return { ...nothing, state: "failed", error: probeFailure("-version", version) };
  const lists = await Promise.all(ffmpegLists.map((list) => runTool(path, ["-hide_banner", list])));
  const broken = lists.findIndex((result) => result.code !== 0);
  if (broken >= 0) return { ...nothing, version: parseFfmpegVersion(version.stdout), state: "failed", error: probeFailure(`-hide_banner ${ffmpegLists[broken]}`, lists[broken]) };
  const [encoders, filters, decoders, demuxers] = lists.map((result) => result.stdout);
  return { path, version: parseFfmpegVersion(version.stdout), capabilities: parseFfmpegCapabilities({ encoders, filters, decoders, demuxers }), state: "ok", error: null };
};

export const findFfprobe = (ffmpegPath, env) => (ffmpegPath && executableIn(dirname(ffmpegPath), "ffprobe", env)) || which("ffprobe", env);

export const findMagick = (flag, env) => {
  if (flag) {
    const path = locate(flag, env);
    return path ? { flavor: /^magick/i.test(basename(path)) ? "magick" : "montage", path, error: null } : { flavor: null, path: null, error: `ImageMagick not found at ${flag}` };
  }
  for (const flavor of ["magick", "montage"]) {
    const path = which(flavor, env);
    if (path) return { flavor, path, error: null };
  }
  return { flavor: null, path: null, error: `ImageMagick not found ${searchedText(env)}` };
};

export const toolInstall = (tools) => {
  if (process.platform === "darwin") return `brew install ${tools.join(" ")}`;
  if (process.platform === "linux") return `sudo apt-get install ${tools.join(" ")}`;
  return `install ${tools.join(" and ")} and put them on PATH`;
};
