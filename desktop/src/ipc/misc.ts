import { MAX_IMAGE_BYTES } from "@kiwi/core/protocol.ts";
import { shrinkImage } from "@kiwi/core/node/shrink-image.ts";

import type { Serves } from "../calls.ts";
import { MAX_DROPPED_BYTES } from "../dropped.ts";
import { opensChannel, takeDeepLink } from "../deep-links.ts";
import { externalUrl } from "../guard.ts";
import type { Host } from "../host.ts";
import { logMainError } from "../main-log.ts";
import { openInBrowser } from "../open.ts";
import { MAX_SAVE_BYTES, savedName } from "../save-file.ts";
import { CHANNEL_CALLS } from "../bridge.ts";
import { keysAtRest } from "../store.ts";
import { UI_CONTRACT } from "../ui-contract.ts";
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
  | "compressImage"
  | "setBadge"
  | "setAppearance"
  | "wallpaperTints"
  | "wallpaperBackdrop"
  | "windowControl"
  | "saveFile"
  | "getAccentColor"
  | "capabilities"
> {
  return {
    keysAtRest: () => keysAtRest(),
    getUpdate: () => updateState(),
    installUpdate: () => host.restartToUpdate(),
    checkUpdate: () => checkForUpdate(),
    notify: (title: string, body: string, link?: string) => host.notify(title, body, opensChannel(link)),
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
    compressImage: async (data: string, limit: number) => {
      if (typeof data !== "string" || data.length > Math.ceil(MAX_DROPPED_BYTES / 3) * 4) throw new Error("that image is too big to open");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_IMAGE_BYTES) throw new Error(`a limit is 1 to ${MAX_IMAGE_BYTES} bytes`);
      const out = await shrinkImage(Buffer.from(data, "base64"), limit);
      return { type: out.mime, data: Buffer.from(out.bytes).toString("base64") };
    },
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
    capabilities: () => ({ contract: UI_CONTRACT, channelCalls: [...CHANNEL_CALLS] }),
  };
}
