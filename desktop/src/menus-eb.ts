import path from "node:path";
import { ApplicationMenu, PATHS, Tray } from "electrobun/main";

import { APP_NAME } from "./app-name-eb.ts";
import { appMenu, menuAction, trayItems, type MenuAction } from "./app-menus.ts";
import type { UpdateState } from "./updater.ts";

export function setAppMenu(on: (a: MenuAction) => void): void {
  ApplicationMenu.setApplicationMenu(appMenu(process.platform, APP_NAME));
  ApplicationMenu.on("application-menu-clicked", (e) => {
    const a = menuAction(e);
    if (a) on(a);
  });
}

export interface AppTray {
  refresh(update: UpdateState | null): void;
}

export function createTray(on: (a: MenuAction) => void, update: UpdateState | null): AppTray {
  const mac = process.platform === "darwin";
  const tray = new Tray({
    image: path.join(PATHS.VIEWS_FOLDER, "..", "assets", mac ? "trayTemplate@2x.png" : "tray@2x.png"),
    template: mac,
    width: 16,
    height: 16,
  });
  tray.setMenu(trayItems(update, APP_NAME));
  tray.on("tray-clicked", (e) => {
    const a = menuAction(e);
    if (a) on(a);
  });
  return { refresh: (u) => tray.setMenu(trayItems(u, APP_NAME)) };
}
