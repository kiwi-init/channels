import path from "node:path";
import { app, MessageChannelMain, utilityProcess } from "electron";

import type { PersonClaim } from "@kiwi/core/person.ts";
import { acceptSeat, claimFor, withAccess } from "./guard.ts";
import type { HostToKeys, KeysToHost } from "./keys-server.ts";
import { mutate, requirePerson, store } from "./store.ts";
import { currentWindow, isQuitting } from "./window.ts";

let keys: Electron.UtilityProcess | null = null;
let keysWait = 1_000;
let keysFlushed: (() => void) | null = null;
let keysClosed = false;

export const keysOpen = (): boolean => !keysClosed && !!keys;

export function closeKeys(then: () => void): void {
  const child = keys;
  if (!child) return then();
  const finish = () => {
    keysFlushed = null;
    clearTimeout(timer);
    keysClosed = true;
    child.kill();
    then();
  };
  const timer = setTimeout(finish, 1_000);
  keysFlushed = finish;
  child.postMessage({ type: "flush" } satisfies HostToKeys);
}

const channelsPath = () => (app.isPackaged ? path.join(app.getAppPath(), "dist", "channels.js") : path.join(__dirname, "..", "dist", "channels.js"));

export function tellKeys(m: HostToKeys, ports: Electron.MessagePortMain[] = []): void {
  keys?.postMessage(m, ports);
}

export function connectKeys(wc: Electron.WebContents): void {
  if (!keys || wc.isDestroyed()) return;
  const { port1, port2 } = new MessageChannelMain();
  tellKeys({ type: "port" }, [port1]);
  wc.postMessage("kiwi:channels-port", null, [port2]);
}

export function startKeys(): void {
  const child = utilityProcess.fork(channelsPath(), [], { serviceName: "Channels keys" });
  const started = Date.now();
  keys = child;
  tellKeys({ type: "init", relay: store.relayUrl, dir: app.getPath("userData"), seats: store.channels, person: store.person?.pk ?? null });
  child.on("message", (m: KeysToHost) => onKeys(child, m));
  child.on("exit", () => {
    if (keys === child) keys = null;
    if (isQuitting()) return;
    keysWait = Date.now() - started > 60_000 ? 1_000 : Math.min(keysWait * 2, 30_000);
    setTimeout(startKeys, keysWait);
  });
  const win = currentWindow();
  if (win && !win.isDestroyed()) connectKeys(win.webContents);
}

function onKeys(child: Electron.UtilityProcess, m: KeysToHost): void {
  if (m.type === "flushed") {
    keysFlushed?.();
    return;
  }
  const done = (extra: { error?: string; claim?: PersonClaim | null; token?: string | null } = {}) => {
    if (keys === child) child.postMessage({ type: "done", id: m.id, ...extra } satisfies HostToKeys);
  };
  const fail = (e: unknown) => done({ error: e instanceof Error ? e.message : String(e) });
  try {
    switch (m.type) {
      case "save":
        mutate((s) => (s.channels = acceptSeat(s.channels, m.entry)));
        return done();
      case "access":
        mutate((s) => (s.channels = withAccess(s.channels, m.code, m.pk, m.access)));
        return done();
      case "forget":
        mutate((s) => (s.channels = s.channels.filter((c) => c.code !== m.code)));
        return done();
      case "githubToken":
        return done({ token: store.github?.token ?? null });
      case "prove":
        if (!store.person) return done({ claim: null });
        void claimFor(requirePerson(), m.code, m.memberPk).then((claim) => done({ claim }), fail);
        return;
    }
  } catch (e) {
    fail(e);
  }
}
