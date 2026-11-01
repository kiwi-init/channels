import { AccountError, moveAccount } from "@kiwi/core/account.ts";
import { sessionExpiry, tokenExpiry, WORKOS_TOKEN_URL, workosDeviceSignIn } from "@kiwi/core/workos.ts";
import type { SignInResult } from "./bridge.ts";
import { linkedHere } from "./github-flow.ts";
import { externalUrl, type ExternalUrl } from "./guard.ts";
import { held } from "./held.ts";
import { openInBrowser } from "./open.ts";
import { mutate, store, type StoreFile } from "./store.ts";

interface RelayConfig {
  workosClientId?: string | null;
  githubClientId?: string;
  githubSignIn?: boolean;
  dev?: boolean;
}

export const relayConfig = held(10 * 60_000, async (relay: string): Promise<RelayConfig> => {
  const res = await fetch(new URL("/v1/config", relay));
  if (!res.ok) throw new Error(`the relay returned ${res.status}`);
  return (await res.json()) as RelayConfig;
});

export async function signInMain(open: (url: ExternalUrl) => Promise<void>): Promise<SignInResult> {
  const config = await relayConfig(store.relayUrl);
  if (config.dev) return { dev: true };
  if (!config.workosClientId) throw new Error("this relay has no sign-in");
  const sess = await workosDeviceSignIn(config.workosClientId, async ({ url }) => {
    const verifyUrl = externalUrl(url);
    if (!verifyUrl) throw new Error("the relay's sign-in didn't start");
    await openInBrowser(verifyUrl, open);
  });
  mutate((s) => (s.signin = sess));
  return { token: sess.access };
}

/** Whether this relay takes GitHub sign-in: then the GitHub link is the sign-in. */
export const githubSignsIn = (config: RelayConfig): boolean => !!config.githubSignIn && !!config.githubClientId;

/** The GitHub link's token when it is this relay's sign-in, else null. */
export async function githubSignInToken(): Promise<string | null> {
  const link = store.github;
  if (!link || !linkedHere(link, store.relayUrl)) return null;
  const config = await relayConfig(store.relayUrl).catch(() => null);
  return config && githubSignsIn(config) && config.githubClientId === link.clientId ? link.token : null;
}

/** The token for creating a channel: the GitHub sign-in on a relay that takes it, else the WorkOS session. */
export async function createToken(): Promise<string | null> {
  return (await githubSignInToken()) ?? freshToken();
}

let refreshing: Promise<string | null> | null = null;

/**
 * The token for the account (devices, enrolling): the GitHub sign-in once the account moved to it,
 * else the WorkOS session, since an account made with it is kept under its user until it moves. The
 * GitHub sign-in also for a person whose key came after it on this computer: their github_<id>
 * account is their own. Anyone else without a session gets no token, and the account routes say to
 * sign in, rather than read an empty account.
 */
export async function freshToken(): Promise<string | null> {
  if (store.github?.moved) {
    const github = await githubSignInToken();
    if (github) return github;
  }
  const s = store.signin;
  if (!s) return store.github?.first ? githubSignInToken() : null;
  return workosToken(s);
}

function workosToken(s: NonNullable<StoreFile["signin"]>): Promise<string | null> {
  if (Date.now() < Math.min(s.exp, tokenExpiry(s.access) ?? s.exp) - 60_000) return Promise.resolve(s.access);
  refreshing ??= refreshToken(s).finally(() => (refreshing = null));
  return refreshing;
}

let moving: Promise<string | null> | null = null;
let refused: { id: number; why: string } | null = null;

export function moveToGithub(): Promise<string | null> {
  moving ??= moveOnce().finally(() => (moving = null));
  return moving;
}

async function moveOnce(): Promise<string | null> {
  const link = store.github;
  const s = store.signin;
  if (!s || !link || link.first || link.moved) return null;
  if (refused?.id === link.id) return refused.why;
  const github = await githubSignInToken();
  const signer = store.person ?? store.device;
  if (!github || !signer) return null;
  try {
    await moveAccount(store.relayUrl, async () => (await workosToken(s)) ?? "", github, `github_${link.id}`, signer);
  } catch (err) {
    if (!(err instanceof AccountError) || (err.status !== 403 && err.status !== 409)) return null;
    refused = { id: link.id, why: err.message };
    return err.message;
  }
  mutate((st) => {
    if (st.github?.id === link.id) st.github = { ...st.github, moved: true };
  });
  return null;
}

export const forgetMoveRefusal = (): void => {
  refused = null;
};

async function refreshToken(s: NonNullable<StoreFile["signin"]>): Promise<string | null> {
  try {
    const config = await relayConfig(store.relayUrl);
    if (!config.workosClientId) return s.access;
    const res = await fetch(WORKOS_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: s.refresh, client_id: config.workosClientId }),
    });
    if (!res.ok) throw new Error("refresh refused");
    const tok = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    const access = tok.access_token;
    if (!access) throw new Error("no token");
    if (store.signin !== s) return store.signin?.access ?? null;
    mutate((st) => (st.signin = { access, refresh: tok.refresh_token ?? s.refresh, exp: sessionExpiry(access, tok.expires_in) }));
    return store.signin?.access ?? null;
  } catch {
    return null;
  }
}
