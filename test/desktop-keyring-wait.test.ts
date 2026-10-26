import { describe, expect, test } from "bun:test";

import { pageWithCsp } from "../desktop/src/eb-page.ts";
import { ASK_AGAIN_URL, keyringNote, keyringPage, openedWithin } from "../desktop/src/keyring-wait.ts";

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script type="module" crossorigin src="./assets/index-abc.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/vendor-def.js">
    <link rel="stylesheet" crossorigin href="./assets/index-ghi.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

const after = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("a keyring that doesn't answer doesn't keep the window away (T1550)", () => {
  test("a store that opens within the grace opens the app as before", async () => {
    expect(await openedWithin(after(5), 200)).toBe(true);
  });

  test("a store still waiting on the keyring after the grace shows the waiting window", async () => {
    expect(await openedWithin(new Promise<void>(() => {}), 20)).toBe(false);
  });

  test("a store that fails within the grace still fails the start", async () => {
    await expect(openedWithin(Promise.reject(new Error("no store")), 200)).rejects.toThrow("no store");
  });

  test("a store that fails after the grace is left to the start that waits on it, unhandled nowhere", async () => {
    const failing = after(30).then(() => {
      throw new Error("late");
    });
    expect(await openedWithin(failing, 5)).toBe(false);
    await expect(failing).rejects.toThrow("late");
  });

  test("the waiting page takes the app's stylesheet and none of its scripts", () => {
    const page = keyringPage(INDEX, "linux", "waiting");
    expect(page).toContain(`<link rel="stylesheet" crossorigin href="./assets/index-ghi.css">`);
    expect(page).not.toContain("<script");
    expect(page).not.toContain("modulepreload");
    expect(page).not.toContain(`id="root"`);
  });

  test("the waiting page takes the CSP first in <head>, as the app's page does", () => {
    const page = pageWithCsp(keyringPage(INDEX, "linux", "waiting"), "https://channels.kiwiinit.com");
    expect(page).toMatch(/^<!doctype html>\n<html lang="en">\n<head><meta http-equiv="Content-Security-Policy"/);
  });

  test("it says what it waits for in each platform's words", () => {
    expect(keyringPage(INDEX, "linux", "waiting")).toContain("Waiting for your keyring");
    expect(keyringPage(INDEX, "linux", "waiting")).toContain("GNOME Keyring or KDE Wallet");
    expect(keyringPage(INDEX, "darwin", "waiting")).toContain("Waiting for your keychain");
    expect(keyringNote("darwin", "waiting").detail).not.toContain("GNOME");
  });

  test("a cancelled prompt and a keyring that stayed locked each say so, and ask again", () => {
    expect(keyringPage(INDEX, "linux", "cancelled")).toContain("You cancelled the keyring prompt");
    expect(keyringPage(INDEX, "linux", "locked")).toContain("Your keyring stayed locked");
    for (const state of ["waiting", "cancelled", "locked"] as const) expect(keyringPage(INDEX, "linux", state)).toContain(`<a class="ask" href="${ASK_AGAIN_URL}">Ask again</a>`);
    expect(keyringPage(INDEX, "darwin", "waiting")).not.toContain(ASK_AGAIN_URL);
  });

  test("Ask again is a link the page rules refuse, so main hears of it and the page runs no script", () => {
    expect(ASK_AGAIN_URL.startsWith("views://internal/")).toBe(true);
    expect(ASK_AGAIN_URL).not.toBe("views://internal/index.html");
    expect(keyringPage(INDEX, "linux", "cancelled")).not.toContain("<script");
  });
});
