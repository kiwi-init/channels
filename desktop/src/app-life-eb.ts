import Electrobun, { Utils, type BrowserView, type BrowserWindow } from "electrobun/main";

import { textStepOf, type MenuAction } from "./app-menus.ts";
import { createTray, setAppMenu, type AppTray } from "./menus-eb.ts";
import { hasTrayHost } from "./native-eb.ts";
import type { TextStep } from "./text-size.ts";
import type { UpdateState } from "./updater.ts";
import { mark } from "./eb-startup.ts";
import { trayLater } from "./tray-later.ts";
import { watchWake } from "./wake.ts";

export interface LifeShell {
  win: BrowserWindow;
  view: BrowserView;
  showWindow(): void;
  reload(): void;
  textStep(step: TextStep): void;
  restartToUpdate(): void;
  update(): UpdateState | null;
  nudgeKeys(): void;
  flushKeys(): Promise<void>;
  release(): void;
}

export function startAppLife(shell: LifeShell): AppTray {
  let quitting = false;
  let flushed = false;
  let flushing: Promise<void> | null = null;
  const act = (a: MenuAction): void => {
    const step = textStepOf(a);
    if (step) return shell.textStep(step);
    if (a === "open") shell.showWindow();
    else if (a === "restart") shell.restartToUpdate();
    else if (a === "quit") Utils.quit();
    else if (a === "reload") shell.reload();
    else if (a === "devtools") shell.view.toggleDevTools();
  };
  Electrobun.events.on("reopen", () => shell.showWindow());
  Electrobun.events.on(`will-close-${shell.win.id}`, (e: { response?: { allow: boolean } }) => {
    if (quitting) return;
    e.response = { allow: false };
    if (hasTrayHost()) shell.win.hide();
    else shell.win.minimize();
  });
  const stopWake = watchWake(() => shell.nudgeKeys());
  const flushThenQuit = async (): Promise<void> => {
    try {
      await shell.flushKeys();
    } catch {
      // Keys that can't flush still let Channels quit: the next start reads what was last saved.
    }
    flushed = true;
    Utils.quit();
  };
  Electrobun.events.on("before-quit", (e: { response?: { allow: boolean } }) => {
    quitting = true;
    if (flushed) {
      stopWake();
      shell.release();
      return;
    }
    e.response = { allow: false };
    flushing ??= flushThenQuit();
  });
  setAppMenu(act);
  return trayLater({
    make: (u) => {
      const tray = createTray(act, u);
      mark("tray");
      return tray;
    },
    update: shell.update(),
    onReady: (f) => shell.view.on("dom-ready", f),
    later: (f, ms) => void setTimeout(f, ms),
  });
}
