// The desktop app's rules on what may load, open and be read (desktop/src/guard.ts): the window holds
// window.kiwi (the person's keys), so it must only ever show the app, and must never lose them.

import { describe, expect, test } from "bun:test";
import { externalUrl, isAppUrl, readStore } from "../desktop/src/guard.ts";

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
});
