// The context-isolated face of main.ts: exposes window.kiwi and nothing else.
// The snapshot is synchronous (main decrypted once at startup), everything else
// is invoke/on. The relay is main's, from the snapshot: never the page's URL,
// which anything that can make the app load a URL could choose (and the token
// getToken hands out would go to it).

import { contextBridge, ipcRenderer } from "electron";
import type { Personality } from "@kiwi/core/personality.ts";

import type {
  ChannelIdentityView,
  ChannelView,
  ComputerView,
  DaemonStatus,
  KeysPort,
  KeysPush,
  KeysReply,
  KeysRequest,
  KiwiBridge,
  PairAskView,
  PendingItem,
  PublicPerson,
  SignInResult,
  GithubRepoView,
  GithubStatus,
  StoreSnapshot,
  UpdateCheckView,
  UpdateView,
  VoiceAuth,
} from "./bridge.ts";

const relayUrl = (ipcRenderer.sendSync("kiwi:snapshot-sync") as StoreSnapshot).relayUrl;

const on = (channel: "kiwi:store" | "kiwi:deep-link" | "kiwi:update" | "kiwi:github-code", cb: (v: never) => void): (() => void) => {
  const fn = (_e: unknown, v: never) => cb(v);
  ipcRenderer.on(channel, fn as (...args: unknown[]) => void);
  return () => ipcRenderer.removeListener(channel, fn as (...args: unknown[]) => void);
};

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

const kiwi: KiwiBridge = {
  relayUrl,
  getSnapshot: () => ipcRenderer.sendSync("kiwi:snapshot-sync") as StoreSnapshot,
  onStore: (cb) => on("kiwi:store", cb),
  setRelayUrl: (url: string) => ipcRenderer.invoke("kiwi:set-relay-url", url) as Promise<string>,
  createPerson: (name: string) => ipcRenderer.invoke("kiwi:create-person", name) as Promise<PublicPerson>,
  saveChannels: (list: ChannelView[]) => ipcRenderer.invoke("kiwi:save-channels", list) as Promise<void>,
  migrateChannels: (entries: ChannelIdentityView[]) => ipcRenderer.invoke("kiwi:migrate-channels", entries) as Promise<number>,
  channels,
  saveComputers: (computers: ComputerView[]) => ipcRenderer.invoke("kiwi:save-computers", computers) as Promise<void>,
  setPending: (pending: PendingItem[]) => ipcRenderer.invoke("kiwi:set-pending", pending) as Promise<void>,
  signIn: () => ipcRenderer.invoke("kiwi:sign-in") as Promise<SignInResult>,
  devSignIn: (name: string) => ipcRenderer.invoke("kiwi:dev-sign-in", name) as Promise<{ token: string }>,
  getToken: () => ipcRenderer.invoke("kiwi:token") as Promise<string | null>,
  signOut: () => ipcRenderer.invoke("kiwi:sign-out") as Promise<void>,
  githubStatus: () => ipcRenderer.invoke("kiwi:github-status") as Promise<GithubStatus>,
  githubLink: () => ipcRenderer.invoke("kiwi:github-link") as Promise<GithubStatus>,
  githubUnlink: () => ipcRenderer.invoke("kiwi:github-unlink") as Promise<GithubStatus>,
  githubRepos: () => ipcRenderer.invoke("kiwi:github-repos") as Promise<GithubRepoView[]>,
  onGithubCode: (cb) => on("kiwi:github-code", cb),
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
  checkUpdate: () => ipcRenderer.invoke("kiwi:update-check") as Promise<UpdateCheckView>,
  notify: (title: string, body: string) => ipcRenderer.invoke("kiwi:notify", title, body) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke("kiwi:open-external", url) as Promise<void>,
  getDeepLink: () => ipcRenderer.invoke("kiwi:deep-link") as Promise<string | null>,
  onDeepLink: (cb) => on("kiwi:deep-link", cb),
  setVoiceKey: (key: string) => ipcRenderer.invoke("kiwi:voice-set-key", key) as Promise<void>,
  setVoiceConsent: (roomId: string, on: boolean) => ipcRenderer.invoke("kiwi:voice-set-consent", roomId, on) as Promise<void>,
  voiceToken: (roomId: string) => ipcRenderer.invoke("kiwi:voice-token", roomId) as Promise<VoiceAuth>,
  setPersonalities: (list: Personality[]) => ipcRenderer.invoke("kiwi:personalities-set", list) as Promise<void>,
};

contextBridge.exposeInMainWorld("kiwi", kiwi);
