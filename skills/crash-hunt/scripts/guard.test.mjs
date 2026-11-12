import assert from "node:assert/strict";
import diagnosticsChannel from "node:diagnostics_channel";
import { lookup } from "node:dns/promises";
import { describe, test } from "node:test";

import { GuardError, assertLoopback, isLoopbackAddress, resolveTarget } from "./guard.mjs";

const countingLookup = () => {
  const calls = [];
  return { calls, lookup: (host, options) => (calls.push(host), lookup(host, options)) };
};

const clientSocketsDuring = async (work) => {
  let sockets = 0;
  const onSocket = () => {
    sockets += 1;
  };
  diagnosticsChannel.subscribe("net.client.socket", onSocket);
  try {
    await work();
  } finally {
    diagnosticsChannel.unsubscribe("net.client.socket", onSocket);
  }
  return sockets;
};

describe("isLoopbackAddress", () => {
  test("accepts 127.0.0.0/8, ::1, and IPv4-mapped loopback in either notation", () => {
    for (const address of ["127.0.0.1", "127.255.255.254", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
      assert.equal(isLoopbackAddress(address), true, address);
    }
  });
  test("rejects every other address and anything that is not an IP", () => {
    for (const address of ["10.0.0.1", "0.0.0.0", "::", "::ffff:10.0.0.1", "::127.0.0.1", "128.0.0.1", "169.254.169.254", "localhost", "", undefined]) {
      assert.equal(isLoopbackAddress(address), false, String(address));
    }
  });
});

describe("assertLoopback", () => {
  test("an empty address list is refused, not vacuously accepted", () => {
    assert.throws(() => assertLoopback("app", []), GuardError);
  });
  test("one non-loopback address refuses the whole target", () => {
    assert.throws(() => assertLoopback("app", ["127.0.0.1", "10.0.0.1"]), /10\.0\.0\.1, which is not loopback/);
  });
});

describe("resolveTarget accepts loopback", () => {
  const accepted = [
    ["http://127.0.0.1:8080/", "127.0.0.1:8080"],
    ["http://[::1]:8080/", "[::1]:8080"],
    ["http://localhost:3000/", "localhost:3000"],
    ["http://2130706433/", "127.0.0.1"],
    ["http://[::ffff:127.0.0.1]/", "[::ffff:7f00:1]"],
  ];
  for (const [base, hostHeader] of accepted) {
    test(base, async () => {
      const target = await resolveTarget(base);
      assert.ok(target.addresses.length > 0);
      assert.ok(target.addresses.every(isLoopbackAddress), target.addresses.join(", "));
      assert.equal(target.hostHeader, hostHeader);
      assert.equal(target.address, null);
    });
  }
  test("keeps the base path without its trailing slash and fills the default port", async () => {
    assert.deepEqual((({ basePath, port }) => ({ basePath, port }))(await resolveTarget("http://127.0.0.1/api/v1/")), { basePath: "/api/v1", port: 80 });
    assert.equal((await resolveTarget("https://127.0.0.1/")).port, 443);
  });
});

describe("resolveTarget refuses before any lookup or connection", () => {
  const refused = [
    ["http://127.0.0.1@example.com/", /userinfo/],
    ["http://user:hunter2@127.0.0.1/", /userinfo/],
    ["http://app.invalid/", /reserved \.invalid/],
    ["http://app.invalid./", /reserved \.invalid/],
    ["ftp://127.0.0.1/", /ftp: is not http or https/],
    ["file:///etc/hosts", /file: is not http or https/],
    ["ws://127.0.0.1/", /ws: is not http or https/],
    ["not a url", /not a URL/],
    ["http://127.0.0.1/?q=1", /query or fragment/],
  ];
  for (const [base, reason] of refused) {
    test(base, async () => {
      const { calls, lookup: counted } = countingLookup();
      const sockets = await clientSocketsDuring(() =>
        assert.rejects(resolveTarget(base, { lookup: counted }), (error) => error instanceof GuardError && reason.test(error.message) && !error.message.includes("hunter2")),
      );
      assert.deepEqual(calls, []);
      assert.equal(sockets, 0);
    });
  }
  test("a non-loopback IP is refused after a local lookup and opens no socket", async () => {
    const { calls, lookup: counted } = countingLookup();
    const sockets = await clientSocketsDuring(() => assert.rejects(resolveTarget("http://10.0.0.1/", { lookup: counted }), /10\.0\.0\.1, which is not loopback/));
    assert.deepEqual(calls, ["10.0.0.1"]);
    assert.equal(sockets, 0);
  });
  test("a lookup that fails is refused", async () => {
    const failing = async () => {
      throw Object.assign(new Error("no such host"), { code: "ENOTFOUND" });
    };
    await assert.rejects(resolveTarget("http://app.localhost/", { lookup: failing }), /does not resolve \(ENOTFOUND\)/);
  });
});
