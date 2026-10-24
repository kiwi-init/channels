import { app, dialog, ipcMain, Notification, shell, type IpcMainEvent, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";

import type { Call, CallArgs, Handlers } from "./calls.ts";
import { isAppUrl } from "./guard.ts";
import type { Host } from "./host.ts";
import { connectKeys, tellKeys } from "./keys-process.ts";
import { entryUrl } from "./serve-web.ts";
import { snapshot } from "./store.ts";
import { currentWindow, push, restartToUpdate, showWindow } from "./window.ts";

const PICK: OpenDialogOptions = { properties: ["openDirectory", "createDirectory"], buttonLabel: "Choose" };
const shown = new Set<Notification>();

export const electronHost: Host = {
  app: {
    packaged: () => app.isPackaged,
    version: () => app.getVersion(),
    path: (name) => (name === "resources" ? process.resourcesPath : app.getPath(name === "data" ? "userData" : name)),
    ready: () => app.isReady(),
    relaunch: (execPath) => app.relaunch({ execPath }),
    onQuit: (fn) => void app.on("will-quit", fn),
  },
  push,
  openExternal: (url) => shell.openExternal(url),
  pickFolder: async () => {
    const win = currentWindow();
    const picked = await (win ? dialog.showOpenDialog(win, PICK) : dialog.showOpenDialog(PICK));
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  },
  notify: (title, body) => {
    const n = new Notification({ title, body });
    shown.add(n);
    for (const old of shown) if (shown.size > 100) shown.delete(old);
    const done = () => shown.delete(n);
    n.on("click", () => (done(), showWindow()));
    n.on("close", done);
    n.on("failed", done);
    n.show();
  },
  showWindow,
  reload: () => void currentWindow()?.loadURL(entryUrl()),
  restartToUpdate,
  tellKeys,
};

const fromPage = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => {
  const frame = e.senderFrame;
  return frame !== null && frame.parent === null && isAppUrl(frame.url);
};

function serve<K extends Call>(handlers: Handlers, name: K): void {
  const fn: Handlers[K] = handlers[name];
  ipcMain.handle(`kiwi:${name}`, (e, ...args: CallArgs<K>) => {
    if (!fromPage(e)) throw new Error("only Channels' own page can call the app");
    return fn(...args);
  });
}

export function serveCalls(handlers: Handlers): void {
  ipcMain.on("kiwi:snapshot-sync", (e) => (e.returnValue = fromPage(e) ? snapshot() : null));
  ipcMain.on("kiwi:channels-connect", (e) => {
    if (fromPage(e)) connectKeys(e.sender);
  });
  for (const name of Object.keys(handlers) as Call[]) serve(handlers, name);
}
