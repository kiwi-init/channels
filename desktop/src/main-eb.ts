import { dlopen, FFIType, ptr, suffix } from "bun:ffi";
import fs from "node:fs";
import path from "node:path";
import Electrobun, { BrowserView, BrowserWindow, PATHS, Utils } from "electrobun/main";

import { internalRpcHandlers } from "../.hutch/devkit/api/sdks/main/proc/native.ts";
import { committedUrl, lockInternalRpc, preloadSource, stillOurs, toPageScript } from "./eb-bridge.ts";
import { navigation, openedUrl, PAGE_RULES, PAGE_TEMPLATE, PAGE_URL, pageWithCsp, RULES_CANARY } from "./eb-page.ts";
import { externalUrl } from "./guard.ts";
import { attachKeys, attachWindow, bundle, ebHost } from "./host-eb.ts";
import { useHost } from "./host.ts";
import { handlers } from "./ipc/handlers.ts";
import { bunWorker, keysController, type KeysFrame } from "./keys-eb.ts";
import { answerKeys } from "./keys-host.ts";
import { logMainError } from "./main-log.ts";
import { openInBrowser } from "./open.ts";
import { bunBridge } from "./rpc-eb.ts";
import { brokenStore, openStore, snapshot, store, type StoreVault } from "./store.ts";
import { TRAFFIC_LIGHTS, WINDOW_SIZE, windowBackground } from "./window-look.ts";
import { minWindowWidth } from "./window-size.ts";

useHost(ebHost);
lockInternalRpc(internalRpcHandlers);

const binDir = path.dirname(process.execPath);

const shell = dlopen(path.join(binDir, `libkiwi-shell.${suffix}`), {
  kiwi_deny_permissions: { args: [], returns: FFIType.bool },
  kiwi_guard_downloads: { args: [], returns: FFIType.bool },
  kiwi_window_look: { args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.u32, FFIType.u32], returns: FFIType.void },
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

async function createWindow(): Promise<void> {
  const index = fs.readFileSync(path.join(PATHS.VIEWS_FOLDER, "..", PAGE_TEMPLATE), "utf8");
  const page = (): Uint8Array => cString(pageWithCsp(index, store.relayUrl));
  const first = page();
  const bundled = fs.readFileSync(path.join(PATHS.VIEWS_FOLDER, "preload", "index.js"), "utf8");
  const table = handlers(ebHost);
  let ours = true;
  let view: BrowserView | null = null;
  const bridge = bunBridge(
    table,
    () => ours,
    (frame) => view?.executeJavascript(toPageScript(frame)),
    () => {
      keys.pageGone();
      bridge.push("store", snapshot());
    },
    (session, req) => keys.request(session, req),
  );
  keysToPage = (frame) => bridge.pushKeys(frame);
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
  webview.on("will-navigate", (e) => {
    const nav = navigation(detailOf(e));
    if (nav.kind === "refused") openOutside(nav.url);
    if (nav.kind !== "breach") return;
    win.hide();
    fail(`a navigation the rules should have refused went through (${nav.url ?? "unreadable"}); closing`);
  });
  webview.setNavigationRules(PAGE_RULES);
  if (!(await rulesHold(webview))) {
    win.hide();
    fail("the window's navigation rules didn't take effect; not opening it");
    return;
  }
  const load = (html: Uint8Array = page()): void => {
    core.setWebviewHTMLContent(webview.id, ptr(html));
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
  load(first);
  const look = win.ptr;
  if (look) shell.kiwi_window_look(look, minWindowWidth(process.platform), WINDOW_SIZE.minHeight, rgb(windowBackground(false)), rgb(windowBackground(true)));
  win.setWindowButtonPosition(TRAFFIC_LIGHTS.x, TRAFFIC_LIGHTS.y);
  Electrobun.events.on(`new-window-open-${webview.id}`, (e: { data?: { detail?: unknown } }) => {
    const url = openedUrl(e.data?.detail);
    if (url) openOutside(url);
  });
  webview.on("dom-ready", () => {
    if (!win.isVisible()) win.show();
  });
}

async function start(): Promise<void> {
  openStore(memoryVault);
  attachKeys((m) => keys.tell(m));
  keys.start();
  await createWindow();
  const broken = brokenStore();
  if (broken) void Utils.showMessageBox({ type: "error", message: "Channels can't read its saved keys", detail: broken.message });
}

BrowserView.on("created", (tag) => tag.remove());

if (!shell.kiwi_deny_permissions()) fail("the web view's permission handler wasn't found; not opening a window that could grant the microphone");
else if (!shell.kiwi_guard_downloads()) fail("the web view's download handler wasn't found; not opening a window that could save any file into Downloads");
else
  try {
    await start();
  } catch (e) {
    // Nothing on screen can say what went wrong: main.log and the console carry it, and the app quits instead of running windowless.
    logMainError(e);
    console.error("Channels: the window couldn't start", e);
    Utils.quit(1);
  }
