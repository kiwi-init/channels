import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Electrobun, { BuildConfig, PATHS, Utils, type BrowserView, type BrowserWindow } from "electrobun/main";

import type { Push, Pushes } from "./calls.ts";
import { childEnv } from "./child-env.ts";
import type { Host } from "./host.ts";
import type { HostToKeys } from "./keys-server.ts";
import { readDropped } from "./dropped.ts";
import { followTheme } from "./frost-eb.ts";
import { handleDeepLink } from "./deep-links.ts";
import { droppedPaths, onNoteClick, pastedPng, showBadge, showNote, wallpaperImage, wallpaperPixels } from "./native-eb.ts";
import { noteLinks } from "./note-links.ts";
import { freePath } from "./save-file.ts";
import { relaunchAfter } from "./update-asset.ts";
import { applyUpdate } from "./updater.ts";
import { ebDataDir } from "./store-eb.ts";

interface Bundle {
  identifier: string;
  version: string;
  channel: string;
}

function bundleInfo(): Bundle {
  const raw = JSON.parse(fs.readFileSync(path.join(PATHS.RESOURCES_FOLDER, "version.json"), "utf8")) as { identifier?: unknown; version?: unknown; channel?: unknown };
  if (typeof raw.identifier !== "string" || typeof raw.version !== "string" || typeof raw.channel !== "string")
    throw new Error("the app bundle's version.json names no identifier, version or channel");
  return { identifier: raw.identifier, version: raw.version, channel: raw.channel };
}

const bundle: Bundle = bundleInfo();

const MAX_PASTED_BYTES = 25 * 1024 * 1024;

export const dataDir: string = ebDataDir(bundle.identifier, bundle.channel);

interface Shown {
  win: BrowserWindow;
  view: BrowserView;
  push: <P extends Push>(name: P, value: Pushes[P]) => void;
  reload: () => void;
}

let shown: Shown | null = null;

let keysTell: (m: HostToKeys) => void = () => {};

const notes = noteLinks();

export function attachWindow(next: Shown): void {
  shown = next;
  onNoteClick(next.win.ptr, (tag) => {
    ebHost.showWindow();
    const link = notes.link(tag);
    if (link) handleDeepLink(link);
  });
}

export function attachKeys(tell: (m: HostToKeys) => void): void {
  keysTell = tell;
}

export const ebHost: Host = {
  app: {
    packaged: () => BuildConfig.getSync().isPackaged,
    version: () => bundle.version,
    path: (name) => (name === "data" ? dataDir : name === "logs" ? Utils.paths.userLogs : name === "exe" ? process.execPath : PATHS.RESOURCES_FOLDER),
    ready: () => true,
    relaunch: (execPath) => {
      const after = relaunchAfter(process.pid, execPath, process.env);
      spawn("/bin/sh", after.args, { detached: true, stdio: "ignore", env: childEnv(after.env) }).unref();
    },
    onQuit: (fn) => Electrobun.events.on("before-quit", fn),
  },
  push: (name, value) => shown?.push(name, value),
  openExternal: async (url) => {
    if (!Utils.openExternal(url)) throw new Error("the system browser didn't open the link");
  },
  pickFolder: async () => {
    const picked = await Utils.openFileDialog({ canChooseFiles: false, canChooseDirectory: true, allowsMultipleSelection: false });
    return picked.find((p) => p.length > 0) ?? null;
  },
  droppedFiles: () => readDropped(droppedPaths()),
  pastedImage: async () => {
    const png = pastedPng(MAX_PASTED_BYTES);
    return png ? { type: "image/png", data: Buffer.from(png).toString("base64") } : null;
  },
  badge: (count) => showBadge(count),
  accentColor: () => Utils.getAccentColor(),
  appearance: (appearance) => {
    if (shown?.win.ptr) followTheme(shown.win.ptr, appearance);
  },
  wallpaper: (dark) => wallpaperPixels(dark),
  wallpaperImage: (dark, width, height) => wallpaperImage(dark, width, height),
  windowControl: (action) => {
    const win = shown?.win;
    if (!win) return;
    if (action === "minimize") win.minimize();
    else if (action === "close") win.requestClose();
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  },
  notify: (title, body, link) => void showNote(title, body, notes.tag(link)),
  showWindow: () => {
    if (!shown) return;
    if (shown.win.isMinimized()) shown.win.unminimize();
    shown.win.show();
    shown.win.activate();
  },
  reload: () => shown?.reload(),
  saveDownload: async (name, text) => {
    const dir = downloadsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = freePath(dir, name, (f) => fs.existsSync(f));
    fs.writeFileSync(file, text, { flag: "wx" });
    Utils.showItemInFolder(file);
    return path.basename(file);
  },
  restartToUpdate: () => {
    const applied = applyUpdate(true);
    if (applied) Utils.quit();
    return applied;
  },
  tellKeys: (m) => keysTell(m),
};

function downloadsDir(): string {
  if (process.platform === "linux") {
    const xdg = spawnSync("xdg-user-dir", ["DOWNLOAD"], { encoding: "utf8", timeout: 2000, env: childEnv() });
    const dir = xdg.status === 0 ? xdg.stdout.trim() : "";
    if (dir && dir !== os.homedir()) return dir;
  }
  return path.join(os.homedir(), "Downloads");
}
