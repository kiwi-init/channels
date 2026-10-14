// The desktop app's rules on what may load, open and be read (desktop/src/guard.ts): the window holds
// window.kiwi (the person's keys), so it must only ever show the app, and must never lose them.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { csp, externalUrl, fileFor, isAppUrl, readStore } from "../desktop/src/guard.ts";

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
    expect(d.get("connect-src")).toEqual(expect.arrayContaining(["'self'", "https://channels.kiwiinit.com", "wss://channels.kiwiinit.com"]));
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("form-action")).toEqual(["'none'"]);
    expect(csp("http://localhost:8787")).toContain("ws://localhost:8787");
    // A relay that isn't one adds nothing to connect to.
    expect(csp("http://attacker.example")).not.toContain("attacker");
    for (const p of [csp("https://r.example")]) expect(p).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
  });
  test("it allows what the hosted web's CSP does (web/public/_headers), except WorkOS: in the app, main signs in", () => {
    const hosted = /Content-Security-Policy: (.*)/.exec(readFileSync(new URL("../web/public/_headers", import.meta.url), "utf8"))![1]!;
    const app = directives(csp("https://r.example"));
    for (const [name, values] of directives(hosted)) for (const v of values) if (!/workos|authkit/.test(v)) expect(app.get(name) ?? []).toContain(v);
    expect(csp("https://r.example")).not.toMatch(/workos|authkit/);
  });
});
