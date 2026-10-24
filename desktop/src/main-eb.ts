import Electrobun, { BrowserView, Utils } from "electrobun/main";

import { internalRpcHandlers } from "../.hutch/devkit/api/sdks/main/proc/native.ts";
import { handleDeepLink, JOIN_SCHEME } from "./deep-links.ts";
import { lockInternalRpc } from "./eb-bridge.ts";
import { mark } from "./eb-startup.ts";
import { ebHost } from "./host-eb.ts";
import { useHost } from "./host.ts";
import { keepAlive } from "./keep-alive-eb.ts";
import { startKeys } from "./keys-start-eb.ts";
import { startLife } from "./life-updates-eb.ts";
import { catchMainErrors, logMainError } from "./main-log.ts";
import { missingGuard, sandboxOff } from "./native-eb.ts";
import { claimInstance, handoffFor, type Instance } from "./single-instance.ts";
import { openStoreForThisBuild, warnIfStoreBroken } from "./store-eb.ts";
import { driveForTests, wrongTestHome } from "./test-build-eb.ts";
import { createWindow, fail } from "./window-eb.ts";

declare const KIWI_EB_TEST: boolean;

mark("main");

useHost(KIWI_EB_TEST ? { ...ebHost, app: { ...ebHost.app, packaged: () => true } } : ebHost);
catchMainErrors();
Electrobun.events.on("open-url", (e: { data?: { url?: unknown } }) => {
  if (typeof e.data?.url === "string") handleDeepLink(e.data.url);
});
lockInternalRpc(internalRpcHandlers);

async function start(instance: Extract<Instance, { kind: "first" }>): Promise<void> {
  openStoreForThisBuild();
  startKeys();
  const win = await createWindow();
  if (!win) {
    instance.release();
    return;
  }
  driveForTests(win);
  startLife(win, instance.release);
  keepAlive();
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
      dir: Utils.paths.userData,
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
    console.error("Channels: the window couldn't start", e);
    instance.release();
    Utils.quit(1);
  }
}
