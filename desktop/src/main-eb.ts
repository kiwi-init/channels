import { dlopen, FFIType, JSCallback, ptr, suffix } from "bun:ffi";
import fs from "node:fs";
import path from "node:path";
import Electrobun, { BrowserView, BrowserWindow, PATHS, Utils } from "electrobun/main";

import { internalRpcHandlers } from "../.hutch/devkit/api/sdks/main/proc/native.ts";
import { startAppLife } from "./app-life-eb.ts";
import { handleDeepLink, JOIN_SCHEME } from "./deep-links.ts";
import { keepDaemon } from "./bundled-daemon.ts";
import { lockInternalRpc, onOurPage, preloadSource, toPageScript } from "./eb-bridge.ts";
import { drive } from "./eb-driver.ts";
import { navigationUrl, openedUrl, PAGE_RULES, PAGE_URL, pageWithCsp } from "./eb-page.ts";
import { testVault } from "./eb-test-store.ts";
import { externalUrl, normalizeRelay } from "./guard.ts";
import { attachKeys, attachWindow, bundle, ebHost } from "./host-eb.ts";
import { useHost } from "./host.ts";
import { handlers } from "./ipc/handlers.ts";
import { bunWorker, keysController, type KeysFrame } from "./keys-eb.ts";
import { answerKeys } from "./keys-host.ts";
import { catchMainErrors, logMainError } from "./main-log.ts";
import { openInBrowser } from "./open.ts";
import { keepPageAlive } from "./page-crash.ts";
import { claimInstance, handoffFor, type Instance } from "./single-instance.ts";
import { testHomeProblem } from "./eb-test-home.ts";
import { bunBridge } from "./rpc-eb.ts";
import { brokenStore, mutate, openStore, snapshot, store, type StoreVault } from "./store.ts";
import { startUpdates, updateState } from "./updater.ts";
import { TRAFFIC_LIGHTS, WINDOW_SIZE, windowBackground } from "./window-look.ts";
import { minWindowWidth } from "./window-size.ts";

declare const KIWI_EB_TEST: boolean;

useHost(KIWI_EB_TEST ? { ...ebHost, app: { ...ebHost.app, packaged: () => true } } : ebHost);
catchMainErrors();
Electrobun.events.on("open-url", (e: { data?: { url?: unknown } }) => {
  if (typeof e.data?.url === "string") handleDeepLink(e.data.url);
});
lockInternalRpc(internalRpcHandlers);

const binDir = path.dirname(process.execPath);
const mac = process.platform === "darwin";
const shellPath = path.join(binDir, `libkiwi-shell.${suffix}`);

const shell = dlopen(shellPath, {
  kiwi_deny_permissions: { args: [], returns: FFIType.bool },
  kiwi_watch_commits: { args: [], returns: FFIType.bool },
  kiwi_committed_url: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
  kiwi_watch_page: { args: [FFIType.function], returns: FFIType.bool },
}).symbols;

const sandboxPages = mac ? null : dlopen(shellPath, { kiwi_sandbox_pages: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.bool } }).symbols.kiwi_sandbox_pages;

function sandboxOff(): string | null {
  if (!sandboxPages) return null;
  const why = new Uint8Array(1024);
  return sandboxPages(ptr(why), why.length) ? null : new TextDecoder().decode(why.subarray(0, Math.max(0, why.indexOf(0))));
}

const windowLook = mac ? dlopen(shellPath, { kiwi_window_look: { args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.u32, FFIType.u32], returns: FFIType.void } }).symbols.kiwi_window_look : null;

const core = dlopen(path.join(binDir, `libElectrobunCore.${suffix}`), {
  setWebviewHTMLContent: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.void },
  updatePreloadScriptToWebView: { args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.bool], returns: FFIType.void },
}).symbols;

const committedBuffer = new Uint8Array(4096);

function committedPage(): string | null {
  const n = Number(shell.kiwi_committed_url(ptr(committedBuffer), committedBuffer.length));
  return n > 0 && n < committedBuffer.length ? new TextDecoder().decode(committedBuffer.subarray(0, n)) : null;
}

const cString = (s: string): Uint8Array => new TextEncoder().encode(`${s}\0`);

const rgb = (hex: string): number => Number.parseInt(hex.slice(1), 16);

const PRELOAD_ID = cString("electrobun_custom_preload_script");

const detailOf = (e: unknown): unknown => (e as { data?: { detail?: unknown } }).data?.detail;

function openOutside(url: string): void {
  const ext = externalUrl(url);
  if (ext) void openInBrowser(ext, (u) => ebHost.openExternal(u)).catch(() => {});
}

let keysToPage: (frame: KeysFrame) => void = () => {};

const keys = keysController({
  spawn: () => bunWorker(path.join(import.meta.dir, "keys.js")),
  init: () => ({ type: "init", relay: store.relayUrl, dir: Utils.paths.userData, seats: store.channels, person: store.person?.pk ?? null }),
  answer: answerKeys,
  toPage: (frame) => keysToPage(frame),
});

const memoryVault: StoreVault = { where: () => `memory, nothing saved (${bundle.identifier})`, load: () => ({ ok: true, file: null, resave: false }), save: () => {} };

