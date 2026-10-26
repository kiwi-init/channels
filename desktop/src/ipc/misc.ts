import type { Serves } from "../calls.ts";
import { takeDeepLink } from "../deep-links.ts";
import { externalUrl } from "../guard.ts";
import type { Host } from "../host.ts";
import { openInBrowser } from "../open.ts";
import { keysAtRest } from "../store.ts";
import { checkForUpdate, updateState } from "../updater.ts";
import { tintsOf } from "../wallpaper-tints.ts";

export function miscCalls(
  host: Host,
): Serves<
  "keysAtRest" | "getUpdate" | "installUpdate" | "checkUpdate" | "notify" | "openExternal" | "getDeepLink" | "takeDroppedFiles" | "takePastedImage" | "setBadge" | "setAppearance" | "wallpaperTints"
> {
  return {
    keysAtRest: () => keysAtRest(),
    getUpdate: () => updateState(),
    installUpdate: () => host.restartToUpdate(),
    checkUpdate: () => checkForUpdate(),
    notify: (title: string, body: string) => host.notify(title, body),
    openExternal: (url: string) => {
      const ext = externalUrl(url);
      if (!ext) throw new Error("only http(s) links open outside");
      return openInBrowser(ext, (u) => host.openExternal(u));
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
    wallpaperTints: (dark: boolean) => {
      const pixels = host.wallpaper(dark === true);
      return pixels ? tintsOf(pixels) : [];
    },
  };
}
