// The context-isolated face of main.ts: exposes window.kiwi and nothing else.
// The snapshot is synchronous (main decrypted once at startup), everything else
// is invoke/on. The relay is main's, from the snapshot: never the page's URL,
// which anything that can make the app load a URL could choose (and the token
// getToken hands out would go to it).

import { contextBridge, ipcRenderer } from "electron";

import type { PersonClaim } from "../../src/person.ts";
import type { ChannelIdentityView, ComputerView, DaemonStatus, KiwiBridge, PairAskView, PendingItem, PublicPerson, SignInResult, StoreSnapshot, UpdateView } from "./bridge.ts";

const relayUrl = (ipcRenderer.sendSync("kiwi:snapshot-sync") as StoreSnapshot).relayUrl;

const on = (channel: "kiwi:store" | "kiwi:deep-link" | "kiwi:update", cb: (v: never) => void): (() => void) => {
  const fn = (_e: unknown, v: never) => cb(v);
  ipcRenderer.on(channel, fn as (...args: unknown[]) => void);
  return () => ipcRenderer.removeListener(channel, fn as (...args: unknown[]) => void);
};

const kiwi: KiwiBridge = {
  relayUrl,
  getSnapshot: () => ipcRenderer.sendSync("kiwi:snapshot-sync") as StoreSnapshot,
  onStore: (cb) => on("kiwi:store", cb),
  setRelayUrl: (url: string) => ipcRenderer.invoke("kiwi:set-relay-url", url) as Promise<string>,
  createPerson: (name: string) => ipcRenderer.invoke("kiwi:create-person", name) as Promise<PublicPerson>,
  provePerson: (code: string, memberPk: string) => ipcRenderer.invoke("kiwi:prove-person", code, memberPk) as Promise<PersonClaim>,
  saveChannels: (channels: ChannelIdentityView[]) => ipcRenderer.invoke("kiwi:save-channels", channels) as Promise<void>,
  saveComputers: (computers: ComputerView[]) => ipcRenderer.invoke("kiwi:save-computers", computers) as Promise<void>,
  setPending: (pending: PendingItem[]) => ipcRenderer.invoke("kiwi:set-pending", pending) as Promise<void>,
  signIn: () => ipcRenderer.invoke("kiwi:sign-in") as Promise<SignInResult>,
  devSignIn: (name: string) => ipcRenderer.invoke("kiwi:dev-sign-in", name) as Promise<{ token: string }>,
  getToken: () => ipcRenderer.invoke("kiwi:token") as Promise<string | null>,
  signOut: () => ipcRenderer.invoke("kiwi:sign-out") as Promise<void>,
  pairBegin: () => ipcRenderer.invoke("kiwi:pair-begin") as Promise<{ code: string }>,
  pairPoll: () => ipcRenderer.invoke("kiwi:pair-poll") as Promise<PairAskView | null>,
  pairCancel: () => ipcRenderer.invoke("kiwi:pair-cancel") as Promise<void>,
  pairAnswer: (accept: boolean) => ipcRenderer.invoke("kiwi:pair-answer", accept) as Promise<{ machinePk: string } | null>,
  daemonStatus: () => ipcRenderer.invoke("kiwi:daemon-status") as Promise<DaemonStatus>,
  daemonAdopt: () => ipcRenderer.invoke("kiwi:daemon-adopt") as Promise<ComputerView>,
  installCli: () => ipcRenderer.invoke("kiwi:install-cli") as Promise<{ path: string }>,
  getUpdate: () => ipcRenderer.invoke("kiwi:update-state") as Promise<UpdateView | null>,
  onUpdate: (cb) => on("kiwi:update", cb),
  installUpdate: () => ipcRenderer.invoke("kiwi:update-install") as Promise<void>,
  notify: (title: string, body: string) => ipcRenderer.invoke("kiwi:notify", title, body) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke("kiwi:open-external", url) as Promise<void>,
  getDeepLink: () => ipcRenderer.invoke("kiwi:deep-link") as Promise<string | null>,
  onDeepLink: (cb) => on("kiwi:deep-link", cb),
};

contextBridge.exposeInMainWorld("kiwi", kiwi);
