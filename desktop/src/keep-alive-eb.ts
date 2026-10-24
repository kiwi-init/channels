import { JSCallback } from "bun:ffi";
import Electrobun, { Utils } from "electrobun/main";

import { keepDaemon } from "./bundled-daemon.ts";
import { ebHost } from "./host-eb.ts";
import { logMainError } from "./main-log.ts";
import { watchPageGone } from "./native-eb.ts";
import { keepPageAlive } from "./page-crash.ts";

let quitting = false;
Electrobun.events.on("before-quit", () => void (quitting = true));
let pageWatch: JSCallback | null = null;

function watchPage(): void {
  const gone = keepPageAlive({
    reload: () => ebHost.reload(),
    ask: async (message, buttons) => (await Utils.showMessageBox({ type: "warning", message, buttons, defaultId: 1, cancelId: 0 })).response === 1,
    quit: () => void Utils.quit(),
    log: logMainError,
    quitting: () => quitting,
    now: Date.now,
  });
  pageWatch = new JSCallback(() => gone("its web content process ended"), { args: [], returns: "void", threadsafe: true });
  if (!watchPageGone(pageWatch)) logMainError(new Error("Electrobun's navigation delegate wasn't found: a stopped page isn't reloaded or counted"));
}

export function keepAlive(): void {
  watchPage();
  void keepDaemon(() => quitting).catch(logMainError);
}
