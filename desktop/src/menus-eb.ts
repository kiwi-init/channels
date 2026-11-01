import path from "node:path";
import { ApplicationMenu, BuildConfig, PATHS, Tray } from "electrobun/main";

import { appMenu, menuAction, trayItems, type MenuAction } from "./app-menus.ts";
import type { UpdateState } from "./updater.ts";

export function setAppMenu(on: (a: MenuAction) => void): void {
  ApplicationMenu.setApplicationMenu(appMenu(process.platform, BuildConfig.getSync().isPackaged));
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
  const linux = process.platform === "linux";
  const tray = new Tray({
    title: linux ? "Channels" : "",
    image: path.join(PATHS.VIEWS_FOLDER, "..", "assets", mac || !linux ? "trayTemplate@2x.png" : "channels-tray-symbolic.svg"),
    template: mac || linux,
    width: 16,
    height: 16,
  });
  tray.setMenu(trayItems(update));
  tray.on("tray-clicked", (e) => {
    const a = menuAction(e);
    if (a) on(a);
  });
  return { refresh: (u) => tray.setMenu(trayItems(u)) };
}
