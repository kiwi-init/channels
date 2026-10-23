import { dlopen, FFIType, JSCallback, ptr, suffix } from "bun:ffi";
import fs from "node:fs";
import path from "node:path";
import Electrobun, { BrowserView, BrowserWindow, PATHS, Utils } from "electrobun/main";

import { internalRpcHandlers } from "../.hutch/devkit/api/sdks/main/proc/native.ts";
import { keepDaemon } from "./bundled-daemon.ts";
import { committedUrl, lockInternalRpc, preloadSource, stillOurs, toPageScript } from "./eb-bridge.ts";
import { drive } from "./eb-driver.ts";
import { navigationUrl, openedUrl, PAGE_RULES, PAGE_URL, pageWithCsp } from "./eb-page.ts";
import { testVault } from "./eb-test-store.ts";
import { externalUrl, normalizeRelay } from "./guard.ts";
import { attachWindow, bundle, ebHost } from "./host-eb.ts";
import { useHost } from "./host.ts";
import { handlers } from "./ipc/handlers.ts";
import { catchMainErrors, logMainError } from "./main-log.ts";
import { openInBrowser } from "./open.ts";
import { keepPageAlive } from "./page-crash.ts";
import { bunBridge } from "./rpc-eb.ts";
import { brokenStore, mutate, openStore, snapshot, store, type StoreVault } from "./store.ts";
import { TRAFFIC_LIGHTS, WINDOW_SIZE, windowBackground } from "./window-look.ts";
import { minWindowWidth } from "./window-size.ts";

declare const KIWI_EB_TEST: boolean;

useHost(KIWI_EB_TEST ? { ...ebHost, app: { ...ebHost.app, packaged: () => true } } : ebHost);
catchMainErrors();
lockInternalRpc(internalRpcHandlers);

const binDir = path.dirname(process.execPath);

const shell = dlopen(path.join(binDir, `libkiwi-shell.${suffix}`), {
  kiwi_deny_permissions: { args: [], returns: FFIType.bool },
  kiwi_window_look: { args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.u32, FFIType.u32], returns: FFIType.void },
  kiwi_watch_page: { args: [FFIType.function], returns: FFIType.bool },
}).symbols;

const core = dlopen(path.join(binDir, `libElectrobunCore.${suffix}`), {
  setWebviewHTMLContent: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.void },
  updatePreloadScriptToWebView: { args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.bool], returns: FFIType.void },
}).symbols;

const cString = (s: string): Uint8Array => new TextEncoder().encode(`${s}\0`);

const rgb = (hex: string): number => Number.parseInt(hex.slice(1), 16);

const PRELOAD_ID = cString("electrobun_custom_preload_script");

const detailOf = (e: unknown): unknown => (e as { data?: { detail?: unknown } }).data?.detail;

function openOutside(url: string): void {
  const ext = externalUrl(url);
  if (ext) void openInBrowser(ext, (u) => ebHost.openExternal(u)).catch(() => {});
}

const memoryVault: StoreVault = { where: () => `memory, nothing saved (${bundle.identifier})`, load: () => ({ ok: true, file: null, resave: false }), save: () => {} };

