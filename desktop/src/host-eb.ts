import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Electrobun, { BuildConfig, PATHS, Utils, type BrowserView, type BrowserWindow } from "electrobun/main";

import type { Push, Pushes } from "./calls.ts";
import type { Host } from "./host.ts";

interface Bundle {
  identifier: string;
  version: string;
}

function bundleInfo(): Bundle {
  const raw = JSON.parse(fs.readFileSync(path.join(PATHS.RESOURCES_FOLDER, "version.json"), "utf8")) as { identifier?: unknown; version?: unknown };
  if (typeof raw.identifier !== "string" || typeof raw.version !== "string") throw new Error("the app bundle's version.json names no identifier or version");
  return { identifier: raw.identifier, version: raw.version };
}

export const bundle: Bundle = bundleInfo();

interface Shown {
  win: BrowserWindow;
  view: BrowserView;
  push: <P extends Push>(name: P, value: Pushes[P]) => void;
  reload: () => void;
}

let shown: Shown | null = null;

export function attachWindow(next: Shown): void {
  shown = next;
}

export const ebHost: Host = {
  app: {
    packaged: () => BuildConfig.getSync().isPackaged,
    version: () => bundle.version,
    path: (name) => (name === "data" ? Utils.paths.userData : name === "logs" ? Utils.paths.userLogs : name === "exe" ? process.execPath : PATHS.RESOURCES_FOLDER),
    ready: () => true,
    relaunch: (execPath) => spawn(execPath, [], { detached: true, stdio: "ignore" }).unref(),
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
  notify: (title, body) => Utils.showNotification({ title, body }),
  showWindow: () => {
    if (!shown) return;
    if (shown.win.isMinimized()) shown.win.unminimize();
    shown.win.show();
    shown.win.activate();
  },
  reload: () => shown?.reload(),
  restartToUpdate: () => {},
  tellKeys: () => {},
};
