import type { Serves } from "../calls.ts";
import { takeDeepLink } from "../deep-links.ts";
import { externalUrl } from "../guard.ts";
import type { Host } from "../host.ts";
import { logMainError } from "../main-log.ts";
import { openInBrowser } from "../open.ts";
import { MAX_SAVE_BYTES, savedName } from "../save-file.ts";
import { keysAtRest } from "../store.ts";
import { checkForUpdate, updateState } from "../updater.ts";
import { tintsOf } from "../wallpaper-tints.ts";
import { BACKDROP_HEIGHT, BACKDROP_WIDTH, backdropOf } from "../wallpaper-backdrop.ts";

export function miscCalls(
  host: Host,
): Serves<
  | "keysAtRest"
  | "getUpdate"
  | "installUpdate"
  | "checkUpdate"
  | "notify"
  | "openExternal"
  | "getDeepLink"
  | "takeDroppedFiles"
  | "takePastedImage"
  | "setBadge"
  | "setAppearance"
  | "wallpaperTints"
  | "wallpaperBackdrop"
  | "windowControl"
  | "saveFile"
  | "getAccentColor"
> {
  return {
    keysAtRest: () => keysAtRest(),
    getUpdate: () => updateState(),
    installUpdate: () => host.restartToUpdate(),
    checkUpdate: () => checkForUpdate(),
    notify: (title: string, body: string) => host.notify(title, body),
    openExternal: async (url: string) => {
      const ext = externalUrl(url);
      if (!ext) {
        logMainError(new Error(`refused to open a non-http(s) link: ${url}`));
        throw new Error("only http(s) links open outside");
      }
      try {
        await openInBrowser(ext, (u) => host.openExternal(u));
      } catch (err) {
        logMainError(new Error(`could not open ${ext} in the system browser`, { cause: err }));
        throw err;
      }
    },
    getDeepLink: () => takeDeepLink(),
    takeDroppedFiles: () => host.droppedFiles(),
    takePastedImage: () => host.pastedImage(),
    setBadge: (count: number) => {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("a badge is a count of zero or more");
      host.badge(count);
    },
    setAppearance: (appearance: string) => {
      if (appearance !== "system" && appearance !== "light" && appearance !== "dark") throw new Error("an appearance is system, light or dark");
      host.appearance(appearance);
    },
    wallpaperTints: async (dark: boolean) => {
      const pixels = await host.wallpaper(dark === true);
      return pixels ? tintsOf(pixels) : [];
    },
    saveFile: (name: string, text: string) => {
      if (typeof text !== "string" || Buffer.byteLength(text) > MAX_SAVE_BYTES) throw new Error("that file is too big to save");
      return host.saveDownload(savedName(String(name)), text);
    },
    windowControl: (action: string) => {
      if (action !== "minimize" && action !== "maximize" && action !== "close") throw new Error("a window control is minimize, maximize or close");
      host.windowControl(action);
    },
    wallpaperBackdrop: async (dark: boolean) => {
      const pixels = await host.wallpaperImage(dark === true, BACKDROP_WIDTH, BACKDROP_HEIGHT);
      return pixels ? backdropOf(pixels, BACKDROP_WIDTH, BACKDROP_HEIGHT) : null;
    },
    getAccentColor: () => host.accentColor(),
  };
}
