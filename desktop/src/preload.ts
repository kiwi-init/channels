import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { KeysPort, KeysPush, KeysReply, KeysRequest, StoreSnapshot } from "./bridge.ts";
import { makeBridge, type Call, type CallArgs, type CallValue, type Push, type Pushes } from "./calls.ts";

const snapshot = ipcRenderer.sendSync("kiwi:snapshot-sync") as StoreSnapshot;

let port: MessagePort | null = null;
let nextAsk = 1;
const waiting = new Map<number, (r: KeysReply) => void>();
const queued: KeysRequest[] = [];
const pushes = new Set<(p: KeysPush) => void>();
const restarts = new Set<() => void>();

ipcRenderer.on("kiwi:channels-port", (e) => {
  const fresh = e.ports[0];
  if (!fresh) return;
  const restarted = port !== null;
  port?.close();
  if (restarted) {
    for (const [id, done] of waiting) done({ id, ok: false, error: { kind: "unreachable", message: "Channels restarted the part that holds your keys; try again" } });
    waiting.clear();
  }
  port = fresh;
  port.onmessage = (ev: MessageEvent<KeysReply | KeysPush>) => {
    const d = ev.data;
    if ("sub" in d) {
      for (const cb of pushes) cb(d);
      return;
    }
    waiting.get(d.id)?.(d);
    waiting.delete(d.id);
  };
  for (const q of queued.splice(0)) port.postMessage(q);
  if (restarted) for (const cb of restarts) cb();
});
ipcRenderer.send("kiwi:channels-connect");

const channels: KeysPort = {
  request: (ask) =>
    new Promise<KeysReply>((resolve) => {
      const req = { ...ask, id: nextAsk++ } as KeysRequest;
      waiting.set(req.id, resolve);
      if (port) port.postMessage(req);
      else queued.push(req);
    }),
  onPush: (cb) => {
    pushes.add(cb);
    return () => void pushes.delete(cb);
  },
  onRestart: (cb) => {
    restarts.add(cb);
    return () => void restarts.delete(cb);
  },
};

function call<K extends Call>(name: K, ...args: CallArgs<K>): Promise<CallValue<K>> {
  return ipcRenderer.invoke(`kiwi:${name}`, ...args) as Promise<CallValue<K>>;
}

function listen<P extends Push>(name: P, cb: (value: Pushes[P]) => void): () => void {
  const fn = (_e: IpcRendererEvent, value: Pushes[P]) => cb(value);
  ipcRenderer.on(`kiwi:${name}`, fn);
  return () => ipcRenderer.removeListener(`kiwi:${name}`, fn);
}

contextBridge.exposeInMainWorld("kiwi", makeBridge({ snapshot, channels, call, listen }));
