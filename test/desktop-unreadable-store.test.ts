import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageWithCsp } from "../desktop/src/eb-page.ts";
import { useHost } from "../desktop/src/host.ts";
import { ASK_AGAIN_URL } from "../desktop/src/keyring-wait.ts";
import { openStore, unreadableStore } from "../desktop/src/store.ts";
import { unreadablePage, type Unreadable } from "../desktop/src/unreadable-store.ts";
import { fakeHost } from "./fake-host.ts";

useHost(fakeHost({ paths: { logs: mkdtempSync(join(tmpdir(), "kiwi-unreadable-")) } }).host);

const INDEX = `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><script type="module" crossorigin src="./assets/index-abc.js"></script><link rel="modulepreload" crossorigin href="./assets/vendor-def.js"><link rel="stylesheet" crossorigin href="./assets/index-ghi.css"></head><body><div id="root"></div></body></html>`;

const CANT: Unreadable = {
  why: "the keychain item <kiwi-store-key> can't be read & nothing was changed",
  advice: "Unlock your keychain, then quit and reopen Channels.",
  file: "/Users/someone/Library/Application Support/Channels/kiwi-store.bin",
  log: "/Users/someone/Library/Logs/Channels/main.log",
};

test("a store that can't be read gets its own page: what happened, what to do, why, where the keys are, and Try again (T1772)", () => {
  const page = unreadablePage(INDEX, CANT);
  expect(page).toContain("<h1>Channels can't read your keys</h1>");
  expect(page).toContain("Your channels and keys are still on this computer.");
  expect(page).toContain("Unlock your keychain, then quit and reopen Channels.");
  expect(page).toContain(CANT.file);
  expect(page).toContain(CANT.log);
  expect(page).toContain(`<a class="again" href="${ASK_AGAIN_URL}">Try again</a>`);
});

test("the reason is shown as text, never as markup", () => {
  const page = unreadablePage(INDEX, CANT);
  expect(page).toContain("the keychain item &lt;kiwi-store-key&gt; can't be read &amp; nothing was changed");
  expect(page).not.toContain("<kiwi-store-key>");
});

test("the page takes the app's stylesheet and none of its scripts, so first-run can't start over the keys", () => {
  const page = unreadablePage(INDEX, CANT);
  expect(page).toContain(`<link rel="stylesheet" crossorigin href="./assets/index-ghi.css">`);
  expect(page).not.toContain("<script");
  expect(page).not.toContain("modulepreload");
  expect(page).not.toContain(`id="root"`);
});

test("the page takes the CSP first in <head>, as the app's page does", () => {
  expect(pageWithCsp(unreadablePage(INDEX, CANT), "https://channels.kiwiinit.com")).toMatch(/^<!doctype html>\n<html lang="en">\n<head><meta http-equiv="Content-Security-Policy"/);
});

test("an unreadable store names its reason, its own advice and its file; a readable one names nothing", () => {
  const vault = (read: () => ReturnType<Parameters<typeof openStore>[0]["load"]>) => ({ where: () => "/data/kiwi-store.bin", load: read, save: () => {} });
  openStore(vault(() => ({ ok: false, why: "its key is no longer in your keychain", advice: "Restore your keychain from a backup, then reopen Channels." })));
  expect(unreadableStore()).toEqual({ why: "its key is no longer in your keychain", advice: "Restore your keychain from a backup, then reopen Channels.", file: "/data/kiwi-store.bin" });
  openStore(vault(() => ({ ok: false, why: "" })));
  expect(unreadableStore()).toEqual({ why: "an error with no message", advice: "Unlock your keychain, then quit and reopen Channels.", file: "/data/kiwi-store.bin" });
  openStore(vault(() => ({ ok: true, file: null, resave: false })));
  expect(unreadableStore()).toBeNull();
});
