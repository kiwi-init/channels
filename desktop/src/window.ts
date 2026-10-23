import path from "node:path";
import { app, BrowserWindow, Menu, nativeImage, nativeTheme, shell, Tray } from "electron";

import { pendingDeepLink } from "./deep-links.ts";
import { externalUrl, isAppUrl } from "./guard.ts";
import { openInBrowser } from "./open.ts";
import { keepRendererAlive } from "./revive.ts";
import { entryUrl } from "./serve-web.ts";
import { textStepFor, type TextStep } from "./text-size.ts";
import { applyUpdate, updateState } from "./updater.ts";
import { TRAFFIC_LIGHTS, WINDOW_SIZE, windowBackground } from "./window-look.ts";
import { minWindowWidth } from "./window-size.ts";

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

export const currentWindow = (): BrowserWindow | null => win;
export const isQuitting = (): boolean => quitting;
export function markQuitting(): void {
  quitting = true;
}

const preloadPath = () => (app.isPackaged ? path.join(app.getAppPath(), "dist", "preload.js") : path.join(__dirname, "..", "dist", "preload.js"));

function openOutside(url: string): void {
  const ext = externalUrl(url);
  if (ext) void openInBrowser(ext, (u) => shell.openExternal(u)).catch(() => {});
}

export function stepText(step: TextStep): void {
  win?.webContents.send("kiwi:text-step", step);
}

export function guardContents(wc: Electron.WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  const stay = (e: Electron.Event, url: string) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    openOutside(url);
  };
  wc.on("will-navigate", stay);
  wc.on("will-redirect", stay);
  wc.on("will-attach-webview", (e) => e.preventDefault());
}

export function createWindow(): void {
  win = new BrowserWindow({
    width: WINDOW_SIZE.width,
    height: WINDOW_SIZE.height,
    minWidth: minWindowWidth(process.platform),
    minHeight: WINDOW_SIZE.minHeight,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon: path.join(assetsDir(), "icon.png") } : {}),
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: TRAFFIC_LIGHTS } : {}),
    backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors),
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true },
  });
  keepRendererAlive(win, () => quitting);
  const wc = win.webContents;
  wc.on("before-input-event", (e, input) => {
    const step = textStepFor(input, process.platform);
    if (!step) return;
    e.preventDefault();
    stepText(step);
  });
  wc.on("did-finish-load", () => wc.setZoomLevel(0));
  void win.loadURL(entryUrl());
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
  });
  win.on("closed", () => (win = null));
  const deepLink = pendingDeepLink();
  if (deepLink) win.webContents.send("kiwi:deep-link", deepLink);
}

export function restartToUpdate(): void {
  if (!applyUpdate(true)) return;
  quitting = true;
  app.quit();
}

function trayMenu(): Electron.Menu {
  const u = updateState();
  return Menu.buildFromTemplate([
    { label: "Open Channels", click: showWindow },
    ...(u?.state === "ready" ? [{ label: `Restart to update to ${u.version}`, click: restartToUpdate }] : []),
    { type: "separator" },
    { label: "Quit", click: () => ((quitting = true), app.quit()) },
  ]);
}

export function refreshTray(): void {
  tray?.setContextMenu(trayMenu());
}

export function createTray(): void {
  const icon = trayIcon();
  tray = new Tray(icon);
  tray.setToolTip("Channels");
  tray.setContextMenu(trayMenu());
  tray.on("click", () => (win && !win.isDestroyed() && win.isVisible() ? win.hide() : showWindow()));
}

const assetsDir = () => (app.isPackaged ? path.join(process.resourcesPath, "assets") : path.join(__dirname, "..", "assets"));

function trayIcon(): Electron.NativeImage {
  const mac = process.platform === "darwin";
  const img = nativeImage.createFromPath(path.join(assetsDir(), mac ? "trayTemplate.png" : "tray.png"));
  if (mac) img.setTemplateImage(true);
  return img;
}

export function showWindow(): void {
  if (!win || win.isDestroyed()) createWindow();
  if (win?.isMinimized()) win.restore();
  win?.show();
  win?.focus();
}
