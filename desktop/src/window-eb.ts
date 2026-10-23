import fs from "node:fs";
import path from "node:path";
import Electrobun, { BrowserWindow, PATHS, Utils, type BrowserView } from "electrobun/main";

import { onOurPage, preloadSource, toPageScript } from "./eb-bridge.ts";
import { keys, keysToPage } from "./keys-start-eb.ts";
import { cString, committedPage, mac, setPageHtml, setPreload, windowLook } from "./native-eb.ts";
import { navigation, openedUrl, PAGE_RULES, PAGE_TEMPLATE, PAGE_URL, pageWithCsp, RULES_CANARY } from "./eb-page.ts";
import { externalUrl } from "./guard.ts";
import { attachWindow, ebHost } from "./host-eb.ts";
import { handlers } from "./ipc/handlers.ts";
import { openInBrowser } from "./open.ts";
import { bunBridge } from "./rpc-eb.ts";
import { snapshot, store } from "./store.ts";
import { TRAFFIC_LIGHTS, WINDOW_SIZE, windowBackground } from "./window-look.ts";
import { minWindowWidth } from "./window-size.ts";

const rgb = (hex: string): number => Number.parseInt(hex.slice(1), 16);

const detailOf = (e: unknown): unknown => (e as { data?: { detail?: unknown } }).data?.detail;

function openOutside(url: string): void {
  const ext = externalUrl(url);
  if (ext) void openInBrowser(ext, (u) => ebHost.openExternal(u)).catch(() => {});
}

export function fail(why: string): void {
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

export async function createWindow(): Promise<BrowserWindow | null> {
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
  keysToPage((frame) => bridge.pushKeys(frame));
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
    setPageHtml(webview.id, html);
    bridge.retire();
    webview.loadURL(PAGE_URL);
  };
  const refreshPreload = (): void => setPreload(webview.id, preloadSource({ snapshot: snapshot(), session: bridge.nextSession() }, bundled));
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
