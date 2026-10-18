import { ipcMain, Notification, shell } from "electron";

import { takeDeepLink } from "../deep-links.ts";
import { externalUrl } from "../guard.ts";
import { openInBrowser } from "../open.ts";
import { checkForUpdate, updateState } from "../updater.ts";
import { restartToUpdate, showWindow } from "../window.ts";

export function wireMiscIpc(): void {
  ipcMain.handle("kiwi:update-state", () => updateState());
  ipcMain.handle("kiwi:update-install", () => restartToUpdate());
  ipcMain.handle("kiwi:update-check", () => checkForUpdate());
  const shown = new Set<Notification>();
  ipcMain.handle("kiwi:notify", (_e, title: string, body: string) => {
    const n = new Notification({ title, body });
    shown.add(n);
    for (const old of shown) if (shown.size > 100) shown.delete(old);
    const done = () => shown.delete(n);
    n.on("click", () => (done(), showWindow()));
    n.on("close", done);
    n.on("failed", done);
    n.show();
  });
  ipcMain.handle("kiwi:open-external", (_e, url: string) => {
    const ext = externalUrl(url);
    if (!ext) throw new Error("only http(s) links open outside");
    return openInBrowser(ext, (u) => shell.openExternal(u));
  });
  ipcMain.handle("kiwi:deep-link", () => takeDeepLink());
}