function createWindow(): BrowserWindow {
  const index = fs.readFileSync(path.join(PATHS.VIEWS_FOLDER, "internal", "index.html"), "utf8");
  const bundled = fs.readFileSync(path.join(PATHS.VIEWS_FOLDER, "preload", "index.js"), "utf8");
  const table = handlers(ebHost);
  let view: BrowserView | null = null;
  const bridge = bunBridge(
    table,
    () => onOurPage(committedPage()),
    (frame) => view?.executeJavascript(toPageScript(frame)),
    () => {
      keys.pageGone();
      refreshPreload();
      bridge.push("store", snapshot());
    },
    (session, req) => keys.request(session, req),
  );
  keysToPage = (frame) => bridge.pushKeys(frame);
  const win = new BrowserWindow({
    title: "Channels",
    url: null,
    frame: { width: WINDOW_SIZE.width, height: WINDOW_SIZE.height },
    titleBarStyle: mac ? "hiddenInset" : "default",
    hidden: true,
    preload: preloadSource({ snapshot: snapshot(), session: bridge.nextSession() }, bundled),
    rpc: bridge,
  });
  const webview = win.webview;
  view = webview;
  webview.setNavigationRules(PAGE_RULES);
  const load = (): void => {
    core.setWebviewHTMLContent(webview.id, ptr(cString(pageWithCsp(index, store.relayUrl))));
    bridge.retire();
    webview.loadURL(PAGE_URL);
  };
  const refreshPreload = (): void =>
    core.updatePreloadScriptToWebView(webview.id, ptr(PRELOAD_ID), ptr(cString(preloadSource({ snapshot: snapshot(), session: bridge.nextSession() }, bundled))), false);
  attachWindow({
    win,
    view: webview,
    push: (name, value) => {
      if (name === "store") refreshPreload();
      bridge.push(name, value);
    },
    reload: () => (refreshPreload(), load()),
  });
  load();
  const look = win.ptr;
  if (look && windowLook) windowLook(look, minWindowWidth(process.platform), WINDOW_SIZE.minHeight, rgb(windowBackground(false)), rgb(windowBackground(true)));
  if (mac) win.setWindowButtonPosition(TRAFFIC_LIGHTS.x, TRAFFIC_LIGHTS.y);
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
  return win;
}

function start(instance: Extract<Instance, { kind: "first" }>): void {
  if (KIWI_EB_TEST) {
    openStore(testVault(Utils.paths.userData));
    const relay = normalizeRelay(process.env.KIWI_EB_RELAY ?? "");
    if (relay) mutate((s) => void (s.relayUrl = relay));
  } else openStore(memoryVault);
  attachKeys((m) => keys.tell(m));
  keys.start();
  const win = createWindow();
  if (KIWI_EB_TEST) {
    const socket = process.env.KIWI_EB_DRIVER;
    if (socket) drive(win.webview, socket);
  }
  const tray = startAppLife({
    win,
    view: win.webview,
    showWindow: () => ebHost.showWindow(),
    reload: () => ebHost.reload(),
    textStep: (step) => ebHost.push("textStep", step),
    restartToUpdate: () => ebHost.restartToUpdate(),
    update: updateState,
    nudgeKeys: () => ebHost.tellKeys({ type: "nudge" }),
    flushKeys: () => keys.flush(),
    release: instance.release,
  });
  startUpdates((u) => {
    ebHost.push("update", u);
    tray.refresh(u);
  });
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

const wrongHome = KIWI_EB_TEST ? testHomeProblem(Utils.paths.userData, process.env.CFFIXED_USER_HOME) : null;
if (wrongHome) console.error(`Channels test build: ${wrongHome}; not starting, so nothing lands under the person's home`);
const instance = wrongHome
  ? null
  : await claimInstance({
      dir: Utils.paths.userData,
      handoff: handoffFor(process.argv, JOIN_SCHEME),
      scheme: JOIN_SCHEME,
      onHandoff: (h) => (h.kind === "link" ? handleDeepLink(h.url) : ebHost.showWindow()),
    }).catch((e: unknown) => {
      logMainError(e);
      console.error("Channels: couldn't take the single-instance lock in its data folder", e);
      return null;
    });
if (!instance) Utils.quit(1);
else if (instance.kind === "second") {
  if (!instance.delivered) console.error("Channels: another Channels holds this data folder and didn't answer; quitting");
  Utils.quit(0);
} else if (!shell.kiwi_deny_permissions() || !shell.kiwi_watch_commits()) {
  console.error("Channels: the web view's permission handler or navigation delegate wasn't found; not opening a window that could grant the microphone or trust a page it can't see");
  instance.release();
  Utils.quit(1);
} else {
  const off = sandboxOff();
  if (off !== null) {
    const why = `WebKitGTK's sandbox is off: ${off}, so the page runs without it`;
    console.error(`Channels: ${why}`);
    logMainError(new Error(why));
  }
  try {
    start(instance);
  } catch (e) {
    // Nothing on screen can say what went wrong: main.log and the console carry it, and the app quits instead of running windowless.
    logMainError(e);
    console.error("Channels: the window couldn't start", e);
    instance.release();
    Utils.quit(1);
  }
}
