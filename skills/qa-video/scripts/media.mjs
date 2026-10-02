// Pure helpers for qa-video.mjs: nothing here touches the filesystem, spawns a process, or reads process state.

export class UsageError extends Error {}

const secretName = /PASS|SECRET|TOKEN|KEY|COOKIE|BYPASS|CREDENTIAL/i;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const camel = (flag) => flag.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

export const parseArgs = (argv, spec) => {
  const options = { help: false };
  for (const [flag, entry] of Object.entries(spec)) {
    if ("default" in entry) options[camel(flag)] = entry.default;
    else if (entry.type === "boolean") options[camel(flag)] = false;
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const match = argument.match(/^--([a-z0-9-]+)(?:=(.*))?$/);
    const entry = match && spec[match[1]];
    if (!entry) throw new UsageError(`unknown argument ${argument}`);
    const key = camel(match[1]);
    if (entry.type === "boolean") {
      if (match[2] !== undefined) throw new UsageError(`--${match[1]} takes no value`);
      options[key] = true;
      continue;
    }
    let value = match[2];
    if (value === undefined) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`--${match[1]} needs a value`);
      index += 1;
    }
    if (entry.type === "number") {
      const number = Number(value);
      if (value.trim() === "" || !Number.isFinite(number) || number <= 0) throw new UsageError(`--${match[1]} must be a positive number, got ${value}`);
      value = number;
    }
    if (entry.values && !entry.values.includes(value)) throw new UsageError(`--${match[1]} must be one of ${entry.values.join(", ")}`);
    options[key] = value;
  }
  if (options.help) return options;
  for (const [flag, entry] of Object.entries(spec)) {
    if (entry.required && options[camel(flag)] === undefined) throw new UsageError(`--${flag} is required`);
  }
  return options;
};

export const formatUsage = (program, command, { summary, spec }) => {
  const flagText = (flag, entry) => (entry.type === "boolean" ? `--${flag}` : `--${flag} <${entry.placeholder ?? entry.type}>`);
  const rows = Object.entries(spec).map(([flag, entry]) => {
    const notes = [entry.required ? "required" : null, "default" in entry && entry.default !== false ? `default ${entry.default}` : null].filter(Boolean);
    return [flagText(flag, entry), `${entry.describe}${notes.length ? ` (${notes.join(", ")})` : ""}`];
  });
  const width = Math.max(...rows.map(([left]) => left.length));
  const required = Object.entries(spec).filter(([, entry]) => entry.required).map(([flag, entry]) => flagText(flag, entry));
  return [
    `usage: ${program} ${command} ${[...required, "[options]"].join(" ")}`,
    "",
    summary,
    "",
    ...rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`),
    `  ${"--help".padEnd(width)}  Print this help`,
    "",
  ].join("\n");
};

export const formatCommands = (program, commands) => {
  const width = Math.max(...Object.keys(commands).map((name) => name.length));
  return [
    `usage: ${program} <command> [options]`,
    "",
    ...Object.entries(commands).map(([name, { summary }]) => `  ${name.padEnd(width)}  ${summary}`),
    "",
    `Run ${program} <command> --help for that command's flags.`,
    "Exit codes: 0 ok, 1 evidence or step failure, 2 usage or setup error.",
    "",
  ].join("\n");
};

export const parseSize = (text) => {
  const match = String(text).trim().match(/^(\d{1,5})x(\d{1,5})$/i);
  const width = match ? Number(match[1]) : 0;
  const height = match ? Number(match[2]) : 0;
  if (width < 16 || height < 16 || width > 7680 || height > 7680) throw new UsageError(`size must be WIDTHxHEIGHT between 16 and 7680, got ${text}`);
  return { width, height };
};

