import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseFfmpegCapabilities } from "./media.mjs";
import { encoderVerdicts, missingCapabilities, outputReport, pickAttachment, unavailableReason } from "./outputs.mjs";

const full = {
  encoders: { libx264: true, gif: true },
  filters: { palettegen: true, paletteuse: true, scale: true, fps: true, split: true },
  decoders: { png: true },
  demuxers: { concat: true },
};
const webmOnly = { ...full, encoders: { libx264: false, gif: false }, filters: { ...full.filters, palettegen: false }, decoders: { png: false } };

describe("missingCapabilities", () => {
  test("names each missing piece per output and nothing for a full build", () => {
    assert.deepEqual(missingCapabilities("mp4", webmOnly), ["the libx264 encoder"]);
    assert.deepEqual(missingCapabilities("gif", webmOnly), ["the gif encoder", "the palettegen filter"]);
    assert.deepEqual(missingCapabilities("slideshow", webmOnly), ["the libx264 encoder", "the png decoder"]);
    for (const key of ["mp4", "gif", "slideshow"]) assert.deepEqual(missingCapabilities(key, full), []);
  });
});

describe("unavailableReason", () => {
  const empty = parseFfmpegCapabilities();
  test("keeps missing, failing, and incapable ffmpeg apart", () => {
    assert.equal(unavailableReason("mp4", { ffmpeg: { state: "missing", path: null, capabilities: empty, error: "ffmpeg not found on PATH" } }), "ffmpeg not found on PATH; mp4 needs an ffmpeg with libx264");
    assert.equal(
      unavailableReason("mp4", { ffmpeg: { state: "failed", path: "/x/ffmpeg", capabilities: empty, error: "-version exited 1: boom" } }),
      "ffmpeg at /x/ffmpeg failed: -version exited 1: boom; mp4 needs an ffmpeg with libx264",
    );
    assert.equal(unavailableReason("mp4", { ffmpeg: { state: "ok", path: "/x/ffmpeg", capabilities: webmOnly, error: null } }), "ffmpeg at /x/ffmpeg lacks the libx264 encoder; mp4 needs an ffmpeg with libx264");
  });
  test("an unprobed ffmpeg and a missing ImageMagick still read as not found", () => {
    assert.match(unavailableReason("gif", {}), /^ffmpeg not found; gif needs/);
    assert.equal(unavailableReason("sheet", { magick: { path: null, error: "ImageMagick not found at /m" } }), "ImageMagick not found at /m; sheet needs ImageMagick (magick or montage)");
    assert.match(unavailableReason("sheet", {}), /^ImageMagick not found; sheet needs/);
  });
});

describe("encoderVerdicts", () => {
  test("pairs each output with a reason only when it cannot be made", () => {
    const verdicts = encoderVerdicts({ ffmpeg: { state: "ok", path: "/f", capabilities: webmOnly, error: null }, magick: { path: "/m", flavor: "magick", error: null } });
    assert.deepEqual({ ...verdicts, reasons: undefined }, { mp4: false, gif: false, slideshow: false, sheet: true, reasons: undefined });
    assert.equal(verdicts.reasons.sheet, null);
    assert.match(verdicts.reasons.mp4, /lacks the libx264 encoder/);
  });
});

describe("pickAttachment", () => {
  const produced = (path) => ({ path, bytes: 10, status: "produced" });
  test("prefers the mp4, then the webm, then the gif", () => {
    assert.deepEqual(pickAttachment({ webm: produced("a.webm"), mp4: produced("a.mp4") }), { path: "a.mp4", output: "mp4", reason: null });
    assert.deepEqual(pickAttachment({ webm: produced("a.webm"), mp4: { path: "a.mp4", bytes: 0, status: "skipped", reason: "ffmpeg not found" } }), {
      path: "a.webm", output: "webm", reason: "mp4 skipped: ffmpeg not found",
    });
    assert.deepEqual(pickAttachment({ webm: produced("a.webm") }), { path: "a.webm", output: "webm", reason: "mp4 not requested" });
    const big = { path: "a.webm", bytes: 99, status: "over-budget", reason: "99 MB is over --max-mb 10" };
    assert.equal(pickAttachment({ webm: big, gif: produced("a.gif") }).path, "a.gif");
  });
  test("with a webm on disk the reason is never no video", () => {
    const big = { path: "a.webm", bytes: 99, status: "over-budget", reason: "99 MB is over --max-mb 10" };
    const pick = pickAttachment({ webm: big, mp4: { path: "a.mp4", bytes: 99, status: "over-budget", reason: "too big" } });
    assert.equal(pick.path, null);
    assert.match(pick.reason, /^every video output is over the attachment budget/);
    assert.match(pick.reason, /cite a\.webm/);
  });
  test("a missing or failed webm is the only no video", () => {
    assert.deepEqual(pickAttachment({ webm: { path: "a.webm", bytes: 0, status: "failed", reason: "the recorder wrote no video" } }), { path: null, output: null, reason: "no video: the recorder wrote no video" });
    assert.equal(pickAttachment({}).reason, "no video: the manifest lists no webm output");
  });
});

describe("outputReport", () => {
  const facts = { "a.webm": { exists: true, bytes: 900, head: [0x1a, 0x45, 0xdf, 0xa3] }, "a.mp4": { exists: true, bytes: 20, head: [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70] } };
  test("verifies produced outputs on disk and carries every other status with its reason", () => {
    const outputs = {
      webm: { path: "a.webm", bytes: 900, status: "produced" },
      mp4: { path: "a.mp4", bytes: 21, status: "produced" },
      gif: { path: "a.gif", bytes: 0, status: "skipped", reason: "ffmpeg not found" },
      sheet: "junk",
    };
    assert.deepEqual(outputReport(outputs, facts, 1), {
      webm: { path: "a.webm", status: "produced", reason: null },
      mp4: { path: "a.mp4", status: "failed", reason: "output mp4 a.mp4 is 20 bytes, the manifest says 21" },
      gif: { path: "a.gif", status: "skipped", reason: "ffmpeg not found" },
    });
    assert.deepEqual(outputReport({ webm: outputs.webm }, facts, 0.0005).webm, { path: "a.webm", status: "over-budget", reason: "0.0 MB is over --max-mb 0.0005" });
    assert.deepEqual(outputReport({ webm: outputs.webm }, {}, 1).webm, { path: "a.webm", status: "failed", reason: "output webm a.webm is missing" });
    assert.deepEqual(outputReport(undefined, facts, 1), {});
  });
});
