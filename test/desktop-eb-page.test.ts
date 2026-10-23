import { describe, expect, test } from "bun:test";

import { isPageUrl, navigation, openedUrl, PAGE_RULES, PAGE_URL, pageWithCsp, RULES_CANARY } from "../desktop/src/eb-page.ts";
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
    expect(() => pageWithCsp("<html><body>no head</body></html>", "https://channels.kiwiinit.com")).toThrow("only a doctype");
    expect(() => pageWithCsp(`<script>1</script>${INDEX}`, "https://channels.kiwiinit.com")).toThrow("only a doctype");
    expect(() => pageWithCsp(INDEX.replace("<head>", "<header>"), "https://channels.kiwiinit.com")).toThrow("only a doctype");
  });

  test("<head> is found by the page's structure, not by the first match of its text (T804)", () => {
    const relay = "https://channels.kiwiinit.com";
    const tricks = [
      `<!-- <head> -->${INDEX}`,
      `text first<head><meta charset="UTF-8"></head>`,
      `<!doctype html><body><head></head></body>`,
      `<!doctype html><title>t</title><head></head>`,
      `<!doctype html><head/>`,
    ];
    for (const page of tricks) expect(() => pageWithCsp(page, relay)).toThrow("only a doctype");
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp(relay)}">`;
    const placed: [string, string][] = [
      [`\uFEFF<!doctype html><head></head>`, `\uFEFF<!doctype html><head>${meta}</head>`],
      [`<!DOCTYPE html><HTML><HEAD></HEAD></HTML>`, `<!DOCTYPE html><HTML><HEAD>${meta}</HEAD></HTML>`],
      [`<html data-x="<head>"><head></head></html>`, `<html data-x="<head>"><head>${meta}</head></html>`],
      [`<head data-a='x>y'>`, `<head data-a='x>y'>${meta}`],
      [`  <head\n>`, `  <head\n>${meta}`],
    ];
    for (const [page, want] of placed) expect(pageWithCsp(page, relay)).toBe(want);
  });
});

describe("the window shows the page and sends everything else to the browser (T434, T804)", () => {
  test("navigation is allowed to the one page only, with its hash or query", () => {
    expect(PAGE_RULES).toEqual(["^*", PAGE_URL, `${PAGE_URL}#*`, `${PAGE_URL}?*`]);
    for (const u of [PAGE_URL, `${PAGE_URL}#mc2-abc`, `${PAGE_URL}?relay=http://127.0.0.1:8787`, "views://internal/Index.html"]) expect(isPageUrl(u)).toBe(true);
    for (const u of ["views://internal/assets/index.js?.html", "views://internal/index.htmlx", "views://internal/", "views://internal/index.html/..", RULES_CANARY, "https://channels.kiwiinit.com/"])
      expect(isPageUrl(u)).toBe(false);
  });

  test("a will-navigate is the page, a refusal to send to the browser, or a breach that closes the app", () => {
    expect(navigation('{"url":"views://internal/index.html#x","allowed":true}')).toEqual({ kind: "page" });
    expect(navigation('{"url":"https://github.com/x","allowed":false}')).toEqual({ kind: "refused", url: "https://github.com/x" });
    expect(navigation(`{"url":"${RULES_CANARY}","allowed":false}`)).toEqual({ kind: "refused", url: RULES_CANARY });
    expect(navigation('{"url":"https://evil.example/","allowed":true}')).toEqual({ kind: "breach", url: "https://evil.example/" });
    expect(navigation(`{"url":"${RULES_CANARY}","allowed":true}`)).toEqual({ kind: "breach", url: RULES_CANARY });
    for (const d of ['{"url":"https://x"}', '{"allowed":false}', '{"url":1,"allowed":false}', "not json", "null", 42, null, undefined, { url: "https://x", allowed: false }])
      expect(navigation(d)).toEqual({ kind: "breach", url: null });
  });

  test("window.open and target=_blank hand over their URL", () => {
    expect(openedUrl({ url: "https://github.com/x", isCmdClick: false })).toBe("https://github.com/x");
    expect(openedUrl("https://github.com/x")).toBe("https://github.com/x");
    for (const d of [null, undefined, 1, {}, { url: 2 }]) expect(openedUrl(d)).toBeNull();
  });
});
