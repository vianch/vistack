import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";

import { brokenTool, fakeTool, makeScratch, writer } from "./fixtures.mjs";
import { executableNames, findFfprobe, findMagick, locate, probeFfmpeg, toolDirs, which } from "./toolchain.mjs";

const scratch = makeScratch("qa-video-toolchain-test-");
const write = writer(scratch);
const posix = process.platform !== "win32";

describe("tool directories and names", () => {
  test("search Homebrew, /usr/local, and MacPorts after PATH unless QA_VIDEO_TOOL_DIRS overrides them", () => {
    assert.deepEqual(toolDirs({}, "darwin"), ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"]);
    assert.deepEqual(toolDirs({}, "win32"), []);
    assert.deepEqual(toolDirs({ QA_VIDEO_TOOL_DIRS: "" }, "linux"), []);
    assert.deepEqual(toolDirs({ QA_VIDEO_TOOL_DIRS: ["/a", "/b"].join(posix ? ":" : ";") }, "linux"), ["/a", "/b"]);
  });
  test("Windows names carry the PATHEXT extensions, ffprobe included", () => {
    assert.deepEqual(executableNames("ffprobe", "win32", {}), ["ffprobe.exe", "ffprobe.cmd"]);
    assert.deepEqual(executableNames("ffprobe", "win32", { PATHEXT: ".COM;.EXE" }), ["ffprobe.com", "ffprobe.exe"]);
    assert.deepEqual(executableNames("ffprobe", "darwin", {}), ["ffprobe"]);
  });
  test("a Windows name that already carries a PATHEXT extension is taken as given", () => {
    assert.deepEqual(executableNames("ffmpeg.exe", "win32", {}), ["ffmpeg.exe"]);
    assert.deepEqual(executableNames("ffmpeg.EXE", "win32", { PATHEXT: ".COM;.EXE" }), ["ffmpeg.EXE"]);
    assert.deepEqual(executableNames("ffmpeg", "win32", { Pathext: ".BAT" }), ["ffmpeg.bat"]);
  });
});

describe("lookup", { skip: !posix && "the fake tools are POSIX scripts" }, () => {
  const homebrew = join(scratch, "brew", "bin");
  const env = { PATH: join(scratch, "empty"), QA_VIDEO_TOOL_DIRS: homebrew };
  for (const tool of ["ffmpeg", "ffprobe", "montage"]) write(`brew/bin/${tool}`, fakeTool, 0o755);
  write("cwd-copy", fakeTool, 0o755);

  test("which falls back to the tool directories when PATH lacks the tool", () => {
    assert.equal(which("ffmpeg", env), join(homebrew, "ffmpeg"));
    assert.equal(which("ffmpeg", { ...env, QA_VIDEO_TOOL_DIRS: "" }), null);
  });
  test("which reads a Windows-style Path key as PATH", () => {
    assert.equal(which("ffmpeg", { Path: homebrew, QA_VIDEO_TOOL_DIRS: "" }), join(homebrew, "ffmpeg"));
  });
  test("on win32 which finds ffmpeg.exe by its bare or full name, never ffmpeg.exe.exe", () => {
    const windowsBin = join(scratch, "windows-bin");
    write("windows-bin/ffmpeg.exe", fakeTool, 0o755);
    const windowsEnv = { Path: windowsBin, QA_VIDEO_TOOL_DIRS: "", PATHEXT: ".EXE;.CMD" };
    assert.equal(which("ffmpeg.exe", windowsEnv, "win32"), join(windowsBin, "ffmpeg.exe"));
    assert.equal(which("ffmpeg", windowsEnv, "win32"), join(windowsBin, "ffmpeg.exe"));
    assert.equal(locate("ffmpeg.exe", windowsEnv, "win32"), join(windowsBin, "ffmpeg.exe"));
  });
  test("locate takes a path as given and a bare name only from PATH or the tool directories, never the cwd", () => {
    const original = process.cwd();
    process.chdir(scratch);
    try {
      assert.equal(locate("cwd-copy", env), null);
      assert.equal(locate("./cwd-copy", env), join(scratch, "cwd-copy"));
    } finally {
      process.chdir(original);
    }
    assert.equal(locate(join(scratch, "cwd-copy"), env), join(scratch, "cwd-copy"));
    assert.equal(locate(join(scratch, "absent"), env), null);
  });
  test("ffprobe sits next to ffmpeg, else on the search path; ImageMagick falls back to montage", () => {
    assert.equal(findFfprobe(join(homebrew, "ffmpeg"), env), join(homebrew, "ffprobe"));
    assert.equal(findFfprobe(null, env), join(homebrew, "ffprobe"));
    assert.deepEqual(findMagick(undefined, env), { flavor: "montage", path: join(homebrew, "montage"), error: null });
    assert.deepEqual(findMagick("magick", env), { flavor: null, path: null, error: `ImageMagick not found at magick` });
    assert.match(findMagick(undefined, { PATH: join(scratch, "empty"), QA_VIDEO_TOOL_DIRS: "" }).error, /^ImageMagick not found on PATH$/);
  });

  test("probeFfmpeg reports ok, missing, and failing builds with the probe that failed", async () => {
    const ok = await probeFfmpeg(undefined, env);
    assert.equal(ok.state, "ok");
    assert.equal(ok.version, "9.9-fake");
    assert.equal(ok.capabilities.encoders.libx264, true);
    const missing = await probeFfmpeg(undefined, { ...env, QA_VIDEO_TOOL_DIRS: "" });
    assert.deepEqual({ state: missing.state, path: missing.path }, { state: "missing", path: null });
    assert.equal(missing.error, "ffmpeg not found on PATH (pass --ffmpeg, set FFMPEG_PATH, or put it on PATH)");
    assert.equal(ok.error, null);
    assert.equal((await probeFfmpeg(undefined, { ...env, PATH: "", QA_VIDEO_TOOL_DIRS: "/nope" })).error, "ffmpeg not found on PATH or in /nope (pass --ffmpeg, set FFMPEG_PATH, or put it on PATH)");
    assert.equal((await probeFfmpeg(undefined, { ...env, FFMPEG_PATH: join(scratch, "gone") })).error, `FFMPEG_PATH ${join(scratch, "gone")} not found`);
    const broken = write("broken-ffmpeg", brokenTool, 0o755);
    const failing = await probeFfmpeg(broken, env);
    assert.deepEqual({ state: failing.state, path: failing.path, error: failing.error }, { state: "failed", path: broken, error: "-version exited 1: dyld: Library not loaded: libx265.so" });
    const listFails = write("list-fails", "#!/bin/sh\n[ \"$1\" = -version ] && { echo 'ffmpeg version 1'; exit 0; }\necho 'Unrecognized option' >&2\nexit 8\n", 0o755);
    assert.match((await probeFfmpeg(listFails, env)).error, /^-hide_banner -encoders exited 8: Unrecognized option$/);
  });
});
