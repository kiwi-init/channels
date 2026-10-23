// The desktop app's rules on what may load, open and be read (desktop/src/guard.ts): the window holds
// window.kiwi (the person's keys), so it must only ever show the app, and must never lose them.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ChannelIdentityView, ComputerView, PersonView } from "../desktop/src/bridge.ts";
import {
  chooseStore,
  claimFor,
  csp,
  externalUrl,
  fileFor,
  isAppUrl,
  loadCopies,
  mergeChannels,
  normalizeRelay,
  permissionAllowed,
  publicComputer,
  readStore,
  snapshotOf,
  writePrivate,
  keyringState,
  needsResave,
} from "../desktop/src/guard.ts";
import { encodeJoinCode, newRoomId } from "@kiwi/core/crypto.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { checkPerson } from "@kiwi/core/person.ts";

describe("the window shows the app and nothing else (T183)", () => {
  test("only kiwi-app://app/ is the app", () => {
    expect(isAppUrl("kiwi-app://app/index.html?x=1#code")).toBe(true);
    for (const u of ["https://evil.example/", "kiwi-app://evil/index.html", "file:///etc/passwd", "kiwi://join/abc", "not a url"]) expect(isAppUrl(u)).toBe(false);
  });
  test("only http(s) leaves for the system browser", () => {
    expect(externalUrl("https://github.com/x")).toBe("https://github.com/x");
    expect(externalUrl("http://localhost:8787/")).toBe("http://localhost:8787/");
    for (const u of ["javascript:alert(1)", "file:///Applications", "kiwi-app://app/", "smb://share", "data:text/html,hi", ""]) expect(externalUrl(u)).toBeNull();
  });
  test("copying is allowed only from kiwi-app://, and the microphone or camera never", () => {
    expect(permissionAllowed("kiwi-app://app/index.html", "clipboard-sanitized-write")).toBe(true);
    expect(permissionAllowed("kiwi-app://app/index.html", "media")).toBe(false);
    expect(permissionAllowed("kiwi-app://app/", "notifications")).toBe(false);
    expect(permissionAllowed("kiwi-app://app/", "clipboard-read")).toBe(false);
    expect(permissionAllowed("https://evil.example/", "clipboard-sanitized-write")).toBe(false);
  });
});

describe("the saved keys are never lost to a bad read (T186)", () => {
  const store = { relayUrl: "https://r.example", person: { name: "jow" } };
  const enc = (s: string) => Buffer.from(`ENC:${s}`);
  const decrypt = (b: Buffer) => {
    const s = b.toString("utf8");
    if (!s.startsWith("ENC:")) throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
    return s.slice(4);
  };
  test("no file is a first run; an encrypted or a plain one reads", () => {
    expect(readStore(null, decrypt)).toEqual({ kind: "none" });
    expect(readStore(enc(JSON.stringify(store)), decrypt)).toEqual({ kind: "ok", json: store, encrypted: true });
    // Written while the keychain was away: plain JSON, read even now that encryption works.
    expect(readStore(Buffer.from(JSON.stringify(store)), decrypt)).toEqual({ kind: "ok", json: store, encrypted: false });
    expect(readStore(Buffer.from(JSON.stringify(store)), null)).toEqual({ kind: "ok", json: store, encrypted: false });
  });
  test("a file it can't decrypt or parse is unreadable, never an empty store", () => {
    // Encrypted, with the keychain locked (no decrypt): must not read as empty.
    expect(readStore(enc(JSON.stringify(store)), null).kind).toBe("unreadable");
    expect(readStore(Buffer.from('{"relayUrl": "https://r.exa'), decrypt).kind).toBe("unreadable");
    expect(readStore(Buffer.from("[1,2]"), null).kind).toBe("unreadable");
    expect(readStore(Buffer.from(""), decrypt).kind).toBe("unreadable");
    const locked = readStore(Buffer.from("\x00\x01garbage"), decrypt);
    expect(locked.kind === "unreadable" && locked.why).toContain("decrypt");
  });
  test("a missing or broken store comes back from its backup, which is never used over a good one or a locked keychain", () => {
    const good = enc(JSON.stringify(store));
    const older = enc(JSON.stringify({ ...store, person: { name: "older" } }));
    const torn = Buffer.from('{"relayUrl": "https://r.exa');
    expect(chooseStore(good, older, decrypt)).toEqual({ read: { kind: "ok", json: store, encrypted: true }, restore: null });
    expect(chooseStore(torn, good, decrypt)).toEqual({ read: { kind: "ok", json: store, encrypted: true }, restore: good });
    expect(chooseStore(null, good, decrypt)).toEqual({ read: { kind: "ok", json: store, encrypted: true }, restore: good });
    expect(chooseStore(torn, torn, decrypt)).toEqual({ read: readStore(torn, decrypt), restore: null });
    expect(chooseStore(null, torn, decrypt)).toEqual({ read: readStore(torn, decrypt), restore: null });
    expect(chooseStore(null, null, decrypt)).toEqual({ read: { kind: "none" }, restore: null });
    expect(chooseStore(good, good, null).read.kind).toBe("unreadable");
    expect(chooseStore(good, good, null).restore).toBeNull();
  });
});

