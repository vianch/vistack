import net from "node:net";
import { performance } from "node:perf_hooks";
import tls from "node:tls";

export const outcomes = ["ok", "client-error", "server-error", "hang", "reset"];
export const crashKinds = ["process-exit", "server-error", "hang"];

const responseCapBytes = 65536;
const excerptBytes = 2048;
const headEnd = Buffer.from("\r\n\r\n");
const lastChunk = Buffer.from("0\r\n\r\n");
const crashCandidates = new Set(["server-error", "hang", "reset"]);

export const mergeHeaders = (runHeaders, caseHeaders) => {
  const caseNames = new Set(caseHeaders.map(([name]) => name.toLowerCase()));
  return [...runHeaders.filter(([name]) => !caseNames.has(name.toLowerCase())), ...caseHeaders];
};

export const requestBytes = (target, testCase, runHeaders = []) => {
  const lines = [`${testCase.method} ${target.basePath}${testCase.target} ${testCase.raw?.version ?? "HTTP/1.1"}`, `Host: ${target.hostHeader}`];
  let body = "";
  if (testCase.raw) {
    lines.push(...testCase.raw.headers);
    body = testCase.raw.body;
  } else {
    lines.push(...mergeHeaders(runHeaders, testCase.headers).map(([name, value]) => `${name}: ${value}`));
    if (testCase.body !== null) lines.push(`Content-Length: ${Buffer.byteLength(testCase.body, "utf8")}`);
    body = testCase.body ?? "";
  }
  lines.push("Connection: close", "", body);
  return Buffer.from(lines.join(testCase.raw?.eol ?? "\r\n"), "utf8");
};

const headerValue = (head, name) => head.match(new RegExp(`^${name}:[ \\t]*([^\\r\\n]*)`, "im"))?.[1]?.trim() ?? null;

export const parseResponse = (buffer) => {
  const status = Number(buffer.subarray(0, 64).toString("latin1").match(/^HTTP\/\d(?:\.\d)? (\d{3})/)?.[1] ?? Number.NaN);
  const end = buffer.indexOf(headEnd);
  const head = buffer.subarray(0, end === -1 ? buffer.length : end).toString("latin1");
  return {
    status: Number.isInteger(status) ? status : null,
    contentType: headerValue(head, "content-type"),
    excerpt: end === -1 ? "" : buffer.subarray(end + 4, end + 4 + excerptBytes).toString("utf8"),
  };
};

const responseComplete = (buffer, method) => {
  const end = buffer.indexOf(headEnd);
  if (end === -1) return false;
  const { status } = parseResponse(buffer);
  if (method === "HEAD" || status === 204 || status === 304 || (status >= 100 && status < 200)) return true;
  const head = buffer.subarray(0, end).toString("latin1");
  const length = Number(headerValue(head, "content-length"));
  if (headerValue(head, "content-length") !== null && Number.isInteger(length)) return buffer.length >= end + 4 + length;
  return /chunked/i.test(headerValue(head, "transfer-encoding") ?? "") && buffer.subarray(-lastChunk.length).equals(lastChunk);
};

const connect = (target, address) => {
  const options = { host: address ?? target.address, port: target.port };
  if (target.protocol !== "https:") return { socket: net.connect(options), ready: "connect" };
  return { socket: tls.connect({ ...options, servername: target.servername, rejectUnauthorized: false }), ready: "secureConnect" };
};

export const exchange = (target, bytes, timeoutMs, method) =>
  new Promise((resolve) => {
    const started = performance.now();
    const chunks = [];
    let received = 0;
    let settled = false;
    const { socket, ready } = connect(target);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      const response = parseResponse(Buffer.concat(chunks));
      resolve({ ...response, error: response.status === null ? error ?? "reset" : null, ms: Math.round(performance.now() - started) });
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    socket.once(ready, () => socket.write(bytes));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      received += chunk.length;
      if (received >= responseCapBytes || responseComplete(Buffer.concat(chunks), method)) finish(null);
    });
    socket.on("end", () => finish(null));
    socket.on("close", () => finish(null));
    socket.on("error", (error) => finish(error?.code === "ECONNREFUSED" ? "refused" : "reset"));
  });

export const classify = ({ status, error }) => {
  if (Number.isInteger(status)) return status >= 500 ? "server-error" : status >= 400 ? "client-error" : "ok";
  return error === "timeout" ? "hang" : "reset";
};

export const crashKind = async (outcome, healthy) => {
  if (!crashCandidates.has(outcome)) return null;
  if (!(await healthy())) return "process-exit";
  return outcome === "reset" ? null : outcome;
};

export const tcpOpen = (target, timeoutMs, address) =>
  new Promise((resolve) => {
    const { socket, ready } = connect({ ...target, protocol: "http:" }, address);
    const done = (open) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(open);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once(ready, () => done(true));
    socket.once("error", () => done(false));
  });

export const pinAddress = async (target, timeoutMs) => {
  for (const address of target.addresses) {
    if (await tcpOpen(target, timeoutMs, address)) return address;
  }
  return null;
};

export const probeHealth = async (target, healthPath, timeoutMs) => {
  if (!healthPath) return tcpOpen(target, timeoutMs);
  const probe = { method: "GET", target: healthPath, headers: [], body: null, raw: null };
  const { status } = await exchange(target, requestBytes({ ...target, basePath: "" }, probe), timeoutMs, "GET");
  return status !== null && status >= 200 && status < 300;
};
