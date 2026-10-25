import { JSCallback } from "bun:ffi";
import Electrobun, { Utils } from "electrobun/main";

import { keepDaemon } from "./bundled-daemon.ts";
import { ebHost } from "./host-eb.ts";
import { logMainError } from "./main-log.ts";
import { messageBox } from "./message-box-eb.ts";
import { watchPageGone } from "./native-eb.ts";
import { keepPageAlive } from "./page-crash.ts";

let quitting = false;
Electrobun.events.on("before-quit", () => void (quitting = true));
let pageWatch: JSCallback | null = null;

export function watchPage(): void {
  const gone = keepPageAlive({
    reload: () => ebHost.reload(),
    ask: async (message, buttons) => (await messageBox({ type: "warning", message, buttons, defaultId: 1, cancelId: 0 })) === 1,
    quit: () => void Utils.quit(),
    log: logMainError,
    quitting: () => quitting,
    now: Date.now,
  });
  pageWatch = new JSCallback(() => gone("its web content process ended"), { args: [], returns: "void", threadsafe: true });
  if (!watchPageGone(pageWatch)) logMainError(new Error("Electrobun's navigation delegate wasn't found: a stopped page isn't reloaded or counted"));
}

export function keepDaemonAlive(): void {
  void keepDaemon(() => quitting).catch(logMainError);
}
