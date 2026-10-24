import type { Serves } from "../calls.ts";
import { takeDeepLink } from "../deep-links.ts";
import { externalUrl } from "../guard.ts";
import type { Host } from "../host.ts";
import { openInBrowser } from "../open.ts";
import { checkForUpdate, updateState } from "../updater.ts";

export function miscCalls(host: Host): Serves<"getUpdate" | "installUpdate" | "checkUpdate" | "notify" | "openExternal" | "getDeepLink" | "takeDroppedFiles" | "takePastedImage" | "setBadge"> {
  return {
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
  };
}
