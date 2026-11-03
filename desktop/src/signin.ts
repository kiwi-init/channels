import { linkedHere } from "./github-flow.ts";
import { held } from "./held.ts";
import { store } from "./store.ts";

interface RelayConfig {
  githubClientId?: string;
  githubSignIn?: boolean;
  dev?: boolean;
}

export const relayConfig = held(10 * 60_000, async (relay: string): Promise<RelayConfig> => {
  const res = await fetch(new URL("/v1/config", relay));
  if (!res.ok) throw new Error(`the relay returned ${res.status}`);
  return (await res.json()) as RelayConfig;
});

/** Whether this relay takes GitHub sign-in: then the GitHub link is the sign-in. */
export const githubSignsIn = (config: RelayConfig): boolean => !!config.githubSignIn && !!config.githubClientId;

/** The GitHub link's token when it is this relay's sign-in, else null. */
export async function githubSignInToken(): Promise<string | null> {
  const link = store.github;
  if (!link || !linkedHere(link, store.relayUrl)) return null;
  const config = await relayConfig(store.relayUrl).catch(() => null);
  return config && githubSignsIn(config) && config.githubClientId === link.clientId ? link.token : null;
}

/**
 * The token for creating a channel and for the account (devices, enrolling): the GitHub sign-in on a
 * relay that takes it, else the name a dev relay signed in with. Without either there is no token,
 * and the relay's routes say to sign in.
 */
export async function signInToken(): Promise<string | null> {
  if ((await relayConfig(store.relayUrl).catch(() => null))?.dev) return store.signin?.access ?? null;
  return githubSignInToken();
}
