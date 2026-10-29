import { sessionExpiry, tokenExpiry, WORKOS_TOKEN_URL, workosDeviceSignIn } from "@kiwi/core/workos.ts";
import type { SignInResult } from "./bridge.ts";
import { externalUrl, type ExternalUrl } from "./guard.ts";
import { held } from "./held.ts";
import { openInBrowser } from "./open.ts";
import { mutate, store, type StoreFile } from "./store.ts";

interface RelayConfig {
  workosClientId?: string | null;
  githubClientId?: string;
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

let refreshing: Promise<string | null> | null = null;

export async function freshToken(): Promise<string | null> {
  const s = store.signin;
  if (!s) return null;
  if (Date.now() < Math.min(s.exp, tokenExpiry(s.access) ?? s.exp) - 60_000) return s.access;
  refreshing ??= refreshToken(s).finally(() => (refreshing = null));
  return refreshing;
}

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
