import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { clip, errorText, firstLine, outputsAvailable } from "./media.mjs";
import { encoderVerdicts } from "./outputs.mjs";
import { browsersReport, playwrightInstall, resolvePlaywright } from "./resolve.mjs";
import { findFfprobe, findMagick, probeFfmpeg, toolInstall } from "./toolchain.mjs";

const failureText = (error) => clip(firstLine(errorText(error)), 300);

const recordProbe = async (browser) => {
  const directory = mkdtempSync(join(tmpdir(), "qa-video-doctor-"));
  try {
    const context = await browser.newContext({ recordVideo: { dir: directory, size: { width: 320, height: 240 } } });
    const page = await context.newPage();
    await page.goto("about:blank");
    await sleep(1000);
    await context.close();
    const video = await page.video()?.path();
    return video && existsSync(video) && statSync(video).size > 0 ? { ok: true, reason: null } : { ok: false, reason: "recordVideo wrote no video file" };
  } catch (error) {
    return { ok: false, reason: failureText(error) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

// Headless runs use a separate headless-shell binary, so only a real launch and a real recording prove the recorder.
const probeBrowser = async (browserType) => {
  let browser;
  try {
    browser = await browserType.launch({ headless: true, timeout: 30000 });
  } catch (error) {
    const launch = failureText(error);
    return { launch, recorder: { ok: false, reason: `the browser did not launch: ${launch}` } };
  }
  try {
    return { launch: "ok", recorder: await recordProbe(browser) };
  } finally {
    await browser.close().catch(() => {});
  }
};

const installCommand = (playwright, browser, env) =>
  `${env.PLAYWRIGHT_BROWSERS_PATH ? `PLAYWRIGHT_BROWSERS_PATH=${env.PLAYWRIGHT_BROWSERS_PATH} ` : ""}node "${join(playwright.path, "cli.js")}" install ${browser}`;

const playwrightHint = (playwright) => {
  const pointAt = "pass --playwright <absolute path to the repository's node_modules/playwright or node_modules/@playwright/test>";
  if (playwright.source !== "cwd") return `Playwright ${playwright.reason} (from ${playwright.source === "flag" ? "--playwright" : "QA_VIDEO_PLAYWRIGHT"}): ${pointAt}`;
  if (playwright.resolvedFrom) return `Playwright ${playwright.reason}: ${pointAt}`;
  return `Playwright ${playwright.reason}, after ${playwright.candidatesTried.length} candidates (playwright.candidatesTried): run from the consuming repository, set QA_VIDEO_PLAYWRIGHT, or ${pointAt}. To add it: ${playwrightInstall}`;
};

const recorderHint = ({ options, env, playwright, browser, browsers, recorder }) => {
  const install = installCommand(playwright, options.browser, env);
  const missing = [...(browsers[options.browser]?.missing ?? []), ...browsers.ffmpeg.missing];
  if (missing.length) return `Playwright ${playwright.version} at ${playwright.path} expects ${missing.join(", ")} in ${browsers.cache}, which lacks them: ${install}`;
  if (browser.launch && browser.launch !== "ok") return `the ${options.browser} build for Playwright ${playwright.version} does not launch (${browser.launch}): ${install}`;
  return `recordVideo fails (${recorder.reason}); ${install} reinstalls the browser and the ffmpeg build the recorder uses`;
};

const doctorHints = (facts) => {
  const { playwright, recorder, ffmpeg, magick, outputs, browsers } = facts;
  const hints = [];
  if (!playwright.found) hints.push(playwrightHint(playwright));
  else if (!recorder.ok) hints.push(recorderHint(facts));
  if (ffmpeg.state === "failed") hints.push(`ffmpeg at ${ffmpeg.path} failed (${ffmpeg.error}): repair it, or point --ffmpeg or FFMPEG_PATH at a working build`);
  const tools = [...(outputs.mp4 && outputs.gif && outputs.slideshow ? [] : ["ffmpeg"]), ...(magick.path ? [] : ["imagemagick"])];
  if (tools.length && ffmpeg.state !== "failed") hints.push(`for mp4, gif, slideshow, and sheet outputs: ${toolInstall(tools)}`);
  if (ffmpeg.state === "missing" && browsers.ffmpeg.path) hints.push(`the ffmpeg bundled with Playwright (${browsers.ffmpeg.path}) is a minimal build without libx264 or gif and is not usable for finish`);
  return hints;
};

export const doctorReport = async (options, env, cwd = process.cwd()) => {
  const playwright = await resolvePlaywright(options.playwright, { env, cwd });
  const browserType = playwright.api?.[options.browser];
  let executable = null;
  try {
    executable = browserType?.executablePath() ?? null;
  } catch {}
  const unavailable = playwright.found ? `Playwright ${playwright.version} has no ${options.browser} browser type` : `Playwright ${playwright.reason}`;
  const probe = browserType ? await probeBrowser(browserType) : { launch: null, recorder: { ok: false, reason: unavailable } };
  const browser = { name: options.browser, executable, exists: Boolean(executable && existsSync(executable)), launch: probe.launch };
  const browsers = browsersReport({ playwright, browser: options.browser, executable, env, cwd });
  const ffmpeg = await probeFfmpeg(options.ffmpeg, env);
  const magick = findMagick(options.magick, env);
  const outputs = outputsAvailable({ webm: probe.recorder.ok, ffmpeg: ffmpeg.capabilities, imagemagick: Boolean(magick.path) });
  const { found, path, version, source, screencast, resolvedFrom, candidatesTried } = playwright;
  return {
    ok: outputs.webm,
    node: process.version,
    playwright: { found, path, version, source, screencast, browser, resolvedFrom, candidatesTried },
    ffmpeg: { path: ffmpeg.path, version: ffmpeg.version, ...ffmpeg.capabilities, error: ffmpeg.error },
    ffprobe: { path: findFfprobe(ffmpeg.path, env) },
    imagemagick: { flavor: magick.flavor, path: magick.path },
    outputs,
    hints: doctorHints({ options, env, playwright, browser, browsers, recorder: probe.recorder, ffmpeg, magick, outputs }),
    browsers,
    recorder: probe.recorder,
    encoders: encoderVerdicts({ ffmpeg, magick }),
  };
};
