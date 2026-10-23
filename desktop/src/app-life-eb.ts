import Electrobun, { Utils, type BrowserView, type BrowserWindow } from "electrobun/main";

import { textStepOf, type MenuAction } from "./app-menus.ts";
import { handleDeepLink } from "./deep-links.ts";
import { createTray, setAppMenu, type AppTray } from "./menus-eb.ts";
import type { TextStep } from "./text-size.ts";
import type { UpdateState } from "./updater.ts";
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
  const act = (a: MenuAction): void => {
    const step = textStepOf(a);
    if (step) return shell.textStep(step);
    if (a === "open") shell.showWindow();
    else if (a === "restart") shell.restartToUpdate();
    else if (a === "quit") Utils.quit();
    else if (a === "reload") shell.reload();
    else if (a === "devtools") shell.view.toggleDevTools();
  };
  Electrobun.events.on("open-url", (e: { data?: { url?: unknown } }) => {
    if (typeof e.data?.url === "string") handleDeepLink(e.data.url);
  });
  Electrobun.events.on("reopen", () => shell.showWindow());
  Electrobun.events.on(`will-close-${shell.win.id}`, (e: { response?: { allow: boolean } }) => {
    if (quitting) return;
    e.response = { allow: false };
    shell.win.hide();
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
    void flushThenQuit();
  });
  setAppMenu(act);
  return createTray(act, shell.update());
}
