#!/usr/bin/env node
import { randomInt } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { RouteError, caseFor, controlFor, mutate, parseRoutes, routeKey } from "./generate.mjs";
import { resolveTarget } from "./guard.mjs";
import { redactCase, redactHeaders, redacted, scrub, secretValues } from "./redact.mjs";
import { classify, crashKind, crashKinds, exchange, mergeHeaders, outcomes, pinAddress, probeHealth, requestBytes } from "./send.mjs";

export class UsageError extends Error {}
export class SetupError extends Error {}

const scriptPath = fileURLToPath(import.meta.url);
const replayFormat = 1;
const exitGraceMs = 500;
const previewChars = 256;
const defaults = { requests: 500, minutes: 15, timeoutMs: 10000, start: 0 };
const usage = [
  "usage: node crash-hunt.mjs check-target --base <url>",
  "       node crash-hunt.mjs run --base <url> --routes <file> --out <dir> [--seed n] [--requests n] [--minutes n] [--timeout-ms n]",
  "                               [--health <path>] [--header \"K: V\"]... [--stop-on-crash] [--auth-required] [--start n]",
  "       node crash-hunt.mjs replay --base <url> --request <file> [--header \"K: V\"]...",
  "Only loopback targets are accepted. stdout carries one JSON document; diagnostics go to stderr.",
  "exit codes: 0 loopback (check-target) or no crash; 1 crash found (run) or reproduced (replay); 2 guard, usage, or setup error",
].join("\n");
const flags = {
  "check-target": { "--base": "base" },
  run: {
    "--base": "base", "--routes": "routes", "--out": "out", "--seed": "seed", "--requests": "requests", "--minutes": "minutes",
    "--timeout-ms": "timeoutMs", "--health": "health", "--header": "header", "--start": "start", "--stop-on-crash": "stopOnCrash", "--auth-required": "authRequired",
  },
  replay: { "--base": "base", "--request": "request", "--header": "header" },
};
const required = { "check-target": ["base"], run: ["base", "routes", "out"], replay: ["base", "request"] };
const switches = new Set(["--stop-on-crash", "--auth-required"]);
const authRejected = new Set([401, 403]);

export const parseHeader = (text) => {
  const separator = text.indexOf(":");
  const name = separator > 0 ? text.slice(0, separator).trim() : "";
  const value = separator > 0 ? text.slice(separator + 1).trim() : "";
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) throw new UsageError("--header must be \"Name: value\" on one line");
  return [name, value];
};

const count = (value, flag, minimum, maximum = Number.MAX_SAFE_INTEGER) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new UsageError(`${flag} must be an integer from ${minimum} to ${maximum}`);
  return number;
};

export const parseArgs = (argv) => {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") return { help: true };
  const known = flags[command];
  if (!known) throw new UsageError(`unknown command ${command}\n${usage}`);
  const options = { command, headers: [], stopOnCrash: false, authRequired: false };
  for (let position = 0; position < rest.length; position += 1) {
    const flag = rest[position];
    if (!(flag in known)) throw new UsageError(`unexpected argument ${flag}\n${usage}`);
    if (switches.has(flag)) {
      options[known[flag]] = true;
      continue;
    }
    const value = rest[position + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    position += 1;
    if (flag === "--header") options.headers.push(parseHeader(value));
    else options[known[flag]] = value;
  }
  const missing = required[command].filter((key) => options[key] === undefined);
  if (missing.length > 0) throw new UsageError(`${command} needs --${missing.join(", --")}`);
  if (command !== "run") return options;
  if (options.health !== undefined && !options.health.startsWith("/")) throw new UsageError("--health must be a path that starts with /");
  return {
    ...options,
    seed: options.seed === undefined ? randomInt(4294967296) : count(options.seed, "--seed", 0, 4294967295),
    requests: count(options.requests ?? defaults.requests, "--requests", 1),
    minutes: count(options.minutes ?? defaults.minutes, "--minutes", 1),
    timeoutMs: count(options.timeoutMs ?? defaults.timeoutMs, "--timeout-ms", 1),
    start: count(options.start ?? defaults.start, "--start", 0),
  };
};

const readJson = (path, what) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new UsageError(`cannot read the ${what} ${path}: ${error.message}`);
  }
};

const connectTarget = async (base, timeoutMs, health) => {
  const target = await resolveTarget(base);
  target.address = await pinAddress(target, timeoutMs);
  if (!target.address) throw new SetupError(`nothing accepts a connection on port ${target.port} at ${target.addresses.join(", ")}; boot the app first`);
  const healthy = () => probeHealth(target, health, timeoutMs);
  if (!(await healthy())) throw new SetupError(`the app does not answer ${health ?? "a TCP connect"} before the first request`);
  return { target, healthy };
};

