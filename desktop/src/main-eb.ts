import { dlopen, FFIType, ptr, suffix } from "bun:ffi";
import fs from "node:fs";
import path from "node:path";
import Electrobun, { BrowserView, BrowserWindow, PATHS, Utils } from "electrobun/main";

import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts";
import { drive } from "./eb-driver.ts";
import { navigationUrl, openedUrl, PAGE_RULES, PAGE_URL, pageWithCsp } from "./eb-page.ts";
import { externalUrl } from "./guard.ts";
import { openInBrowser } from "./open.ts";
import { TRAFFIC_LIGHTS, WINDOW_SIZE, windowBackground } from "./window-look.ts";
import { minWindowWidth } from "./window-size.ts";

declare const KIWI_EB_TEST: boolean;

const binDir = path.dirname(process.execPath);

const shell = dlopen(path.join(binDir, `libkiwi-shell.${suffix}`), {
  kiwi_deny_permissions: { args: [], returns: FFIType.bool },
  kiwi_window_look: { args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.u32, FFIType.u32], returns: FFIType.void },
}).symbols;

const core = dlopen(path.join(binDir, `libElectrobunCore.${suffix}`), {
  setWebviewHTMLContent: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.void },
}).symbols;

const cString = (s: string): Uint8Array => new TextEncoder().encode(`${s}\0`);

const rgb = (hex: string): number => Number.parseInt(hex.slice(1), 16);

function openOutside(url: string): void {
  const ext = externalUrl(url);
  if (ext) void openInBrowser(ext, async (u) => void Utils.openExternal(u)).catch(() => {});
}

function createWindow(relay: string, pageUrl: string): BrowserView {
  const win = new BrowserWindow({
    title: "Channels",
    url: null,
    frame: { width: WINDOW_SIZE.width, height: WINDOW_SIZE.height },
    titleBarStyle: "hiddenInset",
    hidden: true,
  });
  const view = win.webview;
  view.setNavigationRules(PAGE_RULES);
  const index = fs.readFileSync(path.join(PATHS.VIEWS_FOLDER, "internal", "index.html"), "utf8");
  const page = cString(pageWithCsp(index, relay));
  core.setWebviewHTMLContent(view.id, ptr(page));
  view.loadURL(pageUrl);
  const look = win.ptr;
  if (look) shell.kiwi_window_look(look, minWindowWidth(process.platform), WINDOW_SIZE.minHeight, rgb(windowBackground(false)), rgb(windowBackground(true)));
  win.setWindowButtonPosition(TRAFFIC_LIGHTS.x, TRAFFIC_LIGHTS.y);
  view.on("will-navigate", (e) => {
    const nav = navigationUrl((e as { data?: { detail?: unknown } }).data?.detail);
    if (nav && !nav.allowed) openOutside(nav.url);
  });
  Electrobun.events.on(`new-window-open-${view.id}`, (e: { data?: { detail?: unknown } }) => {
    const url = openedUrl(e.data?.detail);
    if (url) openOutside(url);
  });
  view.on("dom-ready", () => {
    if (!win.isVisible()) win.show();
  });
  return view;
}

BrowserView.on("created", (tag) => tag.remove());

if (!shell.kiwi_deny_permissions()) {
  console.error("Channels: the web view's permission handler wasn't found; not opening a window that could grant the microphone");
  Utils.quit(1);
} else if (KIWI_EB_TEST) {
  const relay = process.env.KIWI_EB_RELAY ?? DEFAULT_RELAY;
  const view = createWindow(relay, `${PAGE_URL}?relay=${encodeURIComponent(relay)}`);
  const socket = process.env.KIWI_EB_DRIVER;
  if (socket) drive(view, socket);
} else createWindow(DEFAULT_RELAY, PAGE_URL);
