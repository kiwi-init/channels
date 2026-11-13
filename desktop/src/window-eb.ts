import fs from "node:fs";
import path from "node:path";
import Electrobun, { BrowserWindow, PATHS, Utils, type BrowserView } from "electrobun/main";

import { onOurPage, preloadSource, toPageScript } from "./eb-bridge.ts";
import { glassWindow, lookMarks } from "./frost-eb.ts";
import { keys, keysToPage } from "./keys-start-eb.ts";
import { cString, committedPage, mac, setPageHtml, setPreload, windowLook } from "./native-eb.ts";
import { navigation, openedUrl, PAGE_RULES, PAGE_TEMPLATE, PAGE_URL, pageWithCsp, RULES_CANARY } from "./eb-page.ts";
import { mark } from "./eb-startup.ts";
import { logMainError } from "./main-log.ts";
import { fail } from "./start-fail-eb.ts";
import { heldWithin } from "./start-failure.ts";
import { externalUrl } from "./guard.ts";
import { attachWindow, ebHost } from "./host-eb.ts";
import { handlers } from "./ipc/handlers.ts";
import { ASK_AGAIN_URL, keyringPage, type KeyringState } from "./keyring-wait.ts";
import { openInBrowser } from "./open.ts";
import { bunBridge } from "./rpc-eb.ts";
import { snapshot, store } from "./store.ts";
import { TRAFFIC_LIGHTS, WINDOW_SIZE, windowBackground } from "./window-look.ts";
import { ownAppImage } from "./update-asset.ts";
import { channelUi, uiFromChannel, uiViewsRoot } from "./ui-engine-eb.ts";
import { showWithin } from "./show-guard.ts";
import { unreadablePage, type Unreadable } from "./unreadable-store.ts";
import { minWindowWidth } from "./window-size.ts";

const SHOW_WITHIN_MS = 8_000;

const rgb = (hex: string): number => Number.parseInt(hex.slice(1), 16);

const detailOf = (e: unknown): unknown => (e as { data?: { detail?: unknown } }).data?.detail;

function openOutside(url: string): void {
  const ext = externalUrl(url);
  if (!ext) {
    logMainError(new Error(`refused to open a non-http(s) message link: ${url}`));
    return;
  }
  void openInBrowser(ext, (u) => ebHost.openExternal(u)).catch((err: unknown) => logMainError(new Error(`could not open ${ext} in the system browser`, { cause: err })));
}

let showNote: (state: KeyringState) => void = () => {};

export const showKeyringNote = (state: KeyringState): void => showNote(state);

let showCantRead: (u: Unreadable) => void = () => {};

export const showUnreadable = (u: Unreadable): void => showCantRead(u);

function askAgain(): void {
  ebHost.app.relaunch(ownAppImage(process.env["APPIMAGE"], process.env["APPDIR"], process.execPath) ?? path.join(path.dirname(process.execPath), "launcher"));
  Utils.quit();
}

const CANARY_WAITS_MS = [5_000, 15_000];

function rulesHold(view: BrowserView): Promise<boolean> {
  return heldWithin(
    CANARY_WAITS_MS,
    () => view.loadURL(RULES_CANARY),
    (seen) =>
      view.on("will-navigate", (e) => {
        const nav = navigation(detailOf(e));
        if (nav.kind === "refused" && nav.url === RULES_CANARY) seen();
      }),
    (waited) => logMainError(new Error(`the navigation rules canary wasn't refused within ${waited / 1000} s`)),
  );
}

