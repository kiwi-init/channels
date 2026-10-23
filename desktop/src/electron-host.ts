import { dialog, ipcMain, Notification, shell, type OpenDialogOptions } from "electron";

import type { Call, CallArgs, Handlers } from "./calls.ts";
import type { Host } from "./host.ts";
import { connectKeys, tellKeys } from "./keys-process.ts";
import { entryUrl } from "./serve-web.ts";
import { snapshot } from "./store.ts";
import { currentWindow, push, restartToUpdate, showWindow } from "./window.ts";

const PICK: OpenDialogOptions = { properties: ["openDirectory", "createDirectory"], buttonLabel: "Choose" };
const shown = new Set<Notification>();

export const electronHost: Host = {
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
  reload: () => void currentWindow()?.loadURL(entryUrl()),
  restartToUpdate,
  tellKeys,
};

function serve<K extends Call>(handlers: Handlers, name: K): void {
  const fn: Handlers[K] = handlers[name];
  ipcMain.handle(`kiwi:${name}`, (_e, ...args: CallArgs<K>) => fn(...args));
}

export function serveCalls(handlers: Handlers): void {
  ipcMain.on("kiwi:snapshot-sync", (e) => (e.returnValue = snapshot()));
  ipcMain.on("kiwi:channels-connect", (e) => connectKeys(e.sender));
  for (const name of Object.keys(handlers) as Call[]) serve(handlers, name);
}
