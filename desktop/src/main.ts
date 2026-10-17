import path from "node:path";
import { app, protocol, session } from "electron";

import { keepDaemon } from "./bundled-daemon.ts";
import { handleDeepLink, JOIN_SCHEME, rememberDeepLink } from "./deep-links.ts";
import { APP_SCHEME, mediaAllowed } from "./guard.ts";
import { wireDaemonIpc } from "./ipc/daemon.ts";
import { wireMiscIpc } from "./ipc/misc.ts";
import { wirePairingIpc } from "./ipc/pairing.ts";
import { wireSignInIpc } from "./ipc/signin.ts";
import { wireStoreIpc } from "./ipc/store.ts";
import { wireVoiceIpc } from "./ipc/voice.ts";
import { closeKeys, keysOpen, startKeys } from "./keys-process.ts";
import { serveWeb } from "./serve-web.ts";
import { loadStore, warnIfBroken } from "./store.ts";
import { startUpdates } from "./updater.ts";
import { createTray, createWindow, currentWindow, guardContents, markQuitting, refreshTray, showWindow } from "./window.ts";

function wireIpc(): void {
  wireStoreIpc();
  wireSignInIpc();
  wirePairingIpc();
  wireDaemonIpc();
  wireMiscIpc();
  wireVoiceIpc();
}

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
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
  void app.whenReady().then(async () => {
    loadStore();
    warnIfBroken();
    serveWeb();
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      callback(mediaAllowed(wc.getURL(), permission));
    });
    wireIpc();
    startKeys();
    createWindow();
    createTray();
    startUpdates((u) => {
      currentWindow()?.webContents.send("kiwi:update", u);
      refreshTray();
    });
    app.on("activate", showWindow);
    void keepDaemon().catch(() => {});
  });

  app.on("window-all-closed", () => {});
  app.on("before-quit", (e) => {
    markQuitting();
    if (!keysOpen()) return;
    e.preventDefault();
    closeKeys(() => app.quit());
  });
}