export async function createWindow(keyring: KeyringState | null = null, unreadable: Unreadable | null = null): Promise<BrowserWindow | null> {
  const index = fs.readFileSync(path.join(PATHS.VIEWS_FOLDER, "..", PAGE_TEMPLATE), "utf8");
  let current = index;
  const page = (): Uint8Array<ArrayBuffer> => cString(pageWithCsp(current, store.relayUrl));
  const note = (state: KeyringState): Uint8Array<ArrayBuffer> => cString(pageWithCsp(keyringPage(index, process.platform, state), store.relayUrl));
  const cantRead = (u: Unreadable): Uint8Array<ArrayBuffer> => cString(pageWithCsp(unreadablePage(index, u), store.relayUrl));
  const first = keyring ? note(keyring) : unreadable ? cantRead(unreadable) : page();
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
    (session, req) => {
      mark("keysAsk");
      return keys.request(session, req).then((reply) => (mark("keysReply"), reply));
    },
  );
  keysToPage((frame) => bridge.pushKeys(frame));
  mark("window");
  const preload = preloadSource({ snapshot: snapshot(), session: bridge.nextSession() }, lookMarks() + bundled);
  Bun.gc(true);
  const win = new BrowserWindow({
    title: "Channels",
    url: null,
    frame: { width: WINDOW_SIZE.width, height: WINDOW_SIZE.height },
    windowState: "main",
    titleBarStyle: mac ? "hiddenInset" : "hidden",
    hidden: true,
    spellCheck: true,
    preload,
    rpc: bridge,
    ...(uiFromChannel ? { viewsRoot: uiViewsRoot() } : {}),
  });
  mark("webview");
  const webview = win.webview;
  view = webview;
  let closing = false;
  webview.on("will-navigate", (e) => {
    const nav = navigation(detailOf(e));
    if (nav.kind === "refused" && nav.url === ASK_AGAIN_URL) return askAgain();
    if (nav.kind === "refused") openOutside(nav.url);
    if (nav.kind !== "breach") return;
    closing = true;
    win.hide();
    void fail(`a navigation the rules should have refused went through (${nav.url ?? "unreadable"}); closing`, { closing: true });
  });
  webview.setNavigationRules(PAGE_RULES);
  mark("rules");
  const held = await rulesHold(webview);
  mark("canary");
  if (!held) {
    closing = true;
    win.hide();
    await fail("the window's navigation rules didn't take effect; not opening it");
    return null;
  }
  let loaded = false;
  const load = (html: Uint8Array<ArrayBuffer> = page()): void => {
    loaded = true;
    setPageHtml(webview.id, html);
    bridge.retire();
    webview.loadURL(PAGE_URL);
  };
  const refreshPreload = (): void => setPreload(webview.id, preloadSource({ snapshot: snapshot(), session: bridge.nextSession() }, lookMarks() + bundled));
  let shown = false;
  let quiet = false;
  const ui = uiFromChannel
    ? channelUi({
        win,
        show: (html) => {
          current = html;
          quiet = shown && !win.isVisible();
          refreshPreload();
          load();
        },
        nothingToShow: (why) => builtIn(new Error(why)),
      })
    : null;
  const builtIn = (why: unknown): void => {
    logMainError(new Error("no UI from the channel could be shown, so the window loads the built-in one", { cause: why }));
    try {
      ui?.placeBuiltIn();
    } catch (e) {
      // The UI folder can't be written either: the page still loads, and main.log says why it may be bare.
      logMainError(e);
    }
    current = index;
    refreshPreload();
    load();
  };
  const startUi = (): Promise<void> => (ui ? ui.start() : Promise.resolve()).catch(builtIn);
  attachWindow({
    win,
    view: webview,
    push: (name, value) => {
      if (name === "store") refreshPreload();
      bridge.push(name, value);
    },
    reload: () => {
      refreshPreload();
      if (ui && !ui.started()) void startUi();
      else load();
    },
  });
  let maximized = win.isMaximized();
  win.on("resize", () => {
    const now = win.isMaximized();
    if (now === maximized) return;
    maximized = now;
    bridge.push("maximized", now);
  });
  showNote = (state) => load(note(state));
  showCantRead = (u) => load(cantRead(u));
  webview.on("dom-ready", () => {
    mark("domReady");
    const stayHidden = quiet;
    quiet = false;
    if (closing || stayHidden || win.isVisible()) return;
    shown = true;
    win.show();
  });
  const guard = showWithin(SHOW_WITHIN_MS, {
    shown: () => shown || closing,
    show: () => {
      if (!loaded) builtIn(new Error("the UI engine hadn't loaded any page"));
      shown = true;
      win.show();
    },
    late: (waited) => logMainError(new Error(`the page wasn't ready ${waited / 1000} s after the window was made, so the window shows without waiting for it`)),
  });
  if (ui && !keyring && !unreadable) await Promise.race([startUi(), guard.waited]);
  else {
    ui?.placeBuiltIn();
    load(first);
  }
  mark("load");
  webview.on("will-navigate", () => mark("willNavigate"));
  webview.on("did-commit-navigation", () => mark("committed"));
  const look = win.ptr;
  if (look) windowLook(look, minWindowWidth(process.platform), WINDOW_SIZE.minHeight, rgb(windowBackground(false)), rgb(windowBackground(true)));
  if (look) glassWindow(look, (on) => bridge.push("frost", on));
  if (mac) win.setWindowButtonPosition(TRAFFIC_LIGHTS.x, TRAFFIC_LIGHTS.y);
  Electrobun.events.on(`new-window-open-${webview.id}`, (e: { data?: { detail?: unknown } }) => {
    const url = openedUrl(e.data?.detail);
    if (url) openOutside(url);
    else logMainError(new Error("a new-window request had no readable URL"));
  });
  return win;
}