function createWindow(): BrowserView {
  const index = fs.readFileSync(path.join(PATHS.VIEWS_FOLDER, "internal", "index.html"), "utf8");
  const bundled = fs.readFileSync(path.join(PATHS.VIEWS_FOLDER, "preload", "index.js"), "utf8");
  const table = handlers(ebHost);
  let ours = true;
  let view: BrowserView | null = null;
  const bridge = bunBridge(
    table,
    () => ours,
    (frame) => view?.executeJavascript(toPageScript(frame)),
    () => bridge.push("store", snapshot()),
  );
  const win = new BrowserWindow({
    title: "Channels",
    url: null,
    frame: { width: WINDOW_SIZE.width, height: WINDOW_SIZE.height },
    titleBarStyle: "hiddenInset",
    hidden: true,
    preload: preloadSource(snapshot(), bundled),
    rpc: bridge,
  });
  const webview = win.webview;
  view = webview;
  webview.setNavigationRules(PAGE_RULES);
  const load = (): void => {
    core.setWebviewHTMLContent(webview.id, ptr(cString(pageWithCsp(index, store.relayUrl))));
    ours = true;
    webview.loadURL(PAGE_URL);
  };
  const refreshPreload = (): void => core.updatePreloadScriptToWebView(webview.id, ptr(PRELOAD_ID), ptr(cString(preloadSource(snapshot(), bundled))), true);
  attachWindow({
    win,
    view: webview,
    push: (name, value) => {
      if (name === "store") refreshPreload();
      bridge.push(name, value);
    },
    reload: () => (refreshPreload(), load()),
  });
  for (const moved of ["did-commit-navigation", "did-navigate", "did-navigate-in-page"] as const) webview.on(moved, (e) => (ours = stillOurs(ours, committedUrl(detailOf(e)))));
  load();
  const look = win.ptr;
  if (look) shell.kiwi_window_look(look, minWindowWidth(process.platform), WINDOW_SIZE.minHeight, rgb(windowBackground(false)), rgb(windowBackground(true)));
  win.setWindowButtonPosition(TRAFFIC_LIGHTS.x, TRAFFIC_LIGHTS.y);
  webview.on("will-navigate", (e) => {
    const nav = navigationUrl(detailOf(e));
    if (nav && !nav.allowed) openOutside(nav.url);
  });
  Electrobun.events.on(`new-window-open-${webview.id}`, (e: { data?: { detail?: unknown } }) => {
    const url = openedUrl(e.data?.detail);
    if (url) openOutside(url);
  });
  webview.on("dom-ready", () => {
    if (!win.isVisible()) win.show();
  });
  return webview;
}

function start(): void {
  if (KIWI_EB_TEST) {
    openStore(testVault(Utils.paths.userData));
    const relay = normalizeRelay(process.env.KIWI_EB_RELAY ?? "");
    if (relay) mutate((s) => void (s.relayUrl = relay));
    const view = createWindow();
    const socket = process.env.KIWI_EB_DRIVER;
    if (socket) drive(view, socket);
  } else {
    openStore(memoryVault);
    createWindow();
  }
  watchPage();
  void keepDaemon(() => quitting).catch(logMainError);
  const broken = brokenStore();
  if (broken) void Utils.showMessageBox({ type: "error", message: "Channels can't read its saved keys", detail: broken.message });
}

let quitting = false;
Electrobun.events.on("before-quit", () => void (quitting = true));
let pageWatch: JSCallback | null = null;

function watchPage(): void {
  const gone = keepPageAlive({
    reload: () => ebHost.reload(),
    ask: async (message, buttons) => (await Utils.showMessageBox({ type: "warning", message, buttons, defaultId: 1, cancelId: 0 })).response === 1,
    quit: () => void Utils.quit(),
    log: logMainError,
    quitting: () => quitting,
    now: Date.now,
  });
  pageWatch = new JSCallback(() => gone("its web content process ended"), { args: [], returns: "void", threadsafe: true });
  if (!shell.kiwi_watch_page(pageWatch)) logMainError(new Error("Electrobun's navigation delegate wasn't found: a stopped page isn't reloaded or counted"));
}

BrowserView.on("created", (tag) => tag.remove());

if (!shell.kiwi_deny_permissions()) {
  console.error("Channels: the web view's permission handler wasn't found; not opening a window that could grant the microphone");
  Utils.quit(1);
} else
  try {
    start();
  } catch (e) {
    // Nothing on screen can say what went wrong: main.log and the console carry it, and the app quits instead of running windowless.
    logMainError(e);
    console.error("Channels: the window couldn't start", e);
    Utils.quit(1);
  }
