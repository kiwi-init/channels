import type { SignInResult } from "./bridge.ts";
import { externalUrl, type ExternalUrl } from "./guard.ts";
import { held } from "./held.ts";
import { openInBrowser } from "./open.ts";
import { mutate, store, type StoreFile } from "./store.ts";

const WORKOS_DEVICE_URL = "https://api.workos.com/user_management/authorize/device";
const WORKOS_TOKEN_URL = "https://api.workos.com/user_management/authenticate";

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

async function workosDeviceSignIn(clientId: string, open: (url: ExternalUrl) => Promise<void>): Promise<{ access: string; refresh: string; exp: number }> {
  const start = (await (
    await fetch(WORKOS_DEVICE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId, scope: "openid profile email offline_access" }),
    })
  ).json()) as { device_code?: string; user_code?: string; verification_uri?: string; verification_uri_complete?: string; expires_in?: number; interval?: number };
  if (!start.device_code) throw new Error("the relay's sign-in didn't start");
  const given = start.verification_uri_complete ?? (start.verification_uri ? `${start.verification_uri}?user_code=${encodeURIComponent(start.user_code ?? "")}` : null);
  const verifyUrl = given && URL.canParse(given) && new URL(given).protocol === "https:" ? externalUrl(given) : null;
  if (!verifyUrl) throw new Error("the relay's sign-in didn't start");
  await openInBrowser(verifyUrl, open);
  const until = Date.now() + (start.expires_in ?? 600) * 1000;
  for (;;) {
    await new Promise((r) => setTimeout(r, (start.interval ?? 5) * 1000));
    const res = await fetch(WORKOS_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: start.device_code, client_id: clientId }),
    });
    if (res.status === 400) {
      const err = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      if (err === "authorization_pending" || err === "slow_down") {
        if (Date.now() > until) throw new Error("sign-in timed out");
        continue;
      }
      throw new Error("sign-in was declined");
    }
    if (!res.ok) throw new Error(`sign-in failed (${res.status})`);
    const tok = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!tok.access_token || !tok.refresh_token) throw new Error("sign-in came back without a token");
    return { access: tok.access_token, refresh: tok.refresh_token, exp: Date.now() + (tok.expires_in ?? 3600) * 1000 };
  }
}

export async function signInMain(open: (url: ExternalUrl) => Promise<void>): Promise<SignInResult> {
  const config = await relayConfig(store.relayUrl);
  if (config.dev) return { dev: true };
  if (!config.workosClientId) throw new Error("this relay has no sign-in");
  const sess = await workosDeviceSignIn(config.workosClientId, open);
  mutate((s) => (s.signin = sess));
  return { token: sess.access };
}

let refreshing: Promise<string | null> | null = null;

export async function freshToken(): Promise<string | null> {
  const s = store.signin;
  if (!s) return null;
  if (Date.now() < s.exp - 60_000) return s.access;
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
    if (!tok.access_token) throw new Error("no token");
    if (store.signin !== s) return store.signin?.access ?? null;
    mutate((st) => (st.signin = { access: tok.access_token as string, refresh: tok.refresh_token ?? s.refresh, exp: Date.now() + (tok.expires_in ?? 3600) * 1000 }));
    return store.signin?.access ?? null;
  } catch {
    return null;
  }
}
