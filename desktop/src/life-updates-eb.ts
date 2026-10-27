import Electrobun, { type BrowserWindow } from "electrobun/main";

import { startAppLife } from "./app-life-eb.ts";
import { mark } from "./eb-startup.ts";
import { keys } from "./keys-start-eb.ts";
import { ebHost } from "./host-eb.ts";
import { startUpdates, updateState } from "./updater.ts";
import { onUiWaiting } from "./ui-signals.ts";

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
  onUiWaiting((u) => ebHost.push("uiUpdate", u));
  Electrobun.events.on("accent-color-changed", (e) => ebHost.push("accent", e.data.color));
}
