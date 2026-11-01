import "./launcher-channel-eb.ts";

import Electrobun, { BrowserView, Utils } from "electrobun/main";

import { internalRpcHandlers } from "../.hutch/devkit/api/sdks/main/proc/native.ts";
import { handleDeepLink, JOIN_SCHEME } from "./deep-links.ts";
import { lockInternalRpc } from "./eb-bridge.ts";
import { mark } from "./eb-startup.ts";
import { dataDir, ebHost } from "./host-eb.ts";
import { useHost } from "./host.ts";
import { keepDaemonAlive, watchPage } from "./keep-alive-eb.ts";
import { KEYRING_GRACE_MS, openedWithin } from "./keyring-wait.ts";
import { startKeys } from "./keys-start-eb.ts";
import { startLife } from "./life-updates-eb.ts";
import { keepLinuxEntry } from "./linux-entry.ts";
import { catchMainErrors, logMainError, windowFailure } from "./main-log.ts";
import { followColorScheme, missingGuard, sandboxOff, watchDrops, watchPaste } from "./native-eb.ts";
import { watchCancels } from "./secret-service.ts";
import { claimInstance, handoffFor, type Instance } from "./single-instance.ts";
import { keyringLocked, openStoreForThisBuild, warnIfStoreBroken } from "./store-open-eb.ts";
import { driveForTests, wrongTestHome } from "./test-build-eb.ts";
import { runningAppImage } from "./updater.ts";
import { createWindow, fail, showKeyringNote } from "./window-eb.ts";

declare const KIWI_EB_TEST: boolean;

mark("main");

useHost(KIWI_EB_TEST ? { ...ebHost, app: { ...ebHost.app, packaged: () => true } } : ebHost);
catchMainErrors();
Electrobun.events.on("open-url", (e: { data?: { url?: unknown } }) => {
  if (typeof e.data?.url === "string") handleDeepLink(e.data.url);
});
lockInternalRpc(internalRpcHandlers);

async function start(instance: Extract<Instance, { kind: "first" }>): Promise<void> {
  ebHost.app.onQuit(instance.release);
  const asked = performance.now();
  let cancelled = false;
  const stop =
    process.platform === "linux"
      ? watchCancels(() => {
          if (cancelled) return;
          cancelled = true;
          console.error("Channels: the keyring prompt was cancelled; the window says so and offers to ask again");
          showKeyringNote("cancelled");
        })
      : () => {};
  const opening = openStoreForThisBuild().finally(stop);
  const inTime = await openedWithin(opening, KEYRING_GRACE_MS);
  if (!inTime) console.error(`Channels: the keyring hasn't answered in ${KEYRING_GRACE_MS / 1000} s, so the window says it's waiting for it`);
  watchPage();
  followColorScheme();
  watchDrops();
  watchPaste();
  const win = await createWindow(cancelled && (!inTime || keyringLocked()) ? "cancelled" : !inTime ? "waiting" : keyringLocked() ? "locked" : null);
  if (!win) {
    instance.release();
    return;
  }
  if (!inTime) {
    await opening;
    console.error(`Channels: the keyring answered after ${Math.round((performance.now() - asked) / 1000)} s`);
    if (keyringLocked() && !cancelled) showKeyringNote("locked");
  }
  if (keyringLocked()) {
    console.error("Channels: the keyring stayed locked, so the window asks to unlock it and nothing is kept unencrypted");
    return;
  }
  startKeys();
  if (!inTime) ebHost.reload();
  driveForTests(win);
  startLife(win, instance.release);
  keepDaemonAlive();
  warnIfStoreBroken();
}

function refuse(instance: Extract<Instance, { kind: "first" }>, why: string): void {
  instance.release();
  fail(why);
}

BrowserView.on("created", (tag) => tag.remove());

const wrongHome = wrongTestHome();
if (wrongHome) console.error(`Channels test build: ${wrongHome}; not starting, so nothing lands under the person's home`);
const instance = wrongHome
  ? null
  : await claimInstance({
      dir: dataDir,
      handoff: handoffFor(process.argv, JOIN_SCHEME),
      scheme: JOIN_SCHEME,
      onHandoff: (h) => (h.kind === "link" ? handleDeepLink(h.url) : ebHost.showWindow()),
    }).catch((e: unknown) => {
      logMainError(e);
      console.error("Channels: couldn't take the single-instance lock in its data folder", e);
      return null;
    });
const missing = instance?.kind === "first" ? missingGuard() : null;
if (!instance) Utils.quit(1);
else if (instance.kind === "second") {
  if (!instance.delivered) console.error("Channels: another Channels holds this data folder and didn't answer; quitting");
  Utils.quit(0);
} else if (missing) refuse(instance, missing);
else {
  const appImage = process.platform === "linux" && ebHost.app.packaged() ? runningAppImage() : undefined;
  if (appImage) {
    try {
      const entry = keepLinuxEntry(appImage);
      if (entry.kind === "skipped") console.error(`Channels: no desktop entry written: ${entry.why}`);
      else if (entry.wrote.length) console.error(`Channels: the desktop entry now starts ${appImage}: wrote ${entry.wrote.join(", ")}`);
    } catch (e) {
      // A home that can't take the entry still runs the app; main.log keeps why.
      logMainError(e);
    }
  }
  const off = sandboxOff();
  if (off !== null) {
    const why = `WebKitGTK's sandbox is off: ${off}, so the page runs without it`;
    console.error(`Channels: ${why}`);
    logMainError(new Error(why));
  }
  try {
    await start(instance);
  } catch (e) {
    // Nothing on screen can say what went wrong: main.log and the console carry it, and the app quits instead of running windowless.
    logMainError(e);
    console.error(`Channels: ${windowFailure(e)}`, e);
    instance.release();
    Utils.quit(1);
  }
}
