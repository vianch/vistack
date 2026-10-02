import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  UsageError,
  budgetKbps,
  buildCaptions,
  checkManifest,
  compareVersions,
  escapeMagickLabel,
  formatCommands,
  formatSrtTime,
  formatUsage,
  formatVttTime,
  gifArgs,
  labelText,
  montageArgs,
  mp4Args,
  outputsAvailable,
  parseArgs,
  parseFfmpegCapabilities,
  parseFfmpegDuration,
  parseFfmpegVersion,
  parseSize,
  publicUrl,
  redact,
  redactDeep,
  secretValues,
  slideshowArgs,
  slideshowList,
  slugify,
} from "./media.mjs";

const spec = {
  out: { type: "string", required: true, describe: "Output directory", placeholder: "dir" },
  headed: { type: "boolean", describe: "Show the browser" },
  "max-mb": { type: "number", default: 10, describe: "Budget" },
  mode: { type: "string", default: "auto", values: ["auto", "screencast", "context"], describe: "Recorder" },
};

describe("parseArgs", () => {
  test("parses values, booleans, numbers, defaults, and --flag=value", () => {
    assert.deepEqual(parseArgs(["--out", "dir", "--headed", "--max-mb=2.5"], spec), { help: false, out: "dir", headed: true, maxMb: 2.5, mode: "auto" });
  });
  test("rejects unknown flags, missing values, bad numbers, bad enums, and missing required flags", () => {
    assert.throws(() => parseArgs(["--out", "dir", "--nope"], spec), (error) => error instanceof UsageError && /unknown argument --nope/.test(error.message));
    assert.throws(() => parseArgs(["stray", "--out", "dir"], spec), /unknown argument stray/);
    assert.throws(() => parseArgs(["--out"], spec), /--out needs a value/);
    assert.throws(() => parseArgs(["--out", "--headed"], spec), /--out needs a value/);
    assert.throws(() => parseArgs(["--out", "dir", "--max-mb", "ten"], spec), /positive number/);
    assert.throws(() => parseArgs(["--out", "dir", "--max-mb", "0"], spec), /positive number/);
    assert.throws(() => parseArgs(["--out", "dir", "--mode", "fast"], spec), /one of auto, screencast, context/);
    assert.throws(() => parseArgs(["--out", "dir", "--headed=yes"], spec), /takes no value/);
    assert.throws(() => parseArgs([], spec), /--out is required/);
  });
  test("--help skips the required check", () => {
    assert.equal(parseArgs(["--help"], spec).help, true);
    assert.equal(parseArgs(["-h"], spec).help, true);
  });
});

describe("usage text", () => {
  test("lists every flag in the spec with its meaning, required marker, and default", () => {
    const text = formatUsage("qa-video.mjs", "record", { summary: "Record it.", spec });
    assert.match(text, /^usage: qa-video\.mjs record --out <dir> \[options\]/);
    for (const flag of Object.keys(spec)) assert.match(text, new RegExp(`--${flag}\\b`));
    assert.match(text, /--out <dir>\s+Output directory \(required\)/);
    assert.match(text, /--max-mb <number>\s+Budget \(default 10\)/);
    assert.match(text, /--headed\s+Show the browser\n/);
    assert.match(text, /--help\s+Print this help/);
  });
  test("lists every command", () => {
    const text = formatCommands("qa-video.mjs", { doctor: { summary: "Check tools" }, record: { summary: "Record" } });
    assert.match(text, /doctor\s+Check tools/);
    assert.match(text, /record\s+Record/);
    assert.match(text, /Exit codes: 0 ok, 1 evidence or step failure, 2 usage or setup error/);
  });
});

describe("parseSize and slugify", () => {
  test("accepts odd sizes and rejects garbage", () => {
    assert.deepEqual(parseSize("1280x720"), { width: 1280, height: 720 });
    assert.deepEqual(parseSize("1281X721"), { width: 1281, height: 721 });
    for (const bad of ["1280", "0x720", "1280x", "axb", "-1x720", "99999x720", "10x10"]) assert.throws(() => parseSize(bad), UsageError, bad);
  });
  test("slugifies to [a-z0-9-] with no edge dashes", () => {
    assert.equal(slugify("Checkout Flow (v2).mjs"), "checkout-flow-v2-mjs");
    assert.equal(slugify("  Ünïcödé — étape 1 "), "unicode-etape-1");
    assert.equal(slugify("!!!"), "");
    assert.match(slugify("a".repeat(80)), /^a{64}$/);
    assert.doesNotMatch(slugify(`${"a".repeat(63)} b`), /-$/);
  });
});

