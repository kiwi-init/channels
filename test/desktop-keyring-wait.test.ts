import { describe, expect, test } from "bun:test";

import { pageWithCsp } from "../desktop/src/eb-page.ts";
import { openedWithin, waitingNote, waitingPage } from "../desktop/src/keyring-wait.ts";

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
    const page = waitingPage(INDEX, "linux");
    expect(page).toContain(`<link rel="stylesheet" crossorigin href="./assets/index-ghi.css">`);
    expect(page).not.toContain("<script");
    expect(page).not.toContain("modulepreload");
    expect(page).not.toContain(`id="root"`);
  });

  test("the waiting page takes the CSP first in <head>, as the app's page does", () => {
    const page = pageWithCsp(waitingPage(INDEX, "linux"), "https://channels.kiwiinit.com");
    expect(page).toMatch(/^<!doctype html>\n<html lang="en">\n<head><meta http-equiv="Content-Security-Policy"/);
  });

  test("it says what it waits for in each platform's words", () => {
    expect(waitingPage(INDEX, "linux")).toContain("Waiting for your keyring");
    expect(waitingPage(INDEX, "linux")).toContain("GNOME Keyring or KDE Wallet");
    expect(waitingPage(INDEX, "darwin")).toContain("Waiting for your keychain");
    expect(waitingNote("darwin").detail).not.toContain("GNOME");
  });
});
