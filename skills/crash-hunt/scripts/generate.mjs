import { isSensitiveHeader, isTokenShaped } from "./redact.mjs";

export class RouteError extends Error {}

export const strategyWeights = [["path", 20], ["query", 18], ["body", 30], ["headers", 15], ["method", 12], ["raw", 5]];

const hostileStrings = [
  "", "0", "-1", "2147483648", "-9223372036854775809", "1e309", "1.5", "NaN", "null", "true", "[]", "{}", "' OR '1'='1", "\"", "\\", "<x>",
  "${x}", "{{x}}", "%s%n", "\u0000", "\uFFFF", "\uD800", "\u202E", "\uD835\uDD4F", " ", "A".repeat(4096),
];
const hostileJson = [null, 0, -1, 1.5, 1e308, -1e308, 2 ** 53 + 1, "", true, false, [], {}, [[[]]], { "": null }, "A".repeat(4096)];
const literalSegments = ["%", "%zz", "%00", "%ff", "%c0%af", "..%2f..%2f", "%2e%2e", ";a=b", "~"];
const pathSuffixes = ["/x", "/..", "/.", "/%2e%2e", "//", ";x", `/${"a".repeat(2048)}`];
const queryKeys = ["id", "page", "limit", "offset", "sort", "filter", "q", "fields"];
const literalQueries = ["?", "?&&==", "?%", "?a=%zz", "?=x", "?a", "?a[=1", "?a]=1", `?${"a=1&".repeat(2000)}`];
const extraKeys = ["__proto__", "constructor", "prototype", "$where", "$gt", "", "a.b", "a[b]", "\u0000"];
const brokenJson = ["{", "}", "{\"a\":}", "{'a':1}", "{\"a\":1,}", "\uFEFF{}", "NaN", "{\"a\":1}{\"b\":2}", "{\"a\":\"\\u12\"}", "[1,2", "\"\\x\"", "{\"a\":01}"];
const contentTypes = [
  "text/plain", "application/xml", "multipart/form-data", "multipart/form-data; boundary=", "application/x-www-form-urlencoded",
  "application/json; charset=bogus", "application/octet-stream", "", "*/*", "application/json, text/plain",
];
const headerNames = [
  "Accept", "Accept-Charset", "Accept-Encoding", "Accept-Language", "Authorization", "Content-Encoding", "Content-Type", "Cookie", "If-Match",
  "If-Modified-Since", "If-None-Match", "If-Range", "Origin", "Range", "Referer", "User-Agent", "X-Forwarded-For", "X-Forwarded-Proto", "X-Request-Id",
];
const headerValues = [
  "", "*", "*/*;q=x", "garbage", "bytes=abc", "bytes=9-1", "bytes=0-0,0-0,0-0", "gzip", "deflate, br;q=", "Bearer", "Basic !!", "Bearer a.b.c",
  "a=; =b; ;", "\"", "null", "-1", "\u0000", "\uD835\uDD4F", "A".repeat(8192),
];
const duplicableHeaders = ["Accept", "Content-Encoding", "Content-Type", "Origin", "Range"];
const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"];
const unknownMethods = ["FOO", "PROPFIND", "get", "M-SEARCH", "PRI", "QUERY"];
const overrideHeaders = ["X-HTTP-Method-Override", "X-HTTP-Method", "X-Method-Override"];

const paramPattern = /\{([A-Za-z0-9_.-]+)\}/g;
const methodToken = /^[A-Z][A-Z0-9-]*$/;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isScalar = (value) => ["string", "number", "boolean"].includes(typeof value);
const pick = (random, list) => list[Math.floor(random() * list.length)];

const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(text, "utf8")) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
};

const mulberry32 = (start) => {
  let state = start >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

export const randomFor = (seed, key, routeIndex) => mulberry32(fnv1a(`${seed}|${key}|${routeIndex}`));

const weighted = (random, table) => {
  let roll = random() * table.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [name, weight] of table) {
    roll -= weight;
    if (roll < 0) return name;
  }
  return table.at(-1)[0];
};

