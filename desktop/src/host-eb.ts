import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Electrobun, { BuildConfig, PATHS, Utils, type BrowserView, type BrowserWindow } from "electrobun/main";

import type { Push, Pushes } from "./calls.ts";
import { childEnv } from "./child-env.ts";
import type { Host } from "./host.ts";
import type { HostToKeys } from "./keys-server.ts";
import { readDropped } from "./dropped.ts";
import { droppedPaths, notifyLinux, onNoteClick, pastedPng, showBadge } from "./native-eb.ts";
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

export function attachWindow(next: Shown): void {
  shown = next;
  onNoteClick(next.win.ptr, () => ebHost.showWindow());
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
  notify: (title, body) => {
    if (process.platform === "linux") notifyLinux(title, body);
    else Utils.showNotification({ title, body });
  },
  showWindow: () => {
    if (!shown) return;
    if (shown.win.isMinimized()) shown.win.unminimize();
    shown.win.show();
    shown.win.activate();
  },
  reload: () => shown?.reload(),
  restartToUpdate: () => {
    if (applyUpdate(true)) Utils.quit();
  },
  tellKeys: (m) => keysTell(m),
};
