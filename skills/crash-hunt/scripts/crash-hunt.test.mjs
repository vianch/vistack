import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseArgs, runFuzz } from "./crash-hunt.mjs";
import { resolveTarget } from "./guard.mjs";
import { classify, crashKind, exchange, pinAddress, probeHealth, requestBytes } from "./send.mjs";

const script = fileURLToPath(new URL("./crash-hunt.mjs", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "crash-hunt-test-"));
const secret = "s3cr3t-local-session-0123456789abcdef";
const apps = [];
after(async () => {
  await Promise.all(apps.map((app) => app.stop()));
  rmSync(scratch, { recursive: true, force: true });
});

const startApp = async (onBadItem) => {
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    if (path === "/health") return response.end("ok");
    if (path === "/broken") return void (response.statusCode = 500, response.end("boom"));
    const item = path.match(/^\/items\/([^/]*)$/);
    if (!item) return void (response.statusCode = 404, response.end());
    if (item[1] === "1") return response.end("{\"id\":1}");
    return onBadItem(request, response, { server, sockets });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const stop = () => {
    for (const socket of sockets) socket.destroy();
    return new Promise((done) => server.close(() => done()));
  };
  const app = { base: `http://127.0.0.1:${server.address().port}`, port: server.address().port, stop };
  apps.push(app);
  return app;
};

const failWith500 = (request, response) => {
  response.statusCode = 500;
  response.end("boom");
};
const answer400 = (request, response) => {
  response.statusCode = 400;
  response.setHeader("content-type", "application/json");
  response.end("{\"error\":\"bad id\"}");
};
const exitProcess = (request, response, { server, sockets }) => {
  server.close();
  for (const socket of sockets) socket.destroy();
};

const routesFile = (name, routes) => {
  const path = join(scratch, `${name}.json`);
  writeFileSync(path, JSON.stringify(routes));
  return path;
};
const itemRoutes = routesFile("items", [{ method: "GET", path: "/items/{id}", params: { id: "1" } }]);
const outDir = (name) => join(scratch, name);
const run = (app, routes, out, ...extra) =>
  runFuzz(parseArgs(["run", "--base", app.base, "--routes", routes, "--out", out, "--seed", "7", "--requests", "80", "--timeout-ms", "500", "--health", "/health", ...extra]));
const lines = (path) => readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));

const cli = (args) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("close", (code) => done({ code, json: JSON.parse(stdout) }));
  });

describe("classification against a real server", () => {
  const timeoutMs = 300;
  const outcomeOf = async (app, path) => {
    const target = await resolveTarget(app.base);
    target.address = await pinAddress(target, timeoutMs);
    const result = await exchange(target, requestBytes(target, { method: "GET", target: path, headers: [], body: null, raw: null }), timeoutMs, "GET");
    const outcome = classify(result);
    return { outcome, kind: await crashKind(outcome, () => probeHealth(target, "/health", timeoutMs)) };
  };
  test("a 500 is a server-error crash while health answers", async () => {
    assert.deepEqual(await outcomeOf(await startApp(failWith500), "/items/x"), { outcome: "server-error", kind: "server-error" });
  });
  test("a 4xx is a client-error and not a crash", async () => {
    assert.deepEqual(await outcomeOf(await startApp(answer400), "/items/x"), { outcome: "client-error", kind: null });
  });
  test("a destroyed socket is a reset, not a crash, while health answers", async () => {
    assert.deepEqual(await outcomeOf(await startApp((request) => request.socket.destroy()), "/items/x"), { outcome: "reset", kind: null });
  });
  test("no response within the timeout is a hang", async () => {
    assert.deepEqual(await outcomeOf(await startApp(() => {}), "/items/x"), { outcome: "hang", kind: "hang" });
  });
  test("a server that closes and stops answering health is a process-exit", async () => {
    assert.deepEqual(await outcomeOf(await startApp(exitProcess), "/items/x"), { outcome: "reset", kind: "process-exit" });
  });
  test("a localhost base pins the loopback address that answers and sends the URL's Host header", async () => {
    let host = null;
    const app = await startApp((request, response) => {
      host = request.headers.host;
      response.end();
    });
    const target = await resolveTarget(`http://localhost:${app.port}/`);
    target.address = await pinAddress(target, timeoutMs);
    assert.equal(target.address, "127.0.0.1");
    const result = await exchange(target, requestBytes(target, { method: "GET", target: "/items/x", headers: [], body: null, raw: null }), timeoutMs, "GET");
    assert.deepEqual([result.status, host], [200, `localhost:${app.port}`]);
  });
});