describe.skipIf(process.platform === "win32" || process.getuid?.() === 0)("loading the store's two copies (T855)", () => {
  const enc = (s: string) => Buffer.from(`enc:${s}`);
  const decrypt = (b: Buffer) => {
    const s = b.toString("utf8");
    if (!s.startsWith("enc:")) throw new Error("not encrypted");
    return s.slice(4);
  };
  const good = enc('{"relayUrl":"https://r.example"}');

  function folder(files: Record<string, Buffer | string>, locked: string[] = []): string {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-copies-"));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    for (const name of locked) chmodSync(join(dir, name), 0o000);
    return dir;
  }

  test("no main file and a .bak that can't be decrypted or parsed is unreadable, never a first run", () => {
    const dir = folder({ "kiwi-store.bin.bak": Buffer.from("\x00\x01garbage") });
    try {
      const loaded = loadCopies(join(dir, "kiwi-store.bin"), decrypt);
      expect(loaded.ok && loaded.choice.read.kind).toBe("unreadable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no main file and a .bak this user can't open is unreadable too", () => {
    const dir = folder({ "kiwi-store.bin.bak": good }, ["kiwi-store.bin.bak"]);
    try {
      const loaded = loadCopies(join(dir, "kiwi-store.bin"), decrypt);
      expect(loaded.ok).toBe(false);
      expect(!loaded.ok && loaded.why).toContain("its backup can't be read");
    } finally {
      chmodSync(join(dir, "kiwi-store.bin.bak"), 0o600);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a good main file decides even when its .bak can't be opened, and a main that can't be opened is unreadable", () => {
    const dir = folder({ "kiwi-store.bin": good, "kiwi-store.bin.bak": good }, ["kiwi-store.bin.bak"]);
    const locked = folder({ "kiwi-store.bin": good }, ["kiwi-store.bin"]);
    try {
      const loaded = loadCopies(join(dir, "kiwi-store.bin"), decrypt);
      expect(loaded.ok && loaded.choice.read).toEqual({ kind: "ok", json: { relayUrl: "https://r.example" }, encrypted: true });
      expect(loadCopies(join(locked, "kiwi-store.bin"), decrypt).ok).toBe(false);
    } finally {
      chmodSync(join(dir, "kiwi-store.bin.bak"), 0o600);
      chmodSync(join(locked, "kiwi-store.bin"), 0o600);
      rmSync(dir, { recursive: true, force: true });
      rmSync(locked, { recursive: true, force: true });
    }
  });

  test("neither copy is a first run", () => {
    const dir = folder({});
    try {
      const loaded = loadCopies(join(dir, "kiwi-store.bin"), decrypt);
      expect(loaded.ok && loaded.choice.read).toEqual({ kind: "none" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("kiwi-app:// serves web/dist and nothing beside it (T187)", () => {
  const root = "/app/web/dist";
  test("files inside, and routes as index.html", () => {
    expect(fileFor(root, "/assets/index-abc.js")).toBe(join(root, "assets/index-abc.js"));
    expect(fileFor(root, "/")).toBe(join(root, "index.html"));
    expect(fileFor(root, "/channels/abc")).toBe(join(root, "index.html"));
    expect(fileFor(root, "/a%20b.png")).toBe(join(root, "a b.png"));
  });
  test("never a file outside it, a sibling that shares its name, or a bad escape", () => {
    for (const p of ["/../dist-extra/x.js", "/%2e%2e/dist-extra/x.js", "/..%2f..%2fetc/passwd.txt", "/a/../../../etc/hosts.txt", "/%E0%A4%A.js", "/x%00.js"]) {
      const f = fileFor(root, p);
      expect(f === null || f.startsWith(`${root}/`)).toBe(true);
    }
    expect(fileFor(root, "/%E0%A4%A.js")).toBeNull();
    expect(fileFor(root, "/x%00.js")).toBeNull();
    expect(fileFor(root, "/../dist-extra/x.js")).toBe(join(root, "dist-extra/x.js"));
  });
});

describe("kiwi-app:// sends a CSP (T184)", () => {
  const directives = (p: string) => new Map(p.split("; ").map((d) => [d.split(" ")[0]!, d.split(" ").slice(1)]));
  test("only the app's own script; its relay over HTTP and WebSocket; nothing framed or posted", () => {
    const d = directives(csp("https://channels.kiwiinit.com"));
    expect(d.get("script-src")).toEqual(["'self'"]);
    expect(d.get("worker-src")).toEqual(["'self'"]);
    expect(d.get("connect-src")).toEqual(expect.arrayContaining(["'self'", "https://channels.kiwiinit.com", "wss://channels.kiwiinit.com"]));
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("form-action")).toEqual(["'none'"]);
    expect(csp("http://localhost:8787")).toContain("ws://localhost:8787");
    // A relay that isn't one adds nothing to connect to.
    expect(csp("http://attacker.example")).not.toContain("attacker");
    for (const p of [csp("https://r.example")]) expect(p).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
    expect(csp("https://r.example")).not.toContain("blob:'");
    expect(directives(csp("https://r.example")).get("worker-src")).toEqual(["'self'"]);
  });
  test("it allows what the hosted web's CSP does (web/public/_headers), except WorkOS: in the app, main signs in", () => {
    const hosted = /Content-Security-Policy: (.*)/.exec(readFileSync(new URL("../web/public/_headers", import.meta.url), "utf8"))![1]!;
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

  test("linked phones show only a label and a time", () => {
    const snap = snapshotOf({ relayUrl: "https://r.example", person, channels: [], computers: [], phones: [{ label: "Ada's iPhone", at: 5 }], pending: [] });
    expect(snap.phones).toEqual([{ label: "Ada's iPhone", at: 5 }]);
    expect(snapshotOf({ relayUrl: "https://r.example", person, channels: [], computers: [], pending: [] }).phones).toEqual([]);
  });

  test("main makes the person's claim for a join, and it checks out", async () => {
    const me = await generateIdentity("jow");
    const member = await generateIdentity("jow-agent");
    const room = newRoomId();
    const claim = await claimFor(me, encodeJoinCode({ roomId: room, ownerFp: "A".repeat(16) }), member.pk);
    expect(await checkPerson(claim, room, member.pk)).toBe(me.pk);
    expect(() => claimFor(me, 42, member.pk)).toThrow("bad person claim request");
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

test("on Linux, no encryption or Chromium's basic_text backend means the keys are in plain text; a Mac with encryption has its keychain", () => {
  expect(keyringState("linux", false, null)).toBe("plain");
  expect(keyringState("linux", true, "basic_text")).toBe("plain");
  expect(keyringState("linux", true, "unknown")).toBe("plain");
  expect(keyringState("linux", true, "gnome_libsecret")).toBe("keyring");
  expect(keyringState("linux", true, "kwallet5")).toBe("keyring");
  expect(keyringState("darwin", true, null)).toBe("keyring");
  expect(keyringState("darwin", false, null)).toBe("plain");
});

test("a store kept without a keyring is saved again into one once it's there, and only then", () => {
  const ok = { kind: "ok" as const, json: {}, encrypted: true };
  const plain = { kind: "ok" as const, json: {}, encrypted: false };
  expect(needsResave("linux", Buffer.from("{}"), plain, "keyring")).toBe(true);
  expect(needsResave("linux", Buffer.from("v10xxxx"), ok, "keyring")).toBe(true);
  expect(needsResave("linux", Buffer.from("v11xxxx"), ok, "keyring")).toBe(false);
  expect(needsResave("linux", Buffer.from("{}"), plain, "plain")).toBe(false);
  expect(needsResave("darwin", Buffer.from("v10xxxx"), ok, "keyring")).toBe(false);
  expect(needsResave("linux", null, { kind: "none" }, "keyring")).toBe(false);
});
