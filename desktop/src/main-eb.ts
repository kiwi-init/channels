import { dlopen, FFIType, ptr, suffix } from "bun:ffi";
import fs from "node:fs";
import path from "node:path";
import Electrobun, { BrowserView, BrowserWindow, PATHS, Utils } from "electrobun/main";

import { internalRpcHandlers } from "../.hutch/devkit/api/sdks/main/proc/native.ts";
import { startAppLife } from "./app-life-eb.ts";
import { handleDeepLink, JOIN_SCHEME } from "./deep-links.ts";
import { lockInternalRpc, onOurPage, preloadSource, toPageScript } from "./eb-bridge.ts";
import { drive } from "./eb-driver.ts";
import { navigation, openedUrl, PAGE_RULES, PAGE_TEMPLATE, PAGE_URL, pageWithCsp, RULES_CANARY } from "./eb-page.ts";
import { testVault } from "./eb-test-store.ts";
import { externalUrl, normalizeRelay } from "./guard.ts";
import { attachKeys, attachWindow, bundle, ebHost } from "./host-eb.ts";
import { useHost } from "./host.ts";
import { handlers } from "./ipc/handlers.ts";
import { bunWorker, keysController, type KeysFrame } from "./keys-eb.ts";
import { answerKeys } from "./keys-host.ts";
import { logMainError } from "./main-log.ts";
import { openInBrowser } from "./open.ts";
import { claimInstance, handoffFor, type Instance } from "./single-instance.ts";
import { bunBridge } from "./rpc-eb.ts";
import { brokenStore, mutate, openStore, snapshot, store, type StoreVault } from "./store.ts";
import { startUpdates, updateState } from "./updater.ts";
import { TRAFFIC_LIGHTS, WINDOW_SIZE, windowBackground } from "./window-look.ts";
import { minWindowWidth } from "./window-size.ts";

declare const KIWI_EB_TEST: boolean;

useHost(ebHost);
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
}).symbols;

const sandboxPages = mac ? null : dlopen(shellPath, { kiwi_sandbox_pages: { args: [], returns: FFIType.bool } }).symbols.kiwi_sandbox_pages;

const windowLook = mac ? dlopen(shellPath, { kiwi_window_look: { args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.u32, FFIType.u32], returns: FFIType.void } }).symbols.kiwi_window_look : null;

const guards = dlopen(shellPath, { kiwi_guard_downloads: { args: [], returns: FFIType.bool }, kiwi_allow_only: { args: [FFIType.ptr], returns: FFIType.bool } }).symbols;

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

const PAGE_ONLY = cString(PAGE_URL);

const detailOf = (e: unknown): unknown => (e as { data?: { detail?: unknown } }).data?.detail;

function openOutside(url: string): void {
  const ext = externalUrl(url);
  if (ext) void openInBrowser(ext, (u) => ebHost.openExternal(u)).catch(() => {});
}

function fail(why: string): void {
  console.error(`Channels: ${why}`);
  Utils.quit(1);
}

function rulesHold(view: BrowserView): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    view.on("will-navigate", (e) => {
      const nav = navigation(detailOf(e));
      if (nav.kind === "refused" && nav.url === RULES_CANARY) {
        clearTimeout(timer);
        resolve(true);
      }
    });
    view.loadURL(RULES_CANARY);
  });
}

let keysToPage: (frame: KeysFrame) => void = () => {};

const keys = keysController({
  spawn: () => bunWorker(path.join(import.meta.dir, "keys.js")),
  init: () => ({ type: "init", relay: store.relayUrl, dir: Utils.paths.userData, seats: store.channels, person: store.person?.pk ?? null }),
  answer: answerKeys,
  toPage: (frame) => keysToPage(frame),
});

const memoryVault: StoreVault = { where: () => `memory, nothing saved (${bundle.identifier})`, load: () => ({ ok: true, file: null, resave: false }), save: () => {} };

async function createWindow(): Promise<BrowserWindow | null> {
  const index = fs.readFileSync(path.join(PATHS.VIEWS_FOLDER, "..", PAGE_TEMPLATE), "utf8");
  const page = (): Uint8Array => cString(pageWithCsp(index, store.relayUrl));
  const first = page();
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
  let closing = false;
  webview.on("will-navigate", (e) => {
    const nav = navigation(detailOf(e));
    if (nav.kind === "refused") openOutside(nav.url);
    if (nav.kind !== "breach") return;
    closing = true;
    win.hide();
    fail(`a navigation the rules should have refused went through (${nav.url ?? "unreadable"}); closing`);
  });
  webview.setNavigationRules(PAGE_RULES);
  if (!(await rulesHold(webview))) {
    closing = true;
    win.hide();
    fail("the window's navigation rules didn't take effect; not opening it");
    return null;
  }
  const load = (html: Uint8Array = page()): void => {
    core.setWebviewHTMLContent(webview.id, ptr(html));
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
  load(first);
  const look = win.ptr;
  if (look && windowLook) windowLook(look, minWindowWidth(process.platform), WINDOW_SIZE.minHeight, rgb(windowBackground(false)), rgb(windowBackground(true)));
  if (mac) win.setWindowButtonPosition(TRAFFIC_LIGHTS.x, TRAFFIC_LIGHTS.y);
  Electrobun.events.on(`new-window-open-${webview.id}`, (e: { data?: { detail?: unknown } }) => {
    const url = openedUrl(e.data?.detail);
    if (url) openOutside(url);
  });
  webview.on("dom-ready", () => {
    if (!closing && !win.isVisible()) win.show();
  });
  return win;
}

async function start(instance: Extract<Instance, { kind: "first" }>): Promise<void> {
  if (KIWI_EB_TEST) {
    openStore(testVault(Utils.paths.userData));
    const relay = normalizeRelay(process.env.KIWI_EB_RELAY ?? "");
    if (relay) mutate((s) => void (s.relayUrl = relay));
  } else openStore(memoryVault);
  attachKeys((m) => keys.tell(m));
  keys.start();
  const win = await createWindow();
  if (!win) {
    instance.release();
    return;
  }
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
  const broken = brokenStore();
  if (broken) void Utils.showMessageBox({ type: "error", message: "Channels can't read its saved keys", detail: broken.message });
}

function refuse(instance: Extract<Instance, { kind: "first" }>, why: string): void {
  instance.release();
  fail(why);
}

BrowserView.on("created", (tag) => tag.remove());

const instance = await claimInstance({
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
} else if (!shell.kiwi_deny_permissions()) refuse(instance, "the web view's permission handler wasn't found; not opening a window that could grant the microphone");
else if (!guards.kiwi_guard_downloads()) refuse(instance, "the web view's download handler wasn't found; not opening a window that could save any file into Downloads");
else if (!guards.kiwi_allow_only(ptr(PAGE_ONLY))) refuse(instance, "the web view's navigation handler wasn't found; not opening a window whose page could navigate away");
else if (!shell.kiwi_watch_commits()) refuse(instance, "the web view's navigation delegate wasn't found; not opening a window that would trust a page it can't see");
else {
  if (sandboxPages && !sandboxPages()) logMainError(new Error("WebKitGTK's sandbox is off: bwrap or xdg-dbus-proxy isn't installed, so the page runs without it"));
  try {
    await start(instance);
  } catch (e) {
    // Nothing on screen can say what went wrong: main.log and the console carry it, and the app quits instead of running windowless.
    logMainError(e);
    console.error("Channels: the window couldn't start", e);
    instance.release();
    Utils.quit(1);
  }
}