describe("run", () => {
  test("finds a server-error, writes redacted files, and replay reproduces it until the app is fixed", async () => {
    const app = await startApp(failWith500);
    const out = outDir("server-error");
    const { summary, exitCode } = await run(app, itemRoutes, out, "--header", `Authorization: Bearer ${secret}`, "--stop-on-crash");
    assert.equal(exitCode, 1);
    assert.equal(summary.stopped, "stop-on-crash");
    assert.equal(summary.byKind["server-error"], 1);
    assert.equal(summary.nextIndex, lines(join(out, "crashes.jsonl"))[0].index + 1);
    const [crash] = lines(join(out, "crashes.jsonl"));
    assert.deepEqual([crash.kind, crash.detected, crash.seed], ["server-error", "status", 7]);
    for (const name of readdirSync(out)) assert.doesNotMatch(readFileSync(join(out, name), "utf8"), new RegExp(secret), name);
    assert.match(readFileSync(join(out, "requests.jsonl"), "utf8"), /"Authorization","\[redacted\]"/);

    const replayFile = join(out, crash.replay);
    const reproduced = await cli(["replay", "--base", app.base, "--request", replayFile, "--header", `Authorization: Bearer ${secret}`]);
    assert.equal(reproduced.code, 1);
    assert.deepEqual([reproduced.json.reproduced, reproduced.json.kind, reproduced.json.sameKind], [true, "server-error", true]);

    const missingHeader = await cli(["replay", "--base", app.base, "--request", replayFile]);
    assert.equal(missingHeader.code, 2);
    assert.match(missingHeader.json.error, /Authorization was redacted/);

    const fixed = await startApp(answer400);
    const clean = await cli(["replay", "--base", fixed.base, "--request", replayFile, "--header", `Authorization: Bearer ${secret}`]);
    assert.equal(clean.code, 0);
    assert.deepEqual([clean.json.reproduced, clean.json.status, clean.json.response.excerpt], [false, 400, "{\"error\":\"bad id\"}"]);
  });

  test("a mutation that kills the app stops the run as a process-exit", async () => {
    const out = outDir("process-exit");
    const { summary, exitCode } = await run(await startApp(exitProcess), itemRoutes, out);
    assert.equal(exitCode, 1);
    assert.deepEqual([summary.stopped, summary.byKind["process-exit"], summary.crashes], ["process-exit", 1, 1]);
    assert.equal(lines(join(out, "crashes.jsonl"))[0].detected, "health");
  });

  test("a route whose control request fails is skipped and never fuzzed", async () => {
    const out = outDir("control-skip");
    const routes = routesFile("mixed", [{ method: "GET", path: "/broken" }, { method: "GET", path: "/items/{id}", params: { id: "1" } }]);
    const { summary, exitCode } = await run(await startApp(answer400), routes, out, "--requests", "30");
    assert.equal(exitCode, 0);
    assert.deepEqual(summary.routes.map(({ route, control, skipped }) => [route, control, skipped]), [["GET /broken", "server-error", true], ["GET /items/{id}", "ok", false]]);
    const fuzzed = lines(join(out, "requests.jsonl")).filter(({ strategy }) => strategy !== "control");
    assert.equal(fuzzed.length, 30);
    assert.ok(fuzzed.every(({ route }) => route === "GET /items/{id}"));
  });

  test("with --auth-required, controls that all answer 401 or 403 stop the run before any fuzz request", async () => {
    const app = await startApp(answer400);
    const routes = routesFile("auth", [{ method: "GET", path: "/items/{id}", params: { id: "2" } }]);
    const rejecting = await startApp((request, response) => {
      response.statusCode = 401;
      response.end();
    });
    const stopped = await run(rejecting, routes, outDir("auth-rejected"), "--auth-required");
    assert.deepEqual([stopped.exitCode, stopped.summary.stopped, stopped.summary.sent], [2, "auth-rejected", 0]);
    const healthy = await run(app, itemRoutes, outDir("auth-accepted"), "--auth-required", "--requests", "5");
    assert.deepEqual([healthy.exitCode, healthy.summary.stopped], [0, "requests"]);
  });

  test("when every control fails the run is a setup error, and a used --out is refused", async () => {
    const app = await startApp(answer400);
    const out = outDir("no-routes");
    const { summary, exitCode } = await run(app, routesFile("broken", [{ method: "GET", path: "/broken" }]), out);
    assert.deepEqual([exitCode, summary.stopped, summary.sent], [2, "no-routes", 0]);
    await assert.rejects(run(app, itemRoutes, out), /already holds a run/);
  });
});

describe("the command line", () => {
  test("check-target exits 0 for loopback and 2 for anything else", async () => {
    const loopback = await cli(["check-target", "--base", "http://127.0.0.1:1/"]);
    assert.deepEqual([loopback.code, loopback.json.ok, loopback.json.addresses], [0, true, ["127.0.0.1"]]);
    const outside = await cli(["check-target", "--base", "http://10.0.0.1/"]);
    assert.deepEqual([outside.code, outside.json.ok], [2, false]);
    assert.match(outside.json.error, /not loopback/);
  });
  test("replay exits 2 for a non-loopback base, a closed port, or a file it did not write", async () => {
    const app = await startApp(failWith500);
    const out = outDir("replay-guards");
    await run(app, itemRoutes, out, "--stop-on-crash");
    const [crash] = lines(join(out, "crashes.jsonl"));
    const replayFile = join(out, crash.replay);
    assert.equal((await cli(["replay", "--base", "http://10.0.0.1/", "--request", replayFile])).code, 2);
    const closed = await startApp(failWith500);
    await closed.stop();
    const refused = await cli(["replay", "--base", closed.base, "--request", replayFile]);
    assert.deepEqual([refused.code, /boot the app first/.test(refused.json.error)], [2, true]);
    const tampered = JSON.parse(readFileSync(replayFile, "utf8"));
    tampered.request.target = "/items/2";
    writeFileSync(replayFile, JSON.stringify(tampered));
    const mismatch = await cli(["replay", "--base", app.base, "--request", replayFile]);
    assert.deepEqual([mismatch.code, /does not match/.test(mismatch.json.error)], [2, true]);
  });
  test("usage errors exit 2", async () => {
    for (const args of [["fuzz"], ["run", "--base", "http://127.0.0.1:1/"], ["run", "--base", "http://127.0.0.1:1/", "--routes", "r", "--out", "o", "--seed", "-1"], ["replay", "--base", "x", "--request", "r", "--header", "nocolon"]]) {
      assert.equal((await cli(args)).code, 2, args.join(" "));
    }
  });
});
