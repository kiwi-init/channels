import path from "node:path";
import { app, powerMonitor, protocol, session } from "electron";

import { keepDaemon } from "./bundled-daemon.ts";
import { handleDeepLink, JOIN_SCHEME, rememberDeepLink } from "./deep-links.ts";
import { APP_SCHEME, permissionAllowed } from "./guard.ts";
import { wireDaemonIpc } from "./ipc/daemon.ts";
import { wireGithubIpc } from "./ipc/github.ts";
import { wireMiscIpc } from "./ipc/misc.ts";
import { wirePairingIpc } from "./ipc/pairing.ts";
import { wireSignInIpc } from "./ipc/signin.ts";
import { wireStoreIpc } from "./ipc/store.ts";
import { wireVoiceIpc } from "./ipc/voice.ts";
import { wirePersonalitiesIpc } from "./ipc/personalities.ts";
import { wireLaunchIpc } from "./ipc/launch.ts";
import { wireTerminalsIpc } from "./ipc/terminals.ts";
import { closeKeys, keysOpen, startKeys, tellKeys } from "./keys-process.ts";
import { setAppMenu } from "./menu.ts";
import { catchMainErrors } from "./revive.ts";
import { serveWeb } from "./serve-web.ts";
import { loadStore, warnIfBroken } from "./store.ts";
import { startUpdates } from "./updater.ts";
import { createTray, createWindow, currentWindow, guardContents, isQuitting, markQuitting, refreshTray, showWindow, stepText } from "./window.ts";

function wireIpc(): void {
  wireStoreIpc();
  wireSignInIpc();
  wireGithubIpc();
  wirePairingIpc();
  wireDaemonIpc();
  wireMiscIpc();
  wireVoiceIpc();
  wirePersonalitiesIpc();
  wireTerminalsIpc();
  wireLaunchIpc();
}

catchMainErrors();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_e, argv) => {
    const link = argv.find((a) => a.startsWith(`${JOIN_SCHEME}://`));
    if (link) handleDeepLink(link);
    else showWindow();
  });
  app.on("open-url", (e, url) => (e.preventDefault(), handleDeepLink(url)));
  if (process.platform !== "darwin") {
    const link = process.argv.find((a) => a.startsWith(`${JOIN_SCHEME}://`));
    if (link) rememberDeepLink(link);
  }
  if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(JOIN_SCHEME, process.execPath, [path.resolve(process.argv[1] as string)]);

  app.on("web-contents-created", (_e, wc) => guardContents(wc));
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true } }]);
  void app.whenReady().then(async () => {
    serveWeb();
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      callback(permissionAllowed(wc.getURL(), permission));
    });
    wireIpc();
    setAppMenu(stepText);
    createWindow();
    loadStore();
    warnIfBroken();
    startKeys();
    createTray();
    startUpdates((u) => {
      currentWindow()?.webContents.send("kiwi:update", u);
      refreshTray();
    });
    app.on("activate", showWindow);
    powerMonitor.on("resume", () => tellKeys({ type: "nudge" }));
    powerMonitor.on("unlock-screen", () => tellKeys({ type: "nudge" }));
    void keepDaemon(isQuitting).catch(() => {});
  });

  app.on("window-all-closed", () => {});
  app.on("before-quit", (e) => {
    markQuitting();
    if (!keysOpen()) return;
    e.preventDefault();
    closeKeys(() => app.quit());
  });
}
