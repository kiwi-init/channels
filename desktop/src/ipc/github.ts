import { ipcMain, shell } from "electron";

import type { GithubRepoView, GithubStatus } from "../bridge.ts";
import type { MemberPicture } from "@kiwi/core/protocol.ts";

import { avatar, finishDevice, linkedHere, listRepos, startDevice } from "../github-flow.ts";
import { held } from "../held.ts";
import { openInBrowser } from "../open.ts";
import { relayConfig } from "../signin.ts";
import { mutate, store } from "../store.ts";
import { currentWindow } from "../window.ts";

async function status(): Promise<GithubStatus> {
  const link = linkedHere(store.github, store.relayUrl) ? store.github : undefined;
  const available = await relayConfig(store.relayUrl).then(
    (c) => !!c.githubClientId,
    () => false,
  );
  return { available, account: link ? { login: link.login, id: link.id, at: link.at } : null };
}

let linking: Promise<GithubStatus> | null = null;
const reposFor = held(5 * 60_000, (token: string) => listRepos(token));
let face: { id: number; picture: Promise<MemberPicture | null> } | null = null;

function picture(): Promise<MemberPicture | null> {
  const id = store.github?.id;
  if (id === undefined) return Promise.resolve(null);
  if (face?.id !== id) face = { id, picture: avatar(id).catch(() => null) };
  return face.picture;
}

async function link(): Promise<GithubStatus> {
  const relay = store.relayUrl;
  const clientId = (await relayConfig(relay)).githubClientId;
  if (!clientId) throw new Error("this relay has no GitHub App");
  const start = await startDevice(clientId);
  currentWindow()?.webContents.send("kiwi:github-code", { code: start.userCode, url: start.url });
  await openInBrowser(start.url, (u) => shell.openExternal(u));
  const found = await finishDevice(clientId, start, { fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now });
  mutate((s) => (s.github = { ...found, at: Date.now(), relay, clientId }));
  return status();
}

export function wireGithubIpc(): void {
  ipcMain.handle("kiwi:github-status", () => status());
  ipcMain.handle("kiwi:github-link", () => (linking ??= link().finally(() => (linking = null))));
  ipcMain.handle("kiwi:github-repos", (): Promise<GithubRepoView[]> => {
    const link = store.github;
    if (!link || !linkedHere(link, store.relayUrl)) return Promise.reject(new Error("link GitHub in Settings first"));
    return reposFor(link.token);
  });
  ipcMain.handle("kiwi:github-picture", () => picture());
  ipcMain.handle("kiwi:github-unlink", async () => {
    mutate((s) => (s.github = undefined));
    return status();
  });
}
