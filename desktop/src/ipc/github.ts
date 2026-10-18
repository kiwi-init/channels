import { ipcMain, shell } from "electron";

import type { GithubStatus } from "../bridge.ts";
import { finishDevice, startDevice } from "../github-flow.ts";
import { openInBrowser } from "../open.ts";
import { relayConfig } from "../signin.ts";
import { mutate, store } from "../store.ts";
import { currentWindow } from "../window.ts";

async function status(): Promise<GithubStatus> {
  const link = store.github;
  const available = await relayConfig(store.relayUrl).then(
    (c) => !!c.githubClientId,
    () => false,
  );
  return { available, account: link ? { login: link.login, id: link.id, at: link.at } : null };
}

let linking: Promise<GithubStatus> | null = null;

async function link(): Promise<GithubStatus> {
  const clientId = (await relayConfig(store.relayUrl)).githubClientId;
  if (!clientId) throw new Error("this relay has no GitHub App");
  const start = await startDevice(clientId);
  currentWindow()?.webContents.send("kiwi:github-code", { code: start.userCode, url: start.url });
  await openInBrowser(start.url, (u) => shell.openExternal(u));
  const found = await finishDevice(clientId, start, { fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now });
  mutate((s) => (s.github = { ...found, at: Date.now() }));
  return status();
}

export function wireGithubIpc(): void {
  ipcMain.handle("kiwi:github-status", () => status());
  ipcMain.handle("kiwi:github-link", () => (linking ??= link().finally(() => (linking = null))));
  ipcMain.handle("kiwi:github-unlink", async () => {
    mutate((s) => (s.github = undefined));
    return status();
  });
}
