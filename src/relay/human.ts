// Human sign-in at the relay: GitHub user tokens from the relay's GitHub App, or dev sign-in
// for tests and local development.
//
// When a relay has sign-in, creating a channel and reaching the person's account (their device
// list, enrolling a device) need a signed-in human; every owner action after creation is the
// owner key's signature alone. A GitHub token is taken only when GitHub says this relay's GitHub
// App issued it, and the person is github_<id>.
//
// The relay runs with sign-in as a service, Human: GitHub, dev sign-in, or none (null),
// whichever its adapter provides. The verifiers below stay plain async code: the routes call
// verify through Effect.promise, and names through profileOf.

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface HumanAuth {
  /** The signed-in person's id if the token is valid, else null. */
  verify(token: string): Promise<string | null>;
  /** The person's name (and GitHub login), so the relay can vouch for "on behalf of whom". */
  profile?(userId: string): Promise<HumanProfile | null>;
  /** Development sign-in (devHumanAuth): anyone is whoever they say. Never on a reachable relay. */
  dev?: boolean;
}

/** Sign-in as this relay runs it: GitHub, dev sign-in, or null for none. */
export class Human extends Context.Service<Human, HumanAuth | null>()("kiwi/relay/HumanAuth") {}

/** A user's name and email as sign-in knows them, or null: a failed lookup never fails the request. */
export const profileOf = (user: string) =>
  Effect.flatMap(Human, (human) => (human?.profile ? Effect.promise(async () => (await human.profile!(user).catch(() => null)) ?? null) : Effect.succeed(null)));

/** The tokens dev sign-in takes: "dev:<name>" (letters, digits, _ and -). */
const DEV_TOKEN = /^dev:([A-Za-z0-9_-]{1,64})$/;

/**
 * Sign-in for testing on your own machine: the token "dev:alice" signs in as
 * the person "dev_alice" (never a real github_<id>), no password. So agents can run
 * owner and reclaim flows end to end on a local relay. The Bun relay only
 * starts it bound to loopback (devHostOk) and only takes it on requests made
 * from this machine directly (devRequestOk).
 */
export function devHumanAuth(): HumanAuth {
  return {
    dev: true,
    verify: async (token) => {
      const name = DEV_TOKEN.exec(token)?.[1];
      return name ? `dev_${name}` : null;
    },
    profile: async (user) => {
      const name = user.replace(/^dev_/, "");
      return { name: `${name.charAt(0).toUpperCase()}${name.slice(1)} (dev)`, email: `${name}@dev.invalid` };
    },
  };
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "::ffff:127.0.0.1"]);

/** Dev sign-in only bound where nothing but this machine can reach it. */
export function devHostOk(hostname: string | undefined): boolean {
  return !!hostname && LOOPBACK.has(hostname);
}

/**
 * Binding to loopback isn't enough: a reverse proxy on the same machine (the
 * setup our self-hosting guide describes) forwards the internet to it. So each
 * request must come from this machine, to a local host name, and not through a
 * proxy.
 */
export function devRequestOk(req: Request, peer: string | undefined): boolean {
  if (!peer || !LOOPBACK.has(peer)) return false;
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (!LOOPBACK.has(host)) return false;
  return !["forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip", "via", "cf-connecting-ip"].some((h) => req.headers.has(h));
}

interface HumanProfile {
  name: string;
  email?: string;
  /** The GitHub login, for a person signed in with GitHub. */
  login?: string;
}

const enc = new TextEncoder();

/** A GitHub user token: a GitHub App's (ghu_) or an OAuth app's (gho_). */
const GITHUB_TOKEN = /^gh[uo]_[A-Za-z0-9_]{20,255}$/;
const GITHUB_SEEN_MS = 5 * 60_000;
const GITHUB_SEEN_MAX = 1000;

export interface GithubSignInSettings {
  /** The relay's GitHub App client id, the one the apps sign in through. */
  clientId?: string;
  /** Its client secret: without it the relay can't tell this app's tokens from any other app's, so it takes none. */
  clientSecret?: string;
}

interface GithubUser {
  id: number;
  login: string;
  name?: string | null;
  email?: string | null;
}

const sha256 = async (s: string): Promise<string> => b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

/**
 * GitHub sign-in: a user token is taken only when GitHub says this relay's GitHub App issued
 * it (the check-token API, which needs the app's client secret). The person is github_<id>:
 * the numeric id, which outlives a renamed login. A token seen in the last five minutes isn't
 * asked about again.
 */
export function githubHumanAuth(s: GithubSignInSettings, f: typeof fetch = fetch): HumanAuth | null {
  if (!s.clientId || !s.clientSecret) return null;
  const basic = `Basic ${btoa(`${s.clientId}:${s.clientSecret}`)}`;
  const seen = new Map<string, { user: string; until: number }>();
  const profiles = new Map<string, HumanProfile>();
  return {
    async verify(token: string): Promise<string | null> {
      if (!GITHUB_TOKEN.test(token)) return null;
      const key = await sha256(token);
      const hit = seen.get(key);
      if (hit && hit.until > Date.now()) return hit.user;
      seen.delete(key);
      try {
        const res = await f(`https://api.github.com/applications/${s.clientId}/token`, {
          method: "POST",
          headers: { authorization: basic, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "kiwi-relay", "content-type": "application/json" },
          body: JSON.stringify({ access_token: token }),
        });
        if (!res.ok) return null;
        const u = ((await res.json()) as { user?: GithubUser }).user;
        if (!u || !Number.isInteger(u.id) || typeof u.login !== "string") return null;
        const user = `github_${u.id}`;
        if (seen.size >= GITHUB_SEEN_MAX) seen.delete(seen.keys().next().value!);
        seen.set(key, { user, until: Date.now() + GITHUB_SEEN_MS });
        profiles.set(user, { name: u.name || u.login, login: u.login, ...(u.email ? { email: u.email } : {}) });
        return user;
      } catch {
        // GitHub unreachable: the sign-in can't be checked, so it isn't taken.
        return null;
      }
    },
    profile: async (user) => profiles.get(user) ?? null,
  };
}

/** The human's token travels in its own header, alongside the member-key signature. */
export const HUMAN_HEADER = "x-human-token";