describe("captions", () => {
  test("formats VTT and SRT times", () => {
    assert.equal(formatVttTime(1.5), "00:00:01.500");
    assert.equal(formatSrtTime(1.5), "00:00:01,500");
    assert.equal(formatVttTime(3661.0004), "01:01:01.000");
    assert.equal(formatVttTime(59.9996), "00:01:00.000");
    assert.equal(formatSrtTime(-2), "00:00:00,000");
  });
  test("builds one numbered cue per step with the result", () => {
    const steps = [
      { name: "open", caption: "Open the\nhome page", start: 0.512, end: 1.903, result: "pass" },
      { name: "pay", caption: "Pay --> done", start: 2, end: 2, result: "fail" },
      { name: "plain", start: 3, end: 4, result: "pass" },
    ];
    const { vtt, srt } = buildCaptions(steps);
    assert.equal(
      vtt,
      "WEBVTT\n\n1\n00:00:00.512 --> 00:00:01.903\n1. Open the home page (PASS)\n\n2\n00:00:02.000 --> 00:00:02.001\n2. Pay -> done (FAIL)\n\n3\n00:00:03.000 --> 00:00:04.000\n3. plain (PASS)\n\n",
    );
    assert.equal(srt.split("\n").slice(0, 4).join("\n"), "1\n00:00:00,512 --> 00:00:01,903\n1. Open the home page (PASS)\n");
    assert.equal(buildCaptions([]).vtt, "WEBVTT\n\n");
  });
});

describe("ffmpeg argv", () => {
  test("mp4 uses crf by default and a bitrate cap when re-encoding", () => {
    assert.deepEqual(mp4Args({ input: "a.webm", output: "a.mp4" }), [
      "-y", "-i", "a.webm", "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-movflags", "+faststart", "-an", "a.mp4",
    ]);
    const capped = mp4Args({ input: "a.webm", output: "a.mp4", kbps: 700 });
    assert.ok(!capped.includes("-crf"));
    assert.deepEqual(capped.slice(7, 13), ["-b:v", "700k", "-maxrate", "700k", "-bufsize", "1400k"]);
  });
  test("budget kbps leaves 8% headroom", () => {
    assert.equal(budgetKbps(10 * 1024 * 1024, 60), 1286);
    assert.equal(budgetKbps(1000000, 8), 920);
    assert.equal(budgetKbps(1000000, 0), null);
    assert.equal(budgetKbps(1000, 100000), null);
  });
  test("gif uses a two-pass palette in one filter graph", () => {
    const args = gifArgs({ input: "a.webm", output: "a.gif", fps: 10, width: 800 });
    assert.deepEqual(args.slice(0, 4), ["-y", "-i", "a.webm", "-vf"]);
    assert.equal(args[4], "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle");
    assert.deepEqual(args.slice(5), ["-loop", "0", "a.gif"]);
  });
  test("slideshow list repeats the last file and quotes apostrophes", () => {
    assert.equal(
      slideshowList(["/tmp/a.png", "/tmp/it's/b.png"], 2),
      "file '/tmp/a.png'\nduration 2\nfile '/tmp/it'\\''s/b.png'\nduration 2\nfile '/tmp/it'\\''s/b.png'\n",
    );
    assert.equal(slideshowList([], 2), "");
    assert.deepEqual(slideshowArgs({ list: "l.txt", output: "s.mp4" }), [
      "-y", "-f", "concat", "-safe", "0", "-i", "l.txt", "-vf", "fps=25,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v", "libx264", "-movflags", "+faststart", "s.mp4",
    ]);
  });
});