const isUnreserved = (byte) => (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || [0x2d, 0x2e, 0x5f, 0x7e].includes(byte);
export const encodePart = (value) =>
  [...Buffer.from(String(value), "utf8")].map((byte) => (isUnreserved(byte) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)).join("");

export const routeKey = (route) => `${route.method} ${route.path}`;
const pathParams = (route) => [...route.path.matchAll(paramPattern)].map((match) => match[1]);

export const parseRoutes = (value) => {
  if (!Array.isArray(value) || value.length === 0) throw new RouteError("the routes file must hold a non-empty JSON array");
  const seen = new Set();
  return value.map((entry, position) => {
    if (!isObject(entry)) throw new RouteError(`route ${position} is not an object`);
    const method = String(entry.method ?? "").toUpperCase();
    if (!methodToken.test(method)) throw new RouteError(`route ${position} has no valid method`);
    if (typeof entry.path !== "string" || !entry.path.startsWith("/") || /[?#\s]/.test(entry.path)) throw new RouteError(`route ${position} needs a path that starts with / and has no query`);
    const [params, query, headers] = [entry.params ?? {}, entry.query ?? {}, entry.headers ?? {}];
    for (const [field, map, valid] of [["params", params, isScalar], ["query", query, isScalar], ["headers", headers, (item) => typeof item === "string" && !/[\r\n]/.test(item)]]) {
      if (!isObject(map) || !Object.values(map).every(valid)) throw new RouteError(`route ${position} ${field} must map names to ${field === "headers" ? "single-line strings" : "strings or numbers"}`);
    }
    const route = { method, path: entry.path, params, query, headers, body: entry.body ?? null };
    const missing = pathParams(route).filter((name) => !(name in params));
    if (missing.length > 0) throw new RouteError(`route ${routeKey(route)} has no example in params for ${missing.map((name) => `{${name}}`).join(", ")}`);
    const credential = Object.keys(headers).find(isSensitiveHeader);
    if (credential) throw new RouteError(`route ${routeKey(route)} sets ${credential}; pass credentials with --header, never in the routes file`);
    if (isTokenShaped(JSON.stringify([params, query, headers, route.body]))) throw new RouteError(`route ${routeKey(route)} carries a token-shaped value; pass secrets with --header, never in the routes file`);
    if (seen.has(routeKey(route))) throw new RouteError(`route ${routeKey(route)} is listed twice`);
    seen.add(routeKey(route));
    return route;
  });
};

const baseParts = (route) => {
  const parts = {
    method: route.method,
    params: Object.fromEntries(Object.entries(route.params).map(([name, value]) => [name, String(value)])),
    literalParams: {},
    suffix: "",
    query: Object.entries(route.query).map(([name, value]) => [name, String(value)]),
    queryLiteral: null,
    headers: Object.entries(route.headers),
    body: null,
    raw: null,
  };
  if (route.body !== null) useBody(parts, JSON.stringify(route.body));
  return parts;
};

const render = (route, parts) => {
  const path = route.path.replace(paramPattern, (_, name) => parts.literalParams[name] ?? encodePart(parts.params[name])) + parts.suffix;
  const query = parts.queryLiteral ?? (parts.query.length > 0 ? `?${parts.query.map(([name, value]) => `${encodePart(name)}=${encodePart(value)}`).join("&")}` : "");
  return { method: parts.method, target: `${path}${query}`, headers: parts.raw ? [] : parts.headers, body: parts.raw ? null : parts.body, raw: parts.raw };
};

const hasHeader = (parts, name) => parts.headers.some(([existing]) => existing.toLowerCase() === name.toLowerCase());
const setHeader = (parts, name, value) => {
  parts.headers = [...parts.headers.filter(([existing]) => existing.toLowerCase() !== name.toLowerCase()), [name, value]];
};
const useBody = (parts, text) => {
  parts.body = text;
  if (!hasHeader(parts, "Content-Type")) parts.headers.push(["Content-Type", "application/json"]);
};
const bodyObject = (route) => (isObject(route.body) ? structuredClone(route.body) : {});
const fieldOf = (random, object) => (Object.keys(object).length > 0 ? pick(random, Object.keys(object)) : "value");
const setOwn = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
const onParam = (random, route, parts, apply, otherwise) => {
  const names = pathParams(route);
  if (names.length > 0) apply(pick(random, names));
  else parts.suffix = otherwise;
};
const queryKey = (random, parts) => (parts.query.length > 0 ? pick(random, parts.query)[0] : pick(random, queryKeys));

const strategies = {
  path: {
    value: (random, parts, route) => onParam(random, route, parts, (name) => { parts.params[name] = pick(random, hostileStrings); }, `/${encodePart(pick(random, hostileStrings))}`),
    literal: (random, parts, route) => onParam(random, route, parts, (name) => { parts.literalParams[name] = pick(random, literalSegments); }, `/${pick(random, literalSegments)}`),
    empty: (random, parts, route) => onParam(random, route, parts, (name) => { parts.literalParams[name] = ""; }, "//"),
    extra: (random, parts) => { parts.suffix = pick(random, pathSuffixes); },
  },
  query: {
    value: (random, parts) => {
      const name = queryKey(random, parts);
      parts.query = [...parts.query.filter(([existing]) => existing !== name), [name, pick(random, hostileStrings)]];
    },
    duplicate: (random, parts) => { parts.query.push([queryKey(random, parts), pick(random, hostileStrings)]); },
    nested: (random, parts) => {
      const name = queryKey(random, parts);
      parts.query.push([`${name}[]`, "1"], [`${name}[a][b]`, pick(random, hostileStrings)]);
    },
    drop: (random, parts) => {
      if (parts.query.length === 0) parts.queryLiteral = "?";
      else parts.query.splice(Math.floor(random() * parts.query.length), 1);
    },
    literal: (random, parts) => { parts.queryLiteral = pick(random, literalQueries); },
  },
  body: {
    type: (random, parts, route) => {
      const object = bodyObject(route);
      useBody(parts, JSON.stringify(setOwn(object, fieldOf(random, object), pick(random, hostileJson))));
    },
    drop: (random, parts, route) => {
      const object = bodyObject(route);
      if (Object.keys(object).length > 0) delete object[fieldOf(random, object)];
      useBody(parts, Object.keys(object).length > 0 ? JSON.stringify(object) : "");
    },
    "extra-key": (random, parts, route) => useBody(parts, JSON.stringify(setOwn(bodyObject(route), pick(random, extraKeys), pick(random, hostileJson)))),
    replace: (random, parts, route) => useBody(parts, JSON.stringify(pick(random, [[], "x", 0, null, true, [bodyObject(route)]]))),
    syntax: (random, parts) => useBody(parts, pick(random, brokenJson)),
    deep: (random, parts) => {
      const depth = pick(random, [1000, 10000, 100000]);
      useBody(parts, random() < 0.5 ? `${"[".repeat(depth)}${"]".repeat(depth)}` : `${"{\"a\":".repeat(depth)}1${"}".repeat(depth)}`);
    },
    huge: (random, parts, route) => {
      const object = bodyObject(route);
      useBody(parts, JSON.stringify(setOwn(object, fieldOf(random, object), "A".repeat(262144))));
    },
    "content-type": (random, parts, route) => {
      setHeader(parts, "Content-Type", pick(random, contentTypes));
      useBody(parts, parts.body ?? JSON.stringify(bodyObject(route)));
    },
  },
  headers: {
    value: (random, parts) => setHeader(parts, pick(random, headerNames), pick(random, headerValues)),
    duplicate: (random, parts) => {
      const name = pick(random, duplicableHeaders);
      parts.headers = parts.headers.filter(([existing]) => existing.toLowerCase() !== name.toLowerCase());
      parts.headers.push([name, pick(random, headerValues)], [name, pick(random, headerValues)]);
    },
  },
  method: {
    undeclared: (random, parts, route) => { parts.method = pick(random, methods.filter((method) => method !== route.method)); },
    unknown: (random, parts) => { parts.method = pick(random, unknownMethods); },
    override: (random, parts) => { parts.headers.push([pick(random, overrideHeaders), pick(random, [...methods, ...unknownMethods])]); },
  },
  raw: {
    version: (random, parts) => { parts.raw.version = pick(random, ["HTTP/9.9", "HTTP/1.1x", "HTTP/", "HTTX/1.1", "HTTP/1.01", "http/1.1", ""]); },
    "method-char": (random, parts) => { parts.method = pick(random, ["G@T", "GE\u0000T", "", "GET\u00a0", "\u00c9T"]); },
    "no-colon": (random, parts) => { parts.raw.headers.push("NoColonHere"); },
    "space-before-colon": (random, parts) => { parts.raw.headers.push("Accept : */*"); },
    "obs-fold": (random, parts) => { parts.raw.headers.push("X-Folded: a", " b"); },
    "conflicting-length": (random, parts) => {
      parts.raw.headers.push("Content-Length: 5", "Content-Length: 10");
      parts.raw.body = "abcdefghij";
    },
    "length-and-chunked": (random, parts) => {
      parts.raw.body = "1\r\na\r\n0\r\n\r\n";
      parts.raw.headers.push(`Content-Length: ${parts.raw.body.length}`, "Transfer-Encoding: chunked");
    },
    "bad-chunk": (random, parts) => {
      parts.raw.headers.push("Transfer-Encoding: chunked");
      parts.raw.body = `${pick(random, ["zz", "-1", " 1"])}\r\nabc\r\n0\r\n\r\n`;
    },
    "long-header": (random, parts) => { parts.raw.headers.push(`X-Long: ${"a".repeat(65536)}`); },
    "many-headers": (random, parts) => { parts.raw.headers.push(...Array.from({ length: 1000 }, (_, position) => `X-Fuzz-${position}: a`)); },
    "nul-target": (random, parts) => { parts.suffix = "\u0000x"; },
    "space-target": (random, parts) => { parts.suffix = " x"; },
    "bare-lf": (random, parts) => { parts.raw.eol = "\n"; },
  },
};

export const variants = Object.fromEntries(Object.entries(strategies).map(([strategy, table]) => [strategy, Object.keys(table)]));

export const controlFor = (route) => ({ route: routeKey(route), routeIndex: null, strategy: "control", variant: "control", ...render(route, baseParts(route)) });

export const mutate = (seed, route, routeIndex) => {
  const random = randomFor(seed, routeKey(route), routeIndex);
  const strategy = weighted(random, strategyWeights);
  const variant = pick(random, variants[strategy]);
  const parts = baseParts(route);
  if (strategy === "raw") parts.raw = { version: "HTTP/1.1", headers: [], body: "", eol: "\r\n" };
  strategies[strategy][variant](random, parts, route);
  return { route: routeKey(route), routeIndex, strategy, variant, ...render(route, parts) };
};

export const caseFor = (seed, routes, index) => ({ index, ...mutate(seed, routes[index % routes.length], Math.floor(index / routes.length)) });
