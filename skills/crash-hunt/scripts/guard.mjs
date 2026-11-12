import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

export class GuardError extends Error {}

const loopback = new net.BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");
loopback.addSubnet("::ffff:127.0.0.0", 104, "ipv6");

const reservedNeverResolves = /(?:^|\.)invalid\.?$/i;

export const isLoopbackAddress = (address) => {
  const family = net.isIP(String(address));
  return family !== 0 && loopback.check(address, family === 6 ? "ipv6" : "ipv4");
};

export const assertLoopback = (hostname, addresses) => {
  if (!Array.isArray(addresses) || addresses.length === 0) throw new GuardError(`refused: ${hostname} resolved to no address`);
  const outside = addresses.filter((address) => !isLoopbackAddress(address));
  if (outside.length > 0) throw new GuardError(`refused: ${hostname} resolves to ${outside.join(", ")}, which is not loopback`);
};

export const parseBase = (text) => {
  let url;
  try {
    url = new URL(String(text ?? ""));
  } catch {
    throw new GuardError("refused: --base is not a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new GuardError(`refused: ${url.protocol} is not http or https`);
  if (url.username !== "" || url.password !== "") throw new GuardError("refused: the URL carries userinfo");
  if (url.search !== "" || url.hash !== "") throw new GuardError("refused: the base URL carries a query or fragment");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (reservedNeverResolves.test(hostname)) throw new GuardError(`refused: ${hostname} is under the reserved .invalid name`);
  return { url, hostname };
};

export const resolveTarget = async (text, { lookup = dnsLookup } = {}) => {
  const { url, hostname } = parseBase(text);
  let records;
  try {
    records = await lookup(hostname, { all: true });
  } catch (error) {
    throw new GuardError(`refused: ${hostname} does not resolve (${error?.code ?? error?.message})`);
  }
  const addresses = [...new Set((records ?? []).map(({ address }) => address))];
  assertLoopback(hostname, addresses);
  return {
    protocol: url.protocol,
    hostname,
    hostHeader: url.host,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    basePath: url.pathname.replace(/\/+$/, ""),
    addresses,
    address: null,
    servername: net.isIP(hostname) ? undefined : hostname,
  };
};
