import { pollToken, startDevice, type DeviceStart, type PollDeps } from "@kiwi/core/github-device.ts";
import { isRasterMime, wellFormedPicture, type MemberPicture } from "@kiwi/core/protocol.ts";

import type { GithubRepoView } from "./bridge.ts";

const USER_URL = "https://api.github.com/user";

export { startDevice, type DeviceStart };

export interface GithubAccount {
  login: string;
  id: number;
  token: string;
}

export type FlowDeps = Omit<PollDeps, "fetch"> & { fetch: typeof fetch };

export async function finishDevice(clientId: string, start: DeviceStart, deps: FlowDeps): Promise<GithubAccount> {
  return account(await pollToken(clientId, start, deps), deps.fetch);
}

async function account(token: string, f: typeof fetch): Promise<GithubAccount> {
  const res = await f(USER_URL, { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": "channels-desktop" } });
  const body = (await res.json().catch(() => ({}))) as { login?: string; id?: number };
  if (!res.ok || typeof body.login !== "string" || typeof body.id !== "number") throw new Error("GitHub didn’t say who this is");
  return { login: body.login, id: body.id, token };
}

const REPOS_URL = "https://api.github.com/user/repos";
const REPO_PAGES = 5;

/** The repos the linked account can reach through the App, most recently pushed first: at most 500. */
export interface GithubLinkFor {
  token: string;
  relay?: string;
  clientId?: string;
}

export function linkedHere(link: GithubLinkFor | null | undefined, relay: string): boolean {
  return !!link?.token && !!link.clientId && link.relay === relay;
}

export async function tokenForRelay(relay: string, link: GithubLinkFor | null | undefined, f: typeof fetch = fetch): Promise<string | null> {
  if (!link || !linkedHere(link, relay)) return null;
  const config = await f(new URL("/v1/config", relay)).then(
    (res) => (res.ok ? (res.json() as Promise<{ githubClientId?: unknown }>) : null),
    () => null,
  );
  return config?.githubClientId === link.clientId ? link.token : null;
}

export async function listRepos(token: string, f: typeof fetch = fetch): Promise<GithubRepoView[]> {
  const out: GithubRepoView[] = [];
  for (let page = 1; page <= REPO_PAGES; page++) {
    const res = await f(`${REPOS_URL}?per_page=100&sort=pushed&page=${page}`, {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": "channels-desktop" },
    });
    if (res.status === 401) throw new Error("the GitHub link has expired: link it again in Settings");
    if (!res.ok) throw new Error("GitHub didn’t list the repos");
    const body = (await res.json().catch(() => null)) as unknown;
    if (!Array.isArray(body)) throw new Error("GitHub didn’t list the repos");
    for (const r of body as { full_name?: unknown; private?: unknown; pushed_at?: unknown }[]) {
      if (typeof r.full_name !== "string") continue;
      out.push({ fullName: r.full_name, private: r.private === true, pushedAt: typeof r.pushed_at === "string" ? Date.parse(r.pushed_at) || 0 : 0 });
    }
    if (body.length < 100) break;
  }
  return out;
}

const AVATAR_SIZES = [96, 64, 48, 32];

/** The account's GitHub avatar as a small picture the person can publish: fetched here, so no page loads from GitHub. */
export async function avatar(id: number, f: typeof fetch = fetch): Promise<MemberPicture | null> {
  for (const size of AVATAR_SIZES) {
    const res = await f(`https://avatars.githubusercontent.com/u/${id}?s=${size}&v=4`, { headers: { "user-agent": "channels-desktop" } });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    const bytes = new Uint8Array(await res.arrayBuffer());
    const picture = { mime, data: Buffer.from(bytes).toString("base64") };
    if (wellFormedPicture(picture)) return picture;
    if (!isRasterMime(mime)) return null;
  }
  return null;
}
