import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ApplicationMenu, BuildConfig, PATHS, Tray, Utils } from "electrobun/main";

import { appMenu, menuAction, trayItems, type MenuAction } from "./app-menus.ts";
import { trayTitle, unreadFile, unreadLabel, unreadSvg } from "./tray-unread.ts";
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

let unreadNow = 0;
let showUnread: ((count: number) => void) | null = null;

export function trayUnread(count: number): void {
  unreadNow = count;
  showUnread?.(count);
}

export function createTray(on: (a: MenuAction) => void, update: UpdateState | null): AppTray {
  const mac = process.platform === "darwin";
  const linux = process.platform === "linux";
  const assets = path.join(PATHS.VIEWS_FOLDER, "..", "assets");
  const plain = path.join(assets, mac || !linux ? "trayTemplate@2x.png" : "channels-tray-symbolic.svg");
  const tray = new Tray({
    title: linux ? "Channels" : "",
    image: plain,
    template: mac || linux,
    width: 16,
    height: 16,
  });
  tray.setMenu(trayItems(update));
  tray.on("tray-clicked", (e) => {
    const a = menuAction(e);
    if (a) on(a);
  });
  const written = new Set<string>();
  const unreadImage = (label: string): string => {
    if (mac) return path.join(assets, "trayUnreadTemplate@2x.png");
    if (!linux) return plain;
    const dir = path.join(Utils.paths.userCache, "tray");
    const file = path.join(dir, unreadFile(label));
    if (!written.has(file)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, unreadSvg(readFileSync(plain, "utf8"), label));
      written.add(file);
    }
    return file;
  };
  let shown = plain;
  const show = (count: number): void => {
    const label = unreadLabel(count);
    const image = label === null ? plain : unreadImage(label);
    if (image !== shown) {
      tray.setImage(image);
      shown = image;
    }
    if (linux) tray.setTitle(trayTitle(count));
  };
  show(unreadNow);
  showUnread = show;
  return { refresh: (u) => tray.setMenu(trayItems(u)) };
}
