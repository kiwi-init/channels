import { dlopen, FFIType, ptr, suffix } from "bun:ffi";
import fs from "node:fs";
import path from "node:path";
import Electrobun, { BrowserView, BrowserWindow, PATHS, Utils } from "electrobun/main";

import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts";
import { navigation, openedUrl, PAGE_RULES, PAGE_TEMPLATE, PAGE_URL, pageWithCsp, RULES_CANARY } from "./eb-page.ts";
import { externalUrl } from "./guard.ts";
import { openInBrowser } from "./open.ts";
import { TRAFFIC_LIGHTS, WINDOW_SIZE, windowBackground } from "./window-look.ts";
import { minWindowWidth } from "./window-size.ts";

const binDir = path.dirname(process.execPath);

const shell = dlopen(path.join(binDir, `libkiwi-shell.${suffix}`), {
  kiwi_deny_permissions: { args: [], returns: FFIType.bool },
  kiwi_guard_downloads: { args: [], returns: FFIType.bool },
  kiwi_allow_only: { args: [FFIType.ptr], returns: FFIType.bool },
  kiwi_window_look: { args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.u32, FFIType.u32], returns: FFIType.void },
}).symbols;

const core = dlopen(path.join(binDir, `libElectrobunCore.${suffix}`), {
  setWebviewHTMLContent: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.void },
}).symbols;

const cString = (s: string): Uint8Array => new TextEncoder().encode(`${s}\0`);

const rgb = (hex: string): number => Number.parseInt(hex.slice(1), 16);

const PAGE_ONLY = cString(PAGE_URL);

function openOutside(url: string): void {
  const ext = externalUrl(url);
  if (ext) void openInBrowser(ext, async (u) => void Utils.openExternal(u)).catch(() => {});
}

function fail(why: string): void {
  console.error(`Channels: ${why}`);
  Utils.quit(1);
}

function buildPage(): Uint8Array | null {
  try {
    return cString(pageWithCsp(fs.readFileSync(path.join(PATHS.VIEWS_FOLDER, "..", PAGE_TEMPLATE), "utf8"), DEFAULT_RELAY));
  } catch (e) {
    fail(`the page can't be built: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function rulesHold(view: BrowserWindow["webview"]): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    view.on("will-navigate", (e) => {
      const nav = navigation((e as { data?: { detail?: unknown } }).data?.detail);
      if (nav.kind === "refused" && nav.url === RULES_CANARY) {
        clearTimeout(timer);
        resolve(true);
      }
    });
    view.loadURL(RULES_CANARY);
  });
}

async function createWindow(page: Uint8Array): Promise<void> {
  const win = new BrowserWindow({
    title: "Channels",
    url: null,
    frame: { width: WINDOW_SIZE.width, height: WINDOW_SIZE.height },
    titleBarStyle: "hiddenInset",
    hidden: true,
  });
  const view = win.webview;
  let closing = false;
  view.on("will-navigate", (e) => {
    const nav = navigation((e as { data?: { detail?: unknown } }).data?.detail);
    if (nav.kind === "refused") openOutside(nav.url);
    if (nav.kind !== "breach") return;
    closing = true;
    win.hide();
    fail(`a navigation the rules should have refused went through (${nav.url ?? "unreadable"}); closing`);
  });
  view.setNavigationRules(PAGE_RULES);
  if (!(await rulesHold(view))) {
    closing = true;
    win.hide();
    fail("the window's navigation rules didn't take effect; not opening it");
    return;
  }
  core.setWebviewHTMLContent(view.id, ptr(page));
  view.loadURL(PAGE_URL);
  const look = win.ptr;
  if (look) shell.kiwi_window_look(look, minWindowWidth(process.platform), WINDOW_SIZE.minHeight, rgb(windowBackground(false)), rgb(windowBackground(true)));
  win.setWindowButtonPosition(TRAFFIC_LIGHTS.x, TRAFFIC_LIGHTS.y);
  Electrobun.events.on(`new-window-open-${view.id}`, (e: { data?: { detail?: unknown } }) => {
    const url = openedUrl(e.data?.detail);
    if (url) openOutside(url);
  });
  view.on("dom-ready", () => {
    if (!closing && !win.isVisible()) win.show();
  });
}

BrowserView.on("created", (tag) => tag.remove());

if (!shell.kiwi_deny_permissions()) fail("the web view's permission handler wasn't found; not opening a window that could grant the microphone");
else if (!shell.kiwi_guard_downloads()) fail("the web view's download handler wasn't found; not opening a window that could save any file into Downloads");
else if (!shell.kiwi_allow_only(ptr(PAGE_ONLY))) fail("the web view's navigation handler wasn't found; not opening a window whose page could navigate away");
else {
  const page = buildPage();
  if (page) await createWindow(page);
}
