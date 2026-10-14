// The desktop app's rules on what may load, open and be read (desktop/src/guard.ts): the window holds
// window.kiwi (the person's keys), so it must only ever show the app, and must never lose them.

import { describe, expect, test } from "bun:test";
import { externalUrl, isAppUrl } from "../desktop/src/guard.ts";

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
