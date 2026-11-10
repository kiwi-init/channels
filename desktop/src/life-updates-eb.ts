import Electrobun, { type BrowserWindow } from "electrobun/main";

import { startAppLife } from "./app-life-eb.ts";
import { mark } from "./eb-startup.ts";
import { externalUrl } from "./guard.ts";
import { keys } from "./keys-start-eb.ts";
import { ebHost } from "./host-eb.ts";
import { startUpdates, updateState, type UpdateState } from "./updater.ts";
import { onUiWaiting } from "./ui-signals.ts";

let toTray: ((u: UpdateState) => void) | null = null;

export function startUpdateChecks(): void {
  startUpdates((u) => {
    ebHost.push("update", u);
    toTray?.(u);
  });
  mark("updates");
}

export function startLife(win: BrowserWindow, release: () => void): void {
  const tray = startAppLife({
    win,
    view: win.webview,
    showWindow: () => ebHost.showWindow(),
    reload: () => ebHost.reload(),
    textStep: (step) => ebHost.push("textStep", step),
    command: (command) => ebHost.push("command", command),
    openHelp: (url) => {
      const help = externalUrl(url);
      if (help) void ebHost.openExternal(help).catch(() => {});
    },
    restartToUpdate: () => ebHost.restartToUpdate(),
    update: updateState,
    nudgeKeys: () => ebHost.tellKeys({ type: "nudge" }),
    flushKeys: () => keys.flush(),
    release,
  });
  mark("life");
  toTray = (u) => tray.refresh(u);
  onUiWaiting((u) => ebHost.push("uiUpdate", u));
  Electrobun.events.on("accent-color-changed", (e) => ebHost.push("accent", e.data.color));
}
