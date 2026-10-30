// The desktop app's rules on what may load, open and be read (desktop/src/guard.ts): the window holds
// window.kiwi (the person's keys), so it must only ever show the app, and must never lose them.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ChannelIdentityView, ComputerView, PersonView } from "../desktop/src/bridge.ts";
import { csp, externalUrl, mergeChannels, normalizeRelay, publicComputer, snapshotOf, writePrivate } from "../desktop/src/guard.ts";

describe("the window shows the app and nothing else (T183)", () => {
  test("only http(s) leaves for the system browser", () => {
    expect<string | null>(externalUrl("https://github.com/x")).toBe("https://github.com/x");
    expect<string | null>(externalUrl("http://localhost:8787/")).toBe("http://localhost:8787/");
    for (const u of ["javascript:alert(1)", "file:///Applications", "kiwi-app://app/", "smb://share", "data:text/html,hi", ""]) expect(externalUrl(u)).toBeNull();
  });
});

describe("the page gets a CSP (T184)", () => {
  const directives = (p: string) => new Map(p.split("; ").map((d) => [d.split(" ")[0]!, d.split(" ").slice(1)]));
  test("only the app's own script; its relay over HTTP and WebSocket; nothing framed or posted", () => {
    const d = directives(csp("https://channels.kiwiinit.com"));
    expect(d.get("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(d.get("worker-src")).toEqual(["'self'"]);
    expect(d.get("connect-src")).toEqual(expect.arrayContaining(["'self'", "https://channels.kiwiinit.com", "wss://channels.kiwiinit.com"]));
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("form-action")).toEqual(["'none'"]);
    expect(csp("http://localhost:8787")).toContain("ws://localhost:8787");
    // A relay that isn't one adds nothing to connect to.
    expect(csp("http://attacker.example")).not.toContain("attacker");
    for (const p of [csp("https://r.example")]) expect(p).not.toMatch(/'unsafe-eval'|script-src[^;]*unsafe-inline/);
    expect(csp("https://r.example")).not.toContain("blob:'");
    expect(directives(csp("https://r.example")).get("worker-src")).toEqual(["'self'"]);
  });
  test("it allows what the hosted app's CSP does (ui/public/_headers), except WorkOS: in the app, main signs in", () => {
    const hosted = /Content-Security-Policy: (.*)/.exec(readFileSync(new URL("../ui/public/_headers", import.meta.url), "utf8"))![1]!;
    const app = directives(csp("https://r.example"));
    for (const [name, values] of directives(hosted)) for (const v of values) if (!/workos|authkit/.test(v)) expect(app.get(name) ?? []).toContain(v);
    expect(csp("https://r.example")).not.toMatch(/workos|authkit/);
  });
});

describe("the person key stays in main (T203)", () => {
  const person: PersonView = { name: "jow", pk: "PK", sk: "SK", xpk: "XPK", xsk: "XSK" };

  test("the renderer's snapshot has the person's public keys only", () => {
    const snap = snapshotOf({ relayUrl: "https://r.example", person, channels: [], computers: [], pending: [] });
    expect(snap.person).toEqual({ name: "jow", pk: "PK", xpk: "XPK" });
    expect(JSON.stringify(snap)).not.toContain('SK"');
    expect(snapshotOf({ relayUrl: "https://r.example", person: null, channels: [], computers: [], pending: [] }).person).toBeNull();
  });

  test("linked phones show a label, a time and the channels they were sent, never keys", () => {
    const snap = snapshotOf({ relayUrl: "https://r.example", person, channels: [], computers: [], phones: [{ label: "Ada's iPhone", at: 5 }], pending: [] });
    expect(snap.phones).toEqual([{ label: "Ada's iPhone", at: 5 }]);
    const held = snapshotOf({ relayUrl: "https://r.example", person, channels: [], computers: [], phones: [{ label: "Ada's iPhone", at: 5, channels: ["kiwi", "landing"] }], pending: [] });
    expect(held.phones).toEqual([{ label: "Ada's iPhone", at: 5, channels: ["kiwi", "landing"] }]);
    expect(snapshotOf({ relayUrl: "https://r.example", person, channels: [], computers: [], pending: [] }).phones).toEqual([]);
  });
});

describe("the renderer can't change a saved channel's keys (T203)", () => {
  const ch = (keys: Record<string, string>, over: Partial<ChannelIdentityView> = {}): ChannelIdentityView => ({
    label: "c",
    pk: "pk1",
    sk: "sk1",
    xpk: "x1",
    xsk: "xs1",
    roomId: "r1",
    access: { roomId: "r1", keys },
    ...over,
  });
  const stored = [ch({ "0": "k0" })];

  test("adding a channel, removing one, and adding the next epoch's key are kept", () => {
    const added = [...stored, ch({ "0": "z" }, { pk: "pk2", sk: "sk2", roomId: "r2" })];
    expect(mergeChannels(stored, added)).toEqual(added);
    expect(mergeChannels(stored, [])).toEqual([]);
    expect(mergeChannels(stored, [ch({ "0": "k0", "1": "k1" })])).toEqual([ch({ "0": "k0", "1": "k1" })]);
  });

  test("a different secret key, or a changed or missing epoch key, is refused", () => {
    expect(() => mergeChannels(stored, [ch({ "0": "k0" }, { sk: "evil" })])).toThrow("can't change");
    expect(() => mergeChannels(stored, [ch({ "0": "k0" }, { xsk: "evil" })])).toThrow("can't change");
    expect(() => mergeChannels(stored, [ch({ "0": "evil" })])).toThrow("can't change");
    expect(() => mergeChannels(stored, [ch({ "1": "k1" })])).toThrow("can't change");
  });

  test("a computer keeps its public fields only", () => {
    const sneaky = { label: "mac", os: "macos", machinePk: "m", machineXpk: "mx", personPk: "p", at: 1, sk: "secret" } as ComputerView;
    expect(publicComputer(sneaky)).toEqual({ label: "mac", os: "macos", machinePk: "m", machineXpk: "mx", personPk: "p", at: 1 });
  });
});

describe.skipIf(process.platform === "win32")("the saved keys are a 0600 file in a 0700 folder (T203)", () => {
  test("even when the folder was already there and open to others", () => {
    const root = mkdtempSync(join(tmpdir(), "kiwi-store-"));
    try {
      const dir = join(root, "Channels");
      mkdirSync(dir, { mode: 0o755 });
      chmodSync(dir, 0o755);
      const file = join(dir, "kiwi-store.bin");
      writePrivate(file, Buffer.from("{}"));
      writePrivate(file, Buffer.from('{"a":1}'));
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a link at the store's path or at a guessable temp name is never written through, and no temp file is left", () => {
    const root = mkdtempSync(join(tmpdir(), "kiwi-store-"));
    try {
      const dir = join(root, "Channels");
      mkdirSync(dir, { mode: 0o700 });
      const elsewhere = join(root, "elsewhere");
      writeFileSync(elsewhere, "theirs");
      const file = join(dir, "kiwi-store.bin");
      symlinkSync(elsewhere, file);
      const planted = join(root, "planted");
      writeFileSync(planted, "theirs");
      symlinkSync(planted, `${file}.${process.pid}.tmp`);
      writePrivate(file, Buffer.from("{}"));
      expect(readFileSync(elsewhere, "utf8")).toBe("theirs");
      expect(readFileSync(planted, "utf8")).toBe("theirs");
      expect(lstatSync(file).isSymbolicLink()).toBe(false);
      expect(readFileSync(file, "utf8")).toBe("{}");
      expect(readdirSync(dir).sort()).toEqual(["kiwi-store.bin", `kiwi-store.bin.${process.pid}.tmp`]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("normalizeRelay", () => {
  test("https anywhere and http on this computer, as the origin", () => {
    expect(normalizeRelay("https://relay.example.org/path")).toBe("https://relay.example.org");
    expect(normalizeRelay(" http://localhost:8787 ")).toBe("http://localhost:8787");
    expect(normalizeRelay("https://relay.example.org./")).toBe("https://relay.example.org.");
    expect(normalizeRelay("http://relay.example.org")).toBeNull();
  });

  test("a host a shell would read as more than a word is refused", () => {
    expect(normalizeRelay("https://a;b$(id)/")).toBeNull();
    expect(normalizeRelay("https://a&b")).toBeNull();
    expect(normalizeRelay("https://ex`id`.com")).toBeNull();
  });
});
