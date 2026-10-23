import type { GithubRepoView, GithubStatus } from "../bridge.ts";
import type { MemberPicture } from "@kiwi/core/protocol.ts";
import type { Serves } from "../calls.ts";

import { avatar, finishDevice, linkedHere, listRepos, startDevice } from "../github-flow.ts";
import { held } from "../held.ts";
import type { Host } from "../host.ts";
import { openInBrowser } from "../open.ts";
import { relayConfig } from "../signin.ts";
import { mutate, store } from "../store.ts";

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

async function link(host: Host): Promise<GithubStatus> {
  const relay = store.relayUrl;
  const clientId = (await relayConfig(relay)).githubClientId;
  if (!clientId) throw new Error("this relay has no GitHub App");
  const start = await startDevice(clientId);
  host.push("githubCode", { code: start.userCode, url: start.url });
  await openInBrowser(start.url, (u) => host.openExternal(u));
  const found = await finishDevice(clientId, start, { fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now });
  mutate((s) => (s.github = { ...found, at: Date.now(), relay, clientId }));
  return status();
}

export function githubCalls(host: Host): Serves<"githubStatus" | "githubLink" | "githubRepos" | "githubPicture" | "githubUnlink"> {
  return {
    githubStatus: () => status(),
    githubLink: () => (linking ??= link(host).finally(() => (linking = null))),
    githubRepos: (): Promise<GithubRepoView[]> => {
      const link = store.github;
      if (!link || !linkedHere(link, store.relayUrl)) return Promise.reject(new Error("link GitHub in Settings first"));
      return reposFor(link.token);
    },
    githubPicture: () => picture(),
    githubUnlink: async () => {
      mutate((s) => (s.github = undefined));
      return status();
    },
  };
}