export const slugify = (text) =>
  String(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");

const clockParts = (seconds) => {
  const millis = Math.max(0, Math.round(Number(seconds) * 1000) || 0);
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return [pad(Math.floor(millis / 3600000)), pad(Math.floor(millis / 60000) % 60), pad(Math.floor(millis / 1000) % 60), pad(millis % 1000, 3)];
};

export const formatVttTime = (seconds) => {
  const [hours, minutes, secs, millis] = clockParts(seconds);
  return `${hours}:${minutes}:${secs}.${millis}`;
};

export const formatSrtTime = (seconds) => {
  const [hours, minutes, secs, millis] = clockParts(seconds);
  return `${hours}:${minutes}:${secs},${millis}`;
};

export const cueText = (index, step) =>
  `${index}. ${String(step.caption ?? step.name ?? "").replace(/\s+/g, " ").replace(/-->/g, "->").trim()} (${step.result === "pass" ? "PASS" : "FAIL"})`;

export const buildCaptions = (steps) => {
  const cues = steps.map((step, index) => ({ start: step.start, end: Math.max(step.end, step.start + 0.001), text: cueText(index + 1, step) }));
  const vtt = ["WEBVTT", "", ...cues.flatMap((cue, index) => [String(index + 1), `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}`, cue.text, ""])];
  const srt = cues.flatMap((cue, index) => [String(index + 1), `${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}`, cue.text, ""]);
  return { vtt: `${vtt.join("\n")}\n`, srt: `${srt.join("\n")}\n` };
};

const evenScale = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

export const mp4Args = ({ input, output, kbps }) => [
  "-y", "-i", input, "-c:v", "libx264", "-preset", "medium",
  ...(kbps ? ["-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`] : ["-crf", "23"]),
  "-pix_fmt", "yuv420p", "-vf", evenScale, "-movflags", "+faststart", "-an", output,
];

export const budgetKbps = (maxBytes, duration) => {
  if (!(duration > 0) || !(maxBytes > 0)) return null;
  const kbps = Math.floor((maxBytes * 8 * 0.92) / duration / 1000);
  return kbps >= 1 ? kbps : null;
};

export const gifArgs = ({ input, output, fps, width }) => [
  "-y", "-i", input,
  "-vf", `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
  "-loop", "0", output,
];

const concatQuote = (path) => `'${String(path).replace(/'/g, "'\\''")}'`;

export const slideshowList = (files, hold) => {
  if (files.length === 0) return "";
  const lines = files.flatMap((file) => [`file ${concatQuote(file)}`, `duration ${hold}`]);
  return `${[...lines, `file ${concatQuote(files.at(-1))}`].join("\n")}\n`;
};

export const slideshowArgs = ({ list, output }) => [
  "-y", "-f", "concat", "-safe", "0", "-i", list,
  "-vf", `fps=25,${evenScale},format=yuv420p`, "-c:v", "libx264", "-movflags", "+faststart", output,
];

export const escapeMagickLabel = (text) => {
  const escaped = String(text).replace(/%/g, "%%");
  return escaped.startsWith("@") ? ` ${escaped}` : escaped;
};

export const labelText = (index, step) => escapeMagickLabel(cueText(index, step));

export const montageArgs = ({ images, output, flavor }) => [
  ...(flavor === "magick" ? ["montage"] : []),
  ...images.flatMap((image) => ["-label", image.label, image.path]),
  "-tile", `${Math.min(3, images.length)}x`, "-geometry", "480x270+12+12",
  "-background", "#1f2328", "-fill", "#ffffff", "-pointsize", "18", output,
];

const listedNames = (text) => {
  const names = new Set();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = line.match(/^\s*[A-Z.|]+(?:\s+d)?\s+([A-Za-z0-9_,-]+)\s/);
    if (match) match[1].split(",").forEach((name) => names.add(name));
  }
  return names;
};

export const parseFfmpegVersion = (text) => String(text ?? "").match(/version\s+(\S+)/)?.[1] ?? null;

// Realtime webm writers often leave Duration: N/A, so the last progress time= is the fallback.
export const parseFfmpegDuration = (text) => {
  const seconds = (clock) => {
    const [hours, minutes, secs] = clock.split(":").map(Number);
    return hours * 3600 + minutes * 60 + secs;
  };
  const source = String(text ?? "");
  const header = source.match(/Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/);
  if (header) return seconds(header[1]);
  const progress = [...source.matchAll(/time=\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/g)].at(-1);
  return progress ? seconds(progress[1]) : null;
};

// Query strings and fragments can carry bypass tokens, so evidence keeps only origin and path.
export const publicUrl = (text) => {
  if (!text) return null;
  try {
    const url = new URL(text);
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return String(text).split(/[?#]/)[0];
  }
};

export const parseFfmpegCapabilities = ({ encoders, filters, decoders, demuxers } = {}) => {
  const pick = (text, keys) => {
    const names = listedNames(text);
    return Object.fromEntries(keys.map((key) => [key, names.has(key)]));
  };
  return {
    encoders: pick(encoders, ["libx264", "gif"]),
    filters: pick(filters, ["palettegen", "paletteuse", "scale", "fps", "split"]),
    decoders: pick(decoders, ["png"]),
    demuxers: pick(demuxers, ["concat"]),
  };
};

export const outputsAvailable = ({ webm = false, ffmpeg = null, imagemagick = false } = {}) => {
  const filters = ffmpeg?.filters ?? {};
  const libx264 = Boolean(ffmpeg?.encoders?.libx264);
  return {
    webm: Boolean(webm),
    vtt: true,
    srt: true,
    mp4: libx264,
    gif: Boolean(ffmpeg?.encoders?.gif && filters.palettegen && filters.paletteuse && filters.split && filters.fps && filters.scale),
    slideshow: Boolean(libx264 && ffmpeg?.decoders?.png && ffmpeg?.demuxers?.concat),
    sheet: Boolean(imagemagick),
  };
};

export const compareVersions = (left, right) => {
  const parts = (version) => (String(version ?? "").match(/^v?(\d+(?:\.\d+)*)/)?.[1] ?? "0").split(".").map(Number);
  const [a, b] = [parts(left), parts(right)];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
};

export const secretValues = (env) =>
  Object.entries(env ?? {})
    .filter(([name, value]) => secretName.test(name) && typeof value === "string" && value.length >= 4)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);

export const redact = (text, env) => secretValues(env).reduce((out, secret) => out.split(secret).join("[redacted]"), String(text ?? ""));

// Names and paths stay verbatim: a short secret such as "home" must not rewrite the "home" step or its PNG path.
export const structuralKeys = new Set(["name", "scenario", "path", "video", "screenshot", "manifest", "executable"]);

export const redactDeep = (value, env, keep = structuralKeys) => {
  if (typeof value === "string") return redact(value, env);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, env, keep));
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, keep.has(key) && typeof item === "string" ? item : redactDeep(item, env, keep)]));
  }
  return value;
};

