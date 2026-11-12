import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { RouteError, caseFor, controlFor, encodePart, parseRoutes, routeKey, strategyWeights, variants } from "./generate.mjs";
import { isTokenShaped } from "./redact.mjs";
import { requestBytes } from "./send.mjs";

const routes = parseRoutes([
  { method: "GET", path: "/items/{id}", params: { id: "1" }, query: { limit: 10 } },
  { method: "post", path: "/orders/{orderId}/lines", params: { orderId: 7 }, body: { sku: "A-1", quantity: 2, note: "x" } },
  { method: "DELETE", path: "/sessions", headers: { Accept: "application/json" } },
]);
const sample = (seed, total) => Array.from({ length: total }, (_, index) => caseFor(seed, routes, index));
const target = { basePath: "", hostHeader: "127.0.0.1:1" };

describe("caseFor", () => {
  test("the same seed and index give the same request, a different seed does not", () => {
    assert.deepEqual(sample(42, 300), sample(42, 300));
    assert.notDeepEqual(sample(42, 60), sample(43, 60));
  });
  test("a route's sequence does not depend on the other routes in the file", () => {
    for (const testCase of sample(9, 150)) {
      const { index: _unused, ...alone } = testCase;
      const route = routes.find((candidate) => routeKey(candidate) === testCase.route);
      assert.deepEqual(caseFor(9, [route], testCase.routeIndex), { index: testCase.routeIndex, ...alone });
    }
  });
  test("maps an index to a route over the whole file", () => {
    assert.deepEqual((({ route, routeIndex }) => ({ route, routeIndex }))(caseFor(1, routes, 4)), { route: "POST /orders/{orderId}/lines", routeIndex: 1 });
  });
  test("every strategy appears, every variant is in its closed list, and raw stays a small share", () => {
    const cases = sample(5, 3000);
    assert.deepEqual([...new Set(cases.map(({ strategy }) => strategy))].sort(), strategyWeights.map(([name]) => name).sort());
    for (const { strategy, variant } of cases) assert.ok(variants[strategy].includes(variant), `${strategy}/${variant}`);
    const rawShare = cases.filter(({ strategy }) => strategy === "raw").length / cases.length;
    assert.ok(rawShare > 0.02 && rawShare < 0.09, `raw share ${rawShare}`);
  });
  test("no generated request names a host or carries a token-shaped value", () => {
    for (const testCase of sample(11, 3000)) {
      const text = JSON.stringify(testCase);
      assert.equal(text.includes("://"), false, `${testCase.strategy}/${testCase.variant} at ${testCase.index}`);
      assert.equal(isTokenShaped(text), false, `${testCase.strategy}/${testCase.variant} at ${testCase.index}`);
    }
  });
  test("every request ends its own framing, so a timeout can only mean the app hung", () => {
    for (const testCase of sample(3, 3000)) {
      const text = requestBytes(target, testCase, [["Authorization", "Bearer local"]]).toString("utf8");
      const eol = testCase.raw?.eol ?? "\r\n";
      const end = text.indexOf(`${eol}${eol}`);
      const where = `${testCase.strategy}/${testCase.variant} at ${testCase.index}`;
      assert.ok(end > 0, where);
      const head = text.slice(0, end);
      const body = Buffer.from(text.slice(end + eol.length * 2), "utf8");
      assert.match(head, /\nConnection: close$/, where);
      const lengths = [...head.matchAll(/\nContent-Length: (\d+)/g)].map((match) => Number(match[1]));
      if (lengths.length > 0) assert.ok(body.length >= Math.max(...lengths), where);
      if (/\nTransfer-Encoding: chunked/.test(head)) assert.ok(body.toString("latin1").endsWith("0\r\n\r\n"), where);
      if (testCase.raw) assert.doesNotMatch(head, /Authorization/, where);
    }
  });
});

describe("controlFor", () => {
  test("builds the well-formed request from the route's examples", () => {
    assert.deepEqual(controlFor(routes[1]), {
      route: "POST /orders/{orderId}/lines", routeIndex: null, strategy: "control", variant: "control", method: "POST", target: "/orders/7/lines",
      headers: [["Content-Type", "application/json"]], body: "{\"sku\":\"A-1\",\"quantity\":2,\"note\":\"x\"}", raw: null,
    });
    assert.equal(controlFor(routes[0]).target, "/items/1?limit=10");
    assert.deepEqual(controlFor(routes[2]).headers, [["Accept", "application/json"]]);
  });
});

describe("parseRoutes", () => {
  const rejected = [
    [{}, /non-empty JSON array/],
    [[], /non-empty JSON array/],
    [[{ method: "GET", path: "/items/{id}" }], /no example in params for \{id\}/],
    [[{ method: "GET", path: "/a" }, { method: "get", path: "/a" }], /listed twice/],
    [[{ method: "G T", path: "/a" }], /no valid method/],
    [[{ method: "GET", path: "/a?x=1" }], /has no query/],
    [[{ method: "GET", path: "a" }], /starts with \//],
    [[{ method: "GET", path: "/a", headers: { X: "a\r\nInjected: 1" } }], /single-line strings/],
    [[{ method: "GET", path: "/a", query: { x: { nested: 1 } } }], /strings or numbers/],
    [[{ method: "GET", path: "/a", headers: { Authorization: "Bearer local" } }], /sets Authorization; pass credentials with --header/],
    [[{ method: "GET", path: "/a", query: { access: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl" } }], /token-shaped value/],
    [[{ method: "POST", path: "/a", body: { key: "k3y0123456789abcdefghijklmnopqrstuv" } }], /token-shaped value/],
  ];
  for (const [value, reason] of rejected) {
    test(`refuses ${JSON.stringify(value)}`, () => assert.throws(() => parseRoutes(value), (error) => error instanceof RouteError && reason.test(error.message)));
  }
});

test("a canonical UUID example is accepted and left unredacted", () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(parseRoutes([{ method: "GET", path: "/items/{id}", params: { id: uuid } }])[0].params.id, uuid);
  assert.equal(isTokenShaped(`/items/${uuid}`), false);
});

describe("encodePart", () => {
  test("percent-encodes UTF-8 bytes and survives a lone surrogate", () => {
    assert.equal(encodePart("a b/é-_.~"), "a%20b%2F%C3%A9-_.~");
    assert.equal(encodePart("\uD800"), "%EF%BF%BD");
  });
});
