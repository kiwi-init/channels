import type { GithubRepoView, GithubStatus } from "../bridge.ts";
import type { MemberPicture } from "@kiwi/core/protocol.ts";
import type { Pushes, Serves } from "../calls.ts";

import { avatar, finishDevice, linkedHere, listRepos, startDevice, type GithubAccount } from "../github-flow.ts";
import { externalUrl } from "../guard.ts";
import { held } from "../held.ts";
import type { Host } from "../host.ts";
import { openInBrowser } from "../open.ts";
import { forgetMoveRefusal, githubSignsIn, moveToGithub, relayConfig } from "../signin.ts";
import { mutate, store, type StoreFile } from "../store.ts";

async function status(): Promise<GithubStatus> {
  const link = linkedHere(store.github, store.relayUrl) ? store.github : undefined;
  const config = await relayConfig(store.relayUrl).catch(() => null);
  const signIn = !!config && githubSignsIn(config);
  const refused = signIn && link ? await moveToGithub() : null;
  return {
    available: !!config?.githubClientId,
    ...(signIn ? { signIn: true } : {}),
    account: link ? { login: link.login, id: link.id, at: link.at } : null,
    ...(refused ? { moveRefused: refused } : {}),
  };
}

/**
 * A new link, remembering whether GitHub sign-in came before the person key on this computer
 * (first): only then is the relay account under github_<id> this person's own. A person who had a
 * key before keeps their account where it is until it moves, and a link made again for the same
 * GitHub account keeps what the first one knew.
 */
export function linkRecord(s: Pick<StoreFile, "person" | "github">, found: GithubAccount, relay: string, clientId: string, at: number): NonNullable<StoreFile["github"]> {
  const same = s.github?.id === found.id;
  const first = same ? s.github?.first === true : !s.person;
  return { ...found, at, relay, clientId, ...(first ? { first: true } : {}), ...(same && s.github?.moved ? { moved: true } : {}) };
}

let linking: Promise<GithubStatus> | null = null;
let pending: Pushes["githubCode"] | null = null;
const reposFor = held(5 * 60_000, (token: string) => listRepos(token));
let face: { id: number; picture: Promise<MemberPicture | null> } | null = null;

function picture(): Promise<MemberPicture | null> {
  const id = store.github?.id;
  if (id === undefined) return Promise.resolve(null);
  if (face?.id !== id) {
    const asked = { id, picture: avatar(id).catch(() => null) };
    face = asked;
    void asked.picture.then((p) => {
      if (!p && face === asked) face = null;
    });
  }
  return face.picture;
}

async function link(host: Host): Promise<GithubStatus> {
  const relay = store.relayUrl;
  const clientId = (await relayConfig(relay)).githubClientId;
  if (!clientId) throw new Error("this relay has no GitHub App");
  const start = await startDevice(clientId);
  const page = externalUrl(start.url);
  if (!page) throw new Error("GitHub sent a sign-in page that isn't a web link");
  pending = { code: start.userCode, url: start.url };
  host.push("githubCode", pending);
  await openInBrowser(page, (u) => host.openExternal(u));
  const found = await finishDevice(clientId, start, { fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now });
  mutate((s) => (s.github = linkRecord(s, found, relay, clientId, Date.now())));
  forgetMoveRefusal();
  return status();
}

function linkOnce(host: Host): Promise<GithubStatus> {
  if (linking) {
    if (pending) host.push("githubCode", pending);
    return linking;
  }
  linking = link(host).finally(() => {
    linking = null;
    pending = null;
  });
  return linking;
}

/** Signing in on a relay that takes GitHub: the same device flow as the link, which it also is. */
export async function signInWithGithub(host: Host): Promise<string> {
  await linkOnce(host);
  const token = store.github?.token;
  if (!token) throw new Error("GitHub didn't sign you in");
  return token;
}

export function githubCalls(host: Host): Serves<"githubStatus" | "githubLink" | "githubRepos" | "githubPicture" | "githubUnlink"> {
  return {
    githubStatus: () => status(),
    githubLink: () => linkOnce(host),
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