describe("ImageMagick argv", () => {
  test("escapes % and neutralizes a leading @", () => {
    assert.equal(escapeMagickLabel("100% done"), "100%% done");
    assert.equal(escapeMagickLabel("@/etc/passwd"), " @/etc/passwd");
    assert.equal(labelText(2, { caption: "50% off @home", result: "fail" }), "2. 50%% off @home (FAIL)");
  });
  test("montage uses the magick subcommand only for IM7 and tiles at most 3 wide", () => {
    const images = [{ path: "a.png", label: "1. a (PASS)" }, { path: "b.png", label: "2. b (FAIL)" }];
    assert.deepEqual(montageArgs({ images, output: "s.png", flavor: "montage" }), [
      "-label", "1. a (PASS)", "a.png", "-label", "2. b (FAIL)", "b.png", "-tile", "2x", "-geometry", "480x270+12+12",
      "-background", "#1f2328", "-fill", "#ffffff", "-pointsize", "18", "s.png",
    ]);
    const five = Array.from({ length: 5 }, (_, index) => ({ path: `${index}.png`, label: String(index) }));
    const args = montageArgs({ images: five, output: "s.png", flavor: "magick" });
    assert.equal(args[0], "montage");
    assert.equal(args[args.indexOf("-tile") + 1], "3x");
  });
});

const playwrightEncoders = ` V..... = Video
 A..... = Audio
 ------
 VF...D png                  PNG (Portable Network Graphics) image
 V....D libvpx               libvpx VP8 (codec vp8)`;
const playwrightFilters = `Filters:
  T.. = Timeline support
  V = Video input/output
  | = Source or sink filter
 ..C crop              V->V       Crop the input video.
 ..C scale             V->V       Scale the input video size and/or convert the image format.`;
const playwrightDemuxers = ` D.. = Demuxing supported
 ..d = Is a device
 ---
 D   image2pipe      piped image2 sequence
 D   matroska,webm   Matroska / WebM`;
const fullEncoders = `Encoders:
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D gif                  GIF (Graphics Interchange Format)`;
const fullFilters = ` TSC fps               V->V       Force constant framerate.
 ... palettegen        V->V       Find the optimal palette for a given stream.
 ... paletteuse        VV->V      Use a palette to downsample an input video stream.
 ..C scale             V->V       Scale the input video size and/or convert the image format.
 ... split             V->N       Pass on the input to N video outputs.`;
const fullDemuxers = ` D   concat          Virtual concatenation script
 D d avfoundation    AVFoundation input device
 D   mov,mp4,m4a,3gp,3g2,mj2 QuickTime / MOV`;

describe("ffmpeg capabilities", () => {
  test("the Playwright build can do none of the finish outputs", () => {
    const caps = parseFfmpegCapabilities({ encoders: playwrightEncoders, filters: playwrightFilters, decoders: " V....D mjpeg  MJPEG\n", demuxers: playwrightDemuxers });
    assert.deepEqual(caps, {
      encoders: { libx264: false, gif: false },
      filters: { palettegen: false, paletteuse: false, scale: true, fps: false, split: false },
      decoders: { png: false },
      demuxers: { concat: false },
    });
    assert.deepEqual(outputsAvailable({ webm: true, ffmpeg: caps, imagemagick: false }), { webm: true, vtt: true, srt: true, mp4: false, gif: false, slideshow: false, sheet: false });
  });
  test("a full build enables mp4, gif, and slideshow", () => {
    const caps = parseFfmpegCapabilities({ encoders: fullEncoders, filters: fullFilters, decoders: " VFS..D png                  PNG image\n", demuxers: fullDemuxers });
    assert.equal(caps.encoders.libx264, true);
    assert.equal(caps.encoders.gif, true);
    assert.equal(Object.values(caps.filters).every(Boolean), true);
    assert.equal(caps.decoders.png, true);
    assert.equal(caps.demuxers.concat, true);
    assert.deepEqual(outputsAvailable({ webm: true, ffmpeg: caps, imagemagick: true }), { webm: true, vtt: true, srt: true, mp4: true, gif: true, slideshow: true, sheet: true });
  });
  test("no ffmpeg at all still allows webm and captions", () => {
    assert.deepEqual(parseFfmpegCapabilities().encoders, { libx264: false, gif: false });
    assert.deepEqual(outputsAvailable({ webm: false }), { webm: false, vtt: true, srt: true, mp4: false, gif: false, slideshow: false, sheet: false });
  });
  test("reads the version token", () => {
    assert.equal(parseFfmpegVersion("ffmpeg version n7.0.1-playwright-build-1011 Copyright (c) 2000-2024"), "n7.0.1-playwright-build-1011");
    assert.equal(parseFfmpegVersion(""), null);
  });
  test("reads the input duration, else the last progress time", () => {
    assert.equal(parseFfmpegDuration("Input #0, matroska,webm\n  Duration: 00:01:03.96, start: 0.000000"), 63.96);
    assert.equal(parseFfmpegDuration("  Duration: N/A, start: 0.000000\nframe=10 time=00:00:01.20 bitrate\nframe=99 time=00:00:03.96 bitrate"), 3.96);
    assert.equal(parseFfmpegDuration("no timing here"), null);
  });
});

