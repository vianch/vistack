// Pure: nothing here touches the filesystem, spawns a process, or reads process state.

import { outputsAvailable, producedProblem } from "./media.mjs";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const megabytes = (bytes) => (bytes / 1048576).toFixed(1);
const derivedKeys = ["mp4", "gif", "slideshow", "sheet"];
const attachOrder = ["mp4", "webm", "gif"];

const needs = {
  mp4: "an ffmpeg with libx264",
  gif: "an ffmpeg with the gif encoder and palettegen, paletteuse, split, fps, scale",
  slideshow: "an ffmpeg with libx264, the png decoder, and the concat demuxer",
  sheet: "ImageMagick (magick or montage)",
};

const capabilityNeeds = {
  mp4: [["encoders", "libx264"]],
  gif: [["encoders", "gif"], ["filters", "palettegen"], ["filters", "paletteuse"], ["filters", "split"], ["filters", "fps"], ["filters", "scale"]],
  slideshow: [["encoders", "libx264"], ["decoders", "png"], ["demuxers", "concat"]],
};

export const missingCapabilities = (key, capabilities) =>
  (capabilityNeeds[key] ?? []).filter(([group, name]) => !capabilities?.[group]?.[name]).map(([group, name]) => `the ${name} ${group.slice(0, -1)}`);

export const unavailableReason = (key, { ffmpeg, magick } = {}) => {
  const why = key === "sheet" ? magick?.error ?? "ImageMagick not found"
    : ffmpeg?.state === "ok" ? `ffmpeg at ${ffmpeg.path} lacks ${missingCapabilities(key, ffmpeg.capabilities).join(", ")}`
      : ffmpeg?.state === "failed" ? `ffmpeg at ${ffmpeg.path} failed: ${ffmpeg.error}`
        : ffmpeg?.error ?? "ffmpeg not found";
  return `${why}; ${key} needs ${needs[key]}`;
};

export const encoderVerdicts = ({ ffmpeg, magick }) => {
  const available = outputsAvailable({ webm: true, ffmpeg: ffmpeg?.capabilities, imagemagick: Boolean(magick?.path) });
  return {
    ...Object.fromEntries(derivedKeys.map((key) => [key, available[key]])),
    reasons: Object.fromEntries(derivedKeys.map((key) => [key, available[key] ? null : unavailableReason(key, { ffmpeg, magick })])),
  };
};

export const pickAttachment = (outputs = {}) => {
  const chosen = attachOrder.find((key) => outputs[key]?.status === "produced");
  const passedOver = attachOrder.slice(0, chosen ? attachOrder.indexOf(chosen) : attachOrder.length).map((key) => {
    const output = outputs[key];
    return output ? `${key} ${output.status}${output.reason ? `: ${output.reason}` : ""}` : `${key} not requested`;
  });
  if (chosen) return { path: outputs[chosen].path, output: chosen, reason: passedOver.length ? passedOver.join("; ") : null };
  const webm = outputs.webm;
  if (!isObject(webm) || webm.status === "failed") return { path: null, output: null, reason: `no video: ${webm?.reason ?? "the manifest lists no webm output"}` };
  return { path: null, output: null, reason: `every video output is over the attachment budget (${passedOver.join("; ")}); cite ${webm.path} without attaching it, and re-record a shorter scenario or run finish --gif` };
};

export const outputReport = (outputs, facts, maxMb) =>
  Object.fromEntries(Object.entries(isObject(outputs) ? outputs : {}).filter(([, output]) => isObject(output)).map(([key, output]) => {
    const path = output.path ?? null;
    if (output.status !== "produced") return [key, { path, status: output.status ?? "unknown", reason: output.reason ?? null }];
    const problem = producedProblem(key, output, facts);
    if (problem) return [key, { path, status: "failed", reason: problem }];
    if (output.bytes > maxMb * 1048576) return [key, { path, status: "over-budget", reason: `${megabytes(output.bytes)} MB is over --max-mb ${maxMb}` }];
    return [key, { path, status: "produced", reason: null }];
  }));