const preview = (text) => (typeof text === "string" && text.length > previewChars ? `${text.slice(0, previewChars)}...` : text);

const requestRecord = (testCase, runHeaders, result, outcome, secrets, at) => {
  const clean = redactCase({ ...testCase, headers: testCase.raw ? [] : mergeHeaders(runHeaders, testCase.headers) }, secrets);
  const body = clean.raw ? clean.raw.body : clean.body;
  return {
    index: testCase.index ?? null, routeIndex: testCase.routeIndex, route: testCase.route, strategy: testCase.strategy, variant: testCase.variant,
    method: preview(clean.method), target: preview(clean.target),
    headers: clean.raw ? clean.raw.headers.slice(0, 20).map(preview) : clean.headers.map(([name, value]) => [name, preview(value)]),
    bodyBytes: Buffer.byteLength(body ?? "", "utf8"), bodyPreview: preview(body), outcome, status: result.status, ms: result.ms, at,
  };
};

const recorder = (out) => {
  const append = (file, value) => appendFileSync(join(out, file), `${JSON.stringify(value)}\n`);
  return {
    request: (value) => append("requests.jsonl", value),
    crash: (value) => append("crashes.jsonl", value),
    replay: (name, value) => writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`),
  };
};

export const checkTarget = async (options) => {
  const target = await resolveTarget(options.base);
  return { summary: { ok: true, base: options.base, hostname: target.hostname, addresses: target.addresses, port: target.port }, exitCode: 0 };
};

export const runFuzz = async (options) => {
  let routes;
  try {
    routes = parseRoutes(readJson(options.routes, "routes file"));
  } catch (error) {
    throw error instanceof RouteError ? new UsageError(error.message) : error;
  }
  const out = resolve(options.out);
  if (options.start === 0 && existsSync(join(out, "requests.jsonl"))) throw new UsageError(`${options.out} already holds a run; continue it with --start <nextIndex> or use a new directory`);
  const { target, healthy } = await connectTarget(options.base, options.timeoutMs, options.health);
  mkdirSync(out, { recursive: true });
  const secrets = secretValues(options.headers);
  const record = recorder(out);
  const summary = {
    base: options.base, address: target.address, seed: options.seed, start: options.start, nextIndex: options.start, sent: 0, controls: 0,
    outcomes: Object.fromEntries(outcomes.map((name) => [name, 0])), crashes: 0, byKind: Object.fromEntries(crashKinds.map((name) => [name, 0])),
    routes: [], stopped: null, out,
  };
  const send = async (testCase) => {
    const at = new Date().toISOString();
    return { at, result: await exchange(target, requestBytes(target, testCase, options.headers), options.timeoutMs, testCase.method) };
  };
  const recordCrash = ({ testCase, route, at, result, outcome }, kind, detected) => {
    const name = `replay-${testCase.index}.json`;
    const { index: _unused, ...request } = testCase;
    record.replay(name, {
      format: replayFormat, seed: options.seed, index: testCase.index, routeIndex: testCase.routeIndex, kind, outcome, status: result.status, at,
      health: options.health ?? null, timeoutMs: options.timeoutMs, route, runHeaders: redactHeaders(options.headers, secrets), request: redactCase(request, secrets),
    });
    record.crash({ kind, detected, outcome, status: result.status, index: testCase.index, routeIndex: testCase.routeIndex, route: testCase.route, strategy: testCase.strategy, variant: testCase.variant, seed: options.seed, at, replay: name });
    summary.crashes += 1;
    summary.byKind[kind] += 1;
  };

  const skipped = new Set();
  for (const route of routes) {
    const control = controlFor(route);
    const { at, result } = await send(control);
    const outcome = classify(result);
    record.request(requestRecord(control, options.headers, result, outcome, secrets, at));
    summary.controls += 1;
    const passed = outcome === "ok" || outcome === "client-error";
    summary.routes.push({ route: control.route, control: outcome, status: result.status, skipped: !passed });
    if (passed) continue;
    skipped.add(control.route);
    if (!(await healthy())) {
      summary.stopped = "control-exit";
      return { summary, exitCode: 2 };
    }
  }
  if (options.authRequired && summary.routes.every(({ status }) => authRejected.has(status))) {
    summary.stopped = "auth-rejected";
    return { summary, exitCode: 2 };
  }
  if (skipped.size === routes.length) {
    summary.stopped = "no-routes";
    return { summary, exitCode: 2 };
  }

  const deadline = Date.now() + options.minutes * 60000;
  let index = options.start;
  let last = null;
  while (summary.stopped === null) {
    if (summary.sent >= options.requests) summary.stopped = "requests";
    else if (Date.now() >= deadline) summary.stopped = "minutes";
    if (summary.stopped !== null) break;
    const route = routes[index % routes.length];
    if (skipped.has(routeKey(route))) {
      index += 1;
      continue;
    }
    const testCase = caseFor(options.seed, routes, index);
    const { at, result } = await send(testCase);
    if (result.error === "refused" && last === null) {
      summary.stopped = "control-exit";
      return { summary, exitCode: 2 };
    }
    if (result.error === "refused") {
      recordCrash(last, "process-exit", "next-connect");
      summary.stopped = "process-exit";
      break;
    }
    index += 1;
    const outcome = classify(result);
    const kind = await crashKind(outcome, healthy);
    summary.sent += 1;
    summary.outcomes[outcome] += 1;
    record.request(requestRecord(testCase, options.headers, result, outcome, secrets, at));
    last = { testCase, route, at, result, outcome };
    if (kind === null) continue;
    recordCrash(last, kind, kind === "process-exit" ? "health" : kind === "hang" ? "timeout" : "status");
    if (kind === "process-exit") summary.stopped = "process-exit";
    else if (options.stopOnCrash) summary.stopped = "stop-on-crash";
  }
  summary.nextIndex = index;
  return { summary, exitCode: summary.crashes > 0 ? 1 : 0 };
};

const isPair = (pair) => Array.isArray(pair) && pair.length === 2 && pair.every((part) => typeof part === "string");
const validReplay = (file) =>
  file?.format === replayFormat && Number.isInteger(file.seed) && Number.isInteger(file.routeIndex) && file.routeIndex >= 0 && Number.isInteger(file.timeoutMs) &&
  file.timeoutMs > 0 && (file.health === null || typeof file.health === "string") && Array.isArray(file.runHeaders) && file.runHeaders.every(isPair);

export const replayCrash = async (options) => {
  const file = readJson(options.request, "replay file");
  if (!validReplay(file)) throw new UsageError(`${options.request} is not a crash-hunt replay file of format ${replayFormat}`);
  let route;
  try {
    [route] = parseRoutes([file.route]);
  } catch (error) {
    throw new UsageError(`${options.request} holds an invalid route: ${error.message}`);
  }
  const testCase = mutate(file.seed, route, file.routeIndex);
  if (JSON.stringify(redactCase(testCase)) !== JSON.stringify(file.request)) {
    throw new UsageError(`${options.request} does not match what this generator produces for its seed, route, and index; replay with the plugin version that wrote it`);
  }
  const given = new Set(options.headers.map(([name]) => name.toLowerCase()));
  const runHeaders = [...file.runHeaders.filter(([name]) => !given.has(name.toLowerCase())), ...options.headers];
  const missing = runHeaders.filter(([, value]) => value === redacted).map(([name]) => name);
  if (missing.length > 0) throw new UsageError(`${missing.join(", ")} was redacted in the replay file; supply it again with --header`);
  const { target, healthy } = await connectTarget(options.base, file.timeoutMs, file.health);
  const result = await exchange(target, requestBytes(target, testCase, runHeaders), file.timeoutMs, testCase.method);
  if (result.error === "refused") throw new SetupError("the app refused the replay connection right after answering health");
  const outcome = classify(result);
  let kind = await crashKind(outcome, healthy);
  if (kind === null) {
    await sleep(exitGraceMs);
    if (!(await healthy())) kind = "process-exit";
  }
  const summary = {
    reproduced: kind !== null, kind, recorded: file.kind, sameKind: kind === file.kind, outcome, status: result.status, ms: result.ms,
    response: { contentType: result.contentType, excerpt: scrub(result.excerpt, secretValues(runHeaders)) }, request: options.request,
  };
  return { summary, exitCode: kind === null ? 0 : 1 };
};

const commands = { "check-target": checkTarget, run: runFuzz, replay: replayCrash };

const main = async () => {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage}\n`);
      return;
    }
    const { summary, exitCode } = await commands[options.command](options);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = exitCode;
  } catch (error) {
    const message = error?.message ?? String(error);
    process.stdout.write(`${JSON.stringify({ ok: false, error: message.split("\n")[0] }, null, 2)}\n`);
    process.stderr.write(`crash-hunt: ${message}\n`);
    process.exitCode = 2;
  }
};

const invokedDirectly = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(scriptPath);
  } catch {
    return false;
  }
};

if (invokedDirectly()) await main();
