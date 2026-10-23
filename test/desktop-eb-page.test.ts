import { describe, expect, test } from "bun:test";

import { navigationUrl, openedUrl, PAGE_RULES, PAGE_URL, pageWithCsp } from "../desktop/src/eb-page.ts";
import { csp } from "../desktop/src/guard.ts";

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script type="module" crossorigin src="/assets/index.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

describe("the Electrobun page carries the app's CSP before any script (T434)", () => {
  test("the CSP <meta> is the first thing in <head>, ahead of every script", () => {
    const page = pageWithCsp(INDEX, "https://channels.kiwiinit.com");
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp("https://channels.kiwiinit.com")}">`;
    expect(page).toContain(`<head>${meta}`);
    expect(page.indexOf(meta)).toBeLessThan(page.indexOf("<script"));
    expect(page.replace(meta, "")).toBe(INDEX);
  });

  test("the relay in the CSP is the one asked for, and only that one", () => {
    const page = pageWithCsp(INDEX, "https://relay.example.com/some/path");
    expect(page).toContain("connect-src 'self' https://relay.example.com wss://relay.example.com;");
    expect(page).not.toContain("channels.kiwiinit.com");
  });

  test("a relay the app may not talk to leaves connect-src at 'self'", () => {
    expect(pageWithCsp(INDEX, "http://relay.example.com")).toContain("connect-src 'self';");
    expect(pageWithCsp(INDEX, "javascript:alert(1)")).toContain("connect-src 'self';");
  });

  test("a <head> with attributes still gets the CSP first", () => {
    const page = pageWithCsp(INDEX.replace("<head>", '<head data-x="1">'), "https://channels.kiwiinit.com");
    expect(page).toContain('<head data-x="1"><meta http-equiv="Content-Security-Policy"');
  });

  test("a page it can't put the CSP in front of is refused", () => {
    expect(() => pageWithCsp("<html><body>no head</body></html>", "https://channels.kiwiinit.com")).toThrow("no <head>");
    expect(() => pageWithCsp(`<script>1</script>${INDEX}`, "https://channels.kiwiinit.com")).toThrow("before <head>");
    expect(() => pageWithCsp(INDEX.replace("<head>", "<header>"), "https://channels.kiwiinit.com")).toThrow("no <head>");
  });
});

describe("the window shows the page and sends everything else to the browser (T434)", () => {
  test("navigation is blocked everywhere but the page's own origin", () => {
    expect(PAGE_RULES[0]).toBe("^*");
    expect(PAGE_RULES.slice(1)).toEqual(["views://internal/*"]);
    expect(PAGE_URL.startsWith("views://internal/")).toBe(true);
  });

  test("will-navigate details are read only when WebKit's JSON is whole", () => {
    expect(navigationUrl('{"url":"https://github.com/x","allowed":false}')).toEqual({ url: "https://github.com/x", allowed: false });
    expect(navigationUrl('{"url":"views://internal/index.html","allowed":true}')).toEqual({ url: "views://internal/index.html", allowed: true });
    for (const d of ['{"url":"https://x"}', '{"allowed":false}', '{"url":1,"allowed":false}', "not json", "null", 42, null, undefined, { url: "https://x", allowed: false }])
      expect(navigationUrl(d)).toBeNull();
  });

  test("window.open and target=_blank hand over their URL", () => {
    expect(openedUrl({ url: "https://github.com/x", isCmdClick: false })).toBe("https://github.com/x");
    expect(openedUrl("https://github.com/x")).toBe("https://github.com/x");
    for (const d of [null, undefined, 1, {}, { url: 2 }]) expect(openedUrl(d)).toBeNull();
  });
});
