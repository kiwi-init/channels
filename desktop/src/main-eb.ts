import { dlopen, FFIType, ptr, suffix } from "bun:ffi";
import fs from "node:fs";
import path from "node:path";
import Electrobun, { BrowserView, BrowserWindow, PATHS, Utils } from "electrobun/main";

import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts";
import { startAppLife } from "./app-life-eb.ts";
import { handleDeepLink, JOIN_SCHEME } from "./deep-links.ts";
import { navigationUrl, openedUrl, PAGE_RULES, PAGE_URL, pageWithCsp } from "./eb-page.ts";
import { externalUrl } from "./guard.ts";
import { openInBrowser } from "./open.ts";
import { claimInstance, handoffFor } from "./single-instance.ts";
import { updateState } from "./updater.ts";
import { TRAFFIC_LIGHTS, WINDOW_SIZE, windowBackground } from "./window-look.ts";
import { minWindowWidth } from "./window-size.ts";

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

function createWindow(): BrowserWindow {
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
  const page = cString(pageWithCsp(index, DEFAULT_RELAY));
  core.setWebviewHTMLContent(view.id, ptr(page));
  view.loadURL(PAGE_URL);
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
  return win;
}

function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.unminimize();
  win.show();
  win.activate();
}

BrowserView.on("created", (tag) => tag.remove());

let show: (() => void) | null = null;
const instance = await claimInstance({
  dir: Utils.paths.userData,
  handoff: handoffFor(process.argv, JOIN_SCHEME),
  onHandoff: (h) => (h.kind === "link" ? handleDeepLink(h.url) : show?.()),
});
if (instance.kind === "second") Utils.quit(0);
else if (!shell.kiwi_deny_permissions()) {
  console.error("Channels: the web view's permission handler wasn't found; not opening a window that could grant the microphone");
  instance.release();
  Utils.quit(1);
} else {
  const win = createWindow();
  show = () => showWindow(win);
  startAppLife({
    win,
    view: win.webview,
    pageUrl: PAGE_URL,
    showWindow: show,
    textStep: () => {},
    restartToUpdate: () => {},
    update: updateState,
    nudgeKeys: () => {},
    flushKeys: async () => {},
    release: instance.release,
  });
}
