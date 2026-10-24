import type { BrowserWindow } from "electrobun/main";

import { startAppLife } from "./app-life-eb.ts";
import { mark } from "./eb-startup.ts";
import { keys } from "./keys-start-eb.ts";
import { ebHost } from "./host-eb.ts";
import { startUpdates, updateState } from "./updater.ts";

export function startLife(win: BrowserWindow, release: () => void): void {
  const tray = startAppLife({
    win,
    view: win.webview,
    showWindow: () => ebHost.showWindow(),
    reload: () => ebHost.reload(),
    textStep: (step) => ebHost.push("textStep", step),
    restartToUpdate: () => ebHost.restartToUpdate(),
    update: updateState,
    nudgeKeys: () => ebHost.tellKeys({ type: "nudge" }),
    flushKeys: () => keys.flush(),
    release,
  });
  mark("life");
  startUpdates((u) => {
    ebHost.push("update", u);
    tray.refresh(u);
  });
  mark("updates");
}