const magicChecks = {
  webm: [(head) => head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3, "WebM"],
  mp4: [(head) => String.fromCharCode(...head.slice(4, 8)) === "ftyp", "MP4"],
  png: [(head) => head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47, "PNG"],
  gif: [(head) => String.fromCharCode(...head.slice(0, 4)) === "GIF8", "GIF"],
};

const fileProblem = (label, path, facts) => {
  const fact = facts[path];
  if (!fact?.exists) return `${label} ${path} is missing`;
  if (!(fact.bytes > 0)) return `${label} ${path} is empty`;
  const extension = String(path).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const check = magicChecks[extension];
  if (check && !check[0](Array.from(fact.head ?? []))) return `${label} ${path} is not a ${check[1]} file`;
  return null;
};

export const checkManifest = (input, facts = {}, { maxBytes = 10 * 1024 * 1024 } = {}) => {
  const errors = [];
  const warnings = [];
  let manifest = input;
  if (typeof input === "string") {
    try {
      manifest = JSON.parse(input);
    } catch (error) {
      return { ok: false, errors: [`manifest is not valid JSON: ${error.message}`], warnings, steps: 0, passed: 0, failed: 0 };
    }
  }
  if (!isObject(manifest)) return { ok: false, errors: ["manifest is not a JSON object"], warnings, steps: 0, passed: 0, failed: 0 };
  const steps = Array.isArray(manifest.steps) ? manifest.steps : [];
  const duration = Number(manifest.duration);
  if (typeof manifest.scenario !== "string" || manifest.scenario === "") errors.push("manifest has no scenario");
  if (typeof manifest.video !== "string" || manifest.video === "") errors.push("manifest has no video");
  else {
    const problem = fileProblem("video", manifest.video, facts);
    if (problem) errors.push(problem);
  }
  if (!Array.isArray(manifest.steps)) errors.push("manifest has no steps");
  else if (steps.length === 0) errors.push("manifest has an empty steps list");
  if (!Number.isFinite(duration) || duration < 0) errors.push("manifest duration is not a number of seconds");
  else if (duration === 0) warnings.push("duration is 0");
  const seen = new Set();
  let previousStart = -Infinity;
  steps.forEach((step, index) => {
    const label = `step ${index + 1} (${step?.name ?? "unnamed"})`;
    if (!isObject(step) || typeof step.name !== "string" || step.name === "") {
      errors.push(`${label} has no name`);
      return;
    }
    if (seen.has(step.name)) errors.push(`duplicate step name ${step.name}`);
    seen.add(step.name);
    if (typeof step.start !== "number" || typeof step.end !== "number") errors.push(`${label} has no numeric start and end`);
    else {
      if (step.start > step.end) errors.push(`${label} starts after it ends`);
      if (step.start < previousStart) errors.push(`${label} starts before the previous step`);
      if (Number.isFinite(duration) && step.end > duration + 0.5) errors.push(`${label} ends after the video (${step.end} > ${duration})`);
      previousStart = step.start;
    }
    if (typeof step.screenshot !== "string" || step.screenshot === "") errors.push(`${label} has no screenshot`);
    else {
      const problem = fileProblem(`${label} screenshot`, step.screenshot, facts);
      if (problem) errors.push(problem);
    }
  });
  for (const [key, output] of Object.entries(isObject(manifest.outputs) ? manifest.outputs : {})) {
    if (!isObject(output)) continue;
    if (output.status === "produced") {
      const problem = fileProblem(`output ${key}`, output.path, facts);
      if (problem) errors.push(problem);
      else if (facts[output.path].bytes !== output.bytes) errors.push(`output ${key} ${output.path} is ${facts[output.path].bytes} bytes, the manifest says ${output.bytes}`);
    }
    if (output.bytes > maxBytes) {
      warnings.push(`output ${key} ${output.path} is ${(output.bytes / 1048576).toFixed(1)} MB, over the attachment budget of ${(maxBytes / 1048576).toFixed(1)} MB`);
    }
  }
  const failed = steps.filter((step) => step?.result === "fail").length;
  const passed = steps.filter((step) => step?.result === "pass").length;
  if (failed > 0) warnings.push(`${failed} step${failed === 1 ? "" : "s"} failed`);
  return { ok: errors.length === 0, errors, warnings, steps: steps.length, passed, failed };
};