describe("publicUrl", () => {
  test("keeps origin and path, drops credentials, query, and fragment", () => {
    assert.equal(publicUrl("https://preview.example.app/?x-vercel-protection-bypass=sentinel&x=1#top"), "https://preview.example.app");
    assert.equal(publicUrl("https://user:pw@preview.example.app/cart?token=abc"), "https://preview.example.app/cart");
    assert.equal(publicUrl("http://127.0.0.1:4173"), "http://127.0.0.1:4173");
    assert.equal(publicUrl("not a url?token=abc"), "not a url");
    assert.equal(publicUrl(null), null);
  });
});

describe("compareVersions", () => {
  test("ignores prerelease suffixes and compares numerically", () => {
    assert.equal(compareVersions("1.64.0-alpha-1790635538000", "1.59.0"), 1);
    assert.equal(compareVersions("1.59", "1.59.0"), 0);
    assert.equal(compareVersions("1.58.2", "1.59.0"), -1);
    assert.equal(compareVersions("1.100.0", "1.59.0"), 1);
    assert.equal(compareVersions("v2.0.0", "1.99.99"), 1);
    assert.equal(compareVersions(null, "1.0.0"), -1);
  });
});

describe("redact", () => {
  const env = { QA_PASSWORD: "sentinel-7f3a9c", API_KEY: "a.b*c+", SHORT_TOKEN: "abc", HOME: "/Users/me", COOKIE_JAR: "sentinel" };
  test("replaces secret-named values of length 4 or more, literally, longest first", () => {
    assert.deepEqual(secretValues(env), ["sentinel-7f3a9c", "sentinel", "a.b*c+"]);
    assert.equal(redact("pw sentinel-7f3a9c and sentinel and a.b*c+ and abc in /Users/me", env), "pw [redacted] and [redacted] and [redacted] and abc in /Users/me");
    assert.equal(redact("aXbYc", env), "aXbYc");
    assert.equal(redact(undefined, env), "");
  });
  test("walks objects and arrays without touching keys or non-strings", () => {
    assert.deepEqual(redactDeep({ list: ["x sentinel-7f3a9c"], sentinel: 4, ok: true }, env), { list: ["x [redacted]"], sentinel: 4, ok: true });
  });
  test("leaves names and paths verbatim so a short secret cannot rename evidence", () => {
    const short = { QA_PASSWORD: "home" };
    const manifest = { scenario: "home-flow", video: "home-flow.webm", warnings: ["login typed home"], steps: [{ name: "home", caption: "home page", screenshot: "home-flow-home.png", error: "saw home" }], outputs: { webm: { path: "home-flow.webm", reason: "home" } } };
    assert.deepEqual(redactDeep(manifest, short), {
      scenario: "home-flow", video: "home-flow.webm", warnings: ["login typed [redacted]"],
      steps: [{ name: "home", caption: "[redacted] page", screenshot: "home-flow-home.png", error: "saw [redacted]" }],
      outputs: { webm: { path: "home-flow.webm", reason: "[redacted]" } },
    });
  });
});

const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const webm = [0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0];
const mp4 = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70];
const gif = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const goodManifest = () => ({
  version: 1,
  scenario: "demo",
  duration: 5,
  video: "demo.webm",
  steps: [
    { name: "one", caption: "One", start: 0.5, end: 1.5, result: "pass", screenshot: "demo-one.png", error: null, sensitive: false },
    { name: "two", caption: "Two", start: 1.6, end: 2.4, result: "pass", screenshot: "demo-two.png", error: null, sensitive: false },
  ],
  outputs: { webm: { path: "demo.webm", bytes: 900, status: "produced" }, mp4: { path: "demo.mp4", bytes: 20, status: "produced" } },
  warnings: [],
});
const goodFacts = () => ({
  "demo.webm": { exists: true, bytes: 900, head: webm },
  "demo-one.png": { exists: true, bytes: 50, head: png },
  "demo-two.png": { exists: true, bytes: 50, head: png },
  "demo.mp4": { exists: true, bytes: 20, head: mp4 },
});

