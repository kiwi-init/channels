import { app, dialog, type BrowserWindow } from "electron";

import { logMainError } from "./main-log.ts";
import { afterCrash } from "./page-crash.ts";

export function keepRendererAlive(win: BrowserWindow, quitting: () => boolean, now: () => number = Date.now): void {
  let recent: number[] = [];
  let asking = false;
  const ask = async (message: string, buttons: [string, string]): Promise<boolean> => {
    if (asking || win.isDestroyed()) return false;
    asking = true;
    try {
      const { response } = await dialog.showMessageBox(win, { type: "warning", message, buttons, defaultId: 1, cancelId: 0 });
      return response === 1;
    } finally {
      asking = false;
    }
  };
  win.webContents.on("render-process-gone", (_e, details) => {
    if (details.reason === "clean-exit" || quitting() || win.isDestroyed()) return;
    const next = afterCrash(recent, now());
    recent = next.recent;
    logMainError(new Error(`the window's page stopped (${details.reason}, exit ${details.exitCode})`));
    if (next.reload) return win.webContents.reload();
    void ask("Channels' window keeps stopping.", ["Quit", "Reload"]).then((reload) => (reload ? win.webContents.reload() : app.quit()));
  });
  win.on("unresponsive", () => {
    void ask("Channels' window isn't responding.", ["Wait", "Reload"]).then((reload) => {
      if (reload && !win.isDestroyed()) win.webContents.forcefullyCrashRenderer();
    });
  });
}
