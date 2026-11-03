import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { brokenTool, cliRunner, fakeTool, makeScratch, noTools, syntheticEvidence, writer } from "./fixtures.mjs";

const scratch = makeScratch("qa-video-finish-test-");
const runCli = cliRunner(scratch);
const write = writer(scratch);
const posix = process.platform !== "win32";
const log = join(scratch, "fake.log");
const megabyte = 1024 * 1024;
const finish = async (manifestPath, flags, extraEnv = {}) => {
  const result = await runCli(["finish", "--manifest", manifestPath, ...flags], { ...noTools, FAKE_LOG: log, ...extraEnv });
  return { ...result, ...JSON.parse(result.stdout) };
};

describe("finish and check tool reasons", { skip: !posix && "the fake tools are POSIX scripts" }, () => {
  test("--ffmpeg with a bare name that is not found never runs <cwd>/<name>", async () => {
    write("nothere", fakeTool, 0o755);
    writeFileSync(log, "");
    const { manifestPath } = syntheticEvidence(scratch, "bare-name");
    const { status, outputs } = await finish(manifestPath, ["--mp4", "--ffmpeg", "nothere"]);
    assert.equal(status, 0);
    assert.equal(outputs.mp4.status, "skipped");
    assert.match(outputs.mp4.reason, /^--ffmpeg nothere not found on PATH; mp4 needs an ffmpeg with libx264$/);
    assert.equal(readFileSync(log, "utf8"), "", "the cwd copy ran");
  });

  test("a missing, a failing, and an incapable ffmpeg each get their own reason", async () => {
    const { manifestPath } = syntheticEvidence(scratch, "reasons");
    const missing = await finish(manifestPath, ["--mp4"]);
    assert.match(missing.outputs.mp4.reason, /^ffmpeg not found on PATH \(pass --ffmpeg, set FFMPEG_PATH, or put it on PATH\)/);
    const broken = write("tools/broken-ffmpeg", brokenTool, 0o755);
    const failing = await finish(manifestPath, ["--mp4"], { FFMPEG_PATH: broken });
    assert.equal(failing.outputs.mp4.status, "skipped");
    assert.equal(failing.outputs.mp4.reason, `ffmpeg at ${broken} failed: -version exited 1: dyld: Library not loaded: libx265.so; mp4 needs an ffmpeg with libx264`);
    const bare = write("tools/bare-ffmpeg", "#!/bin/sh\n[ \"$1\" = -version ] && echo 'ffmpeg version 7.1-minimal'\nexit 0\n", 0o755);
    const incapable = await finish(manifestPath, ["--mp4", "--gif"], { FFMPEG_PATH: bare });
    assert.equal(incapable.outputs.mp4.reason, `ffmpeg at ${bare} lacks the libx264 encoder; mp4 needs an ffmpeg with libx264`);
    assert.match(incapable.outputs.gif.reason, /lacks the gif encoder, the palettegen filter, .*the scale filter; gif needs/);
    const unknownFlagPath = await finish(manifestPath, ["--mp4", "--ffmpeg", join(scratch, "absent", "ffmpeg")]);
    assert.match(unknownFlagPath.outputs.mp4.reason, /^--ffmpeg .+absent\/ffmpeg not found; mp4 needs/);
  });

  test("with mp4 skipped the webm is what gets attached, never a no-video note", async () => {
    const { manifestPath } = syntheticEvidence(scratch, "attach-webm");
    const finished = await finish(manifestPath, ["--mp4", "--gif", "--sheet"]);
    assert.equal(finished.status, 0);
    assert.equal(finished.outputs.webm.status, "produced");
    assert.equal(finished.attach.path, "demo.webm");
    assert.equal(finished.attach.output, "webm");
    assert.match(finished.attach.reason, /^mp4 skipped: ffmpeg not found/);
    const checked = JSON.parse((await runCli(["check", "--manifest", manifestPath])).stdout);
    assert.equal(checked.ok, true);
    assert.deepEqual(checked.attach, finished.attach);
    assert.deepEqual(checked.outputs.webm, { path: "demo.webm", status: "produced", reason: null });
    assert.equal(checked.outputs.mp4.status, "skipped");
    assert.match(checked.outputs.mp4.reason, /^ffmpeg not found/);
  });

  test("a webm over --max-mb is over-budget with what to do, and the gif is attached instead", async () => {
    const bin = join(scratch, "fakebin");
    write("fakebin/ffmpeg", fakeTool, 0o755);
    const { manifestPath } = syntheticEvidence(scratch, "big-webm", { webmBytes: 4 * megabyte });
    const alone = await finish(manifestPath, ["--max-mb", "3"]);
    assert.equal(alone.outputs.webm.status, "over-budget");
    assert.match(alone.outputs.webm.reason, /^4\.0 MB is over --max-mb 3; re-record a shorter scenario, or attach the gif \(finish --gif\)$/);
    assert.equal(alone.attach.path, null);
    assert.match(alone.attach.reason, /over the attachment budget/);
    assert.doesNotMatch(alone.attach.reason, /no video/);
    const withGif = await finish(manifestPath, ["--gif", "--max-mb", "3"], { PATH: `${bin}:${noTools.PATH}`, FAKE_MODE: "big" });
    assert.equal(withGif.outputs.gif.status, "produced");
    assert.equal(withGif.attach.path, "demo.gif");
    assert.match(withGif.attach.reason, /webm over-budget: 4\.0 MB/);
    const roomy = await finish(manifestPath, ["--max-mb", "10"]);
    assert.equal(roomy.outputs.webm.status, "produced");
  });

  test("only a missing, empty, or failed webm reads no video", async () => {
    const { directory, manifestPath } = syntheticEvidence(scratch, "no-webm");
    rmSync(join(directory, "demo.webm"));
    const finished = await finish(manifestPath, ["--mp4"]);
    assert.equal(finished.outputs.webm.status, "failed");
    assert.equal(finished.attach.path, null);
    assert.match(finished.attach.reason, /^no video: video demo\.webm is missing/);
    const checked = await runCli(["check", "--manifest", manifestPath]);
    assert.equal(checked.status, 1);
    assert.match(JSON.parse(checked.stdout).attach.reason, /^no video: /);
  });

  test("an empty webm reads empty, not missing, and mp4 is not attempted from it", async () => {
    write("fakebin-empty/ffmpeg", fakeTool, 0o755);
    writeFileSync(log, "");
    const { directory, manifestPath } = syntheticEvidence(scratch, "empty-webm");
    writeFileSync(join(directory, "demo.webm"), "");
    const finished = await finish(manifestPath, ["--mp4"], { PATH: `${join(scratch, "fakebin-empty")}:${noTools.PATH}` });
    assert.equal(finished.status, 1);
    assert.deepEqual(finished.outputs.webm, { path: "demo.webm", bytes: 0, status: "failed", reason: "video demo.webm is empty" });
    assert.deepEqual(finished.outputs.mp4, { path: "demo.mp4", bytes: 0, status: "failed", reason: "video demo.webm is empty" });
    assert.equal(finished.attach.reason, "no video: video demo.webm is empty");
    assert.equal(readFileSync(log, "utf8"), "", "ffmpeg ran on an empty webm");
  });
});