describe("checkManifest", () => {
  test("passes a consistent manifest", () => {
    assert.deepEqual(checkManifest(goodManifest(), goodFacts()), { ok: true, errors: [], warnings: [], steps: 2, passed: 2, failed: 0 });
    assert.equal(checkManifest(JSON.stringify(goodManifest()), goodFacts()).ok, true);
  });
  test("rejects unparsable and non-object manifests", () => {
    assert.match(checkManifest("{oops", {}).errors[0], /not valid JSON/);
    assert.deepEqual(checkManifest("[]", {}).errors, ["manifest is not a JSON object"]);
  });
  test("reports missing fields, empty steps, and bad video files", () => {
    assert.deepEqual(checkManifest({ duration: 1 }, {}).errors, ["manifest has no scenario", "manifest has no video", "manifest has no steps"]);
    const empty = { ...goodManifest(), steps: [] };
    assert.ok(checkManifest(empty, goodFacts()).errors.includes("manifest has an empty steps list"));
    const facts = goodFacts();
    facts["demo.webm"] = { exists: true, bytes: 0, head: [] };
    assert.ok(checkManifest(goodManifest(), facts).errors.includes("video demo.webm is empty"));
    facts["demo.webm"] = { exists: true, bytes: 900, head: png };
    assert.ok(checkManifest(goodManifest(), facts).errors.includes("video demo.webm is not a WebM file"));
    delete facts["demo.webm"];
    assert.ok(checkManifest(goodManifest(), facts).errors.includes("video demo.webm is missing"));
  });
  test("reports step order, timing, duplicate, and screenshot problems", () => {
    const manifest = goodManifest();
    manifest.steps.push({ ...manifest.steps[0] });
    manifest.steps.push({ name: "late", start: 1, end: 9, result: "pass", screenshot: "demo-late.png" });
    manifest.steps.push({ name: "back", start: 3, end: 2, result: "fail", screenshot: "demo-two.png" });
    manifest.steps.push({ name: "shot", start: 3, end: 3.5, result: "pass", screenshot: null });
    const facts = { ...goodFacts(), "demo-late.png": { exists: true, bytes: 10, head: gif } };
    const { errors, warnings, failed } = checkManifest(manifest, facts);
    assert.ok(errors.includes("duplicate step name one"));
    assert.ok(errors.includes("step 3 (one) starts before the previous step"));
    assert.ok(errors.includes("step 4 (late) ends after the video (9 > 5)"));
    assert.ok(errors.includes("step 4 (late) screenshot demo-late.png is not a PNG file"));
    assert.ok(errors.includes("step 5 (back) starts after it ends"));
    assert.ok(errors.includes("step 6 (shot) has no screenshot"));
    assert.equal(failed, 1);
    assert.deepEqual(warnings, ["1 step failed"]);
  });
  test("allows 0.5 s of slack at the end of the video", () => {
    const manifest = goodManifest();
    manifest.steps[1].end = 5.4;
    assert.equal(checkManifest(manifest, goodFacts()).ok, true);
  });
  test("checks produced outputs against the disk and warns over budget", () => {
    const manifest = goodManifest();
    manifest.outputs.gif = { path: "demo.gif", bytes: 3000, status: "over-budget" };
    manifest.outputs.sheet = { path: "demo-sheet.png", status: "skipped", reason: "no ImageMagick" };
    const facts = { ...goodFacts(), "demo.mp4": { exists: true, bytes: 21, head: mp4 } };
    const result = checkManifest(manifest, facts, { maxBytes: 1000 });
    assert.deepEqual(result.errors, ["output mp4 demo.mp4 is 21 bytes, the manifest says 20"]);
    assert.deepEqual(result.warnings, ["output gif demo.gif is 0.0 MB, over the attachment budget of 0.0 MB"]);
    facts["demo.mp4"] = { exists: true, bytes: 20, head: png };
    assert.deepEqual(checkManifest(manifest, facts).errors, ["output mp4 demo.mp4 is not a MP4 file"]);
    delete facts["demo.mp4"];
    assert.deepEqual(checkManifest(manifest, facts).errors, ["output mp4 demo.mp4 is missing"]);
  });
  test("warns on a zero duration", () => {
    const manifest = { ...goodManifest(), duration: 0, steps: [{ ...goodManifest().steps[0], start: 0, end: 0.2 }] };
    assert.deepEqual(checkManifest(manifest, goodFacts()).warnings, ["duration is 0"]);
  });
});
