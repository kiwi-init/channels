import Electrobun, { Utils } from "electrobun/main";

import { keepDaemon } from "./bundled-daemon.ts";
import { ebHost } from "./host-eb.ts";
import { logMainError } from "./main-log.ts";
import { keepPageAlive } from "./page-crash.ts";

let quitting = false;
Electrobun.events.on("before-quit", () => void (quitting = true));

export function watchPage(): void {
  const gone = keepPageAlive({
    reload: () => ebHost.reload(),
    ask: async (message, buttons) => (await Utils.showMessageBox({ type: "warning", message, buttons, defaultId: 1, cancelId: 0 })).response === 1,
    quit: () => void Utils.quit(),
    log: logMainError,
    quitting: () => quitting,
    now: Date.now,
  });
  Electrobun.events.on("render-process-gone", () => gone("its web content process ended"));
}

export function keepDaemonAlive(): void {
  void keepDaemon(() => quitting).catch(logMainError);
}
