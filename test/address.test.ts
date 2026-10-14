// Which client address a Bun request counts against (the pairing mailbox's write limit), and which
// reverse proxies may say so.
import { describe, expect, test } from "bun:test";
import { clientAddress, parseTrustProxy, trustProxyFromArgs, writeAllowed } from "../src/relay/address.ts";

describe("which address a write counts against", () => {
  test("the peer, unless it is loopback and the proxy is trusted", () => {
    expect(clientAddress("203.0.113.5", "1.2.3.4", true)).toBe("203.0.113.5");
    expect(clientAddress("203.0.113.5", "1.2.3.4", false)).toBe("203.0.113.5");
    expect(clientAddress("127.0.0.1", "1.2.3.4, 203.0.113.9", false)).toBe("127.0.0.1");
    expect(clientAddress("127.0.0.1", "1.2.3.4, 203.0.113.9", true)).toBe("203.0.113.9");
    expect(clientAddress("::ffff:127.0.0.1", "2001:db8::9", true)).toBe("2001:db8::9");
    expect(clientAddress("::1", "not an ip, [2001:db8::8]", true)).toBe("2001:db8::8");
    expect(clientAddress("127.0.0.1", "not an ip", true)).toBe("127.0.0.1");
    expect(clientAddress(null, "203.0.113.9", true)).toBeNull();
    // Docker's bridge is not loopback, so a bare flag still counts everyone as that one peer.
    expect(clientAddress("172.17.0.1", "203.0.113.9", true)).toBe("172.17.0.1");
  });

  test("a named address or CIDR is a trusted proxy too", () => {
    expect(clientAddress("172.17.0.1", "198.51.100.4, 203.0.113.9", ["172.17.0.1"])).toBe("203.0.113.9");
    expect(clientAddress("::ffff:172.17.0.1", "203.0.113.9", ["172.17.0.1"])).toBe("203.0.113.9");
    expect(clientAddress("172.17.5.9", "203.0.113.9", ["172.17.0.0/16"])).toBe("203.0.113.9");
    expect(clientAddress("172.18.0.1", "203.0.113.9", ["172.17.0.0/16"])).toBe("172.18.0.1");
    expect(clientAddress("10.1.2.3", "203.0.113.9", ["10.0.0.0/8"])).toBe("203.0.113.9");
    expect(clientAddress("11.0.0.1", "203.0.113.9", ["10.0.0.0/8"])).toBe("11.0.0.1");
    expect(clientAddress("127.0.0.1", "203.0.113.9", ["172.17.0.1"])).toBe("203.0.113.9");
    expect(clientAddress("fd00::1", "2001:db8::5", ["fd00::/8"])).toBe("2001:db8::5");
    expect(clientAddress("fe80::1", "2001:db8::5", ["fd00::/8"])).toBe("fe80::1");
    // Only the last entry is the proxy's. A garbage tail must not fall back to a forged earlier address.
    expect(clientAddress("172.17.0.1", "203.0.113.9, not-an-ip", ["172.17.0.1"])).toBe("172.17.0.1");
    expect(clientAddress("127.0.0.1", "203.0.113.50, garbage", true)).toBe("127.0.0.1");
    expect(() => parseTrustProxy(["0.0.0.0/0"])).toThrow(/not an IPv4 CIDR/);
    expect(() => parseTrustProxy(["not-an-ip"])).toThrow(/not an address/);
    expect(() => parseTrustProxy(["172.17.0.1/33"])).toThrow(/not an IPv4 CIDR/);
  });

  test("the flag and KIWI_TRUST_PROXY name who is trusted", () => {
    expect(trustProxyFromArgs([], undefined)).toBe(false);
    expect(trustProxyFromArgs(["--trust-proxy"], undefined)).toBe(true);
    expect(trustProxyFromArgs(["--trust-proxy", "--port"], undefined)).toBe(true);
    expect(trustProxyFromArgs([], "1")).toBe(true);
    expect(trustProxyFromArgs([], "0")).toBe(false);
    expect(trustProxyFromArgs(["--trust-proxy", "172.17.0.1,10.0.0.0/8"], undefined)).toEqual(["172.17.0.1", "10.0.0.0/8"]);
    expect(trustProxyFromArgs(["--trust-proxy", "172.17.0.1", "--trust-proxy", "10.1.0.0/16"], "1")).toEqual(["172.17.0.1", "10.1.0.0/16"]);
    expect(trustProxyFromArgs([], "172.17.0.1")).toEqual(["172.17.0.1"]);
  });

  test("a full table drops the oldest address, not every address", () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 20; i++) expect(writeAllowed("honest-kept", t0)).toBe(true);
    expect(writeAllowed("honest-kept", t0)).toBe(false);
    for (let i = 0; i < 10_000; i++) expect(writeAllowed(`flood-${i}`, t0)).toBe(true);
    // honest-kept was the oldest, so its window starts again. A key added at the end is still counted.
    expect(writeAllowed("honest-kept", t0)).toBe(true);
    for (let i = 0; i < 19; i++) expect(writeAllowed("flood-9999", t0)).toBe(true);
    expect(writeAllowed("flood-9999", t0)).toBe(false);
  });
});
