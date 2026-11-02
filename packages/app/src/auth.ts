// Sign-in: on a relay that takes GitHub sign-in, the desktop app signs in with GitHub before
// anything else, and that sign-in is also the GitHub link. On the relay it only gates creating a
// channel and the account: joining, approving and running channels go by the person key. Older
// relays take WorkOS (device authorization in the main process, in the system browser) or a name
// for a relay run with dev sign-in. A plain browser (development) can only sign in to a dev
// relay, as the person's name.

import * as Effect from "effect/Effect";
import { useEffect, useState } from "react";

import { fx as relayFx } from "@kiwi/core/client/relay.ts";

import { relayUrl } from "@kiwi/secrets/relay.ts";
import { run } from "./runtime";
import { bridge, secrets } from "@kiwi/secrets/secrets.ts";

export type SignInMode = "loading" | "off" | "github" | "workos" | "dev";

let mode: Promise<SignInMode> | null = null;

/** Whether this relay has sign-in, and which; a relay that doesn't answer has none. */
function signInMode(): Promise<SignInMode> {
  mode ??= run(
    relayFx.relayConfig(relayUrl()).pipe(
      Effect.map((c: { workosClientId: string | null; dev?: boolean; githubSignIn?: boolean; githubClientId?: string }): SignInMode =>
        c.dev ? "dev" : c.githubSignIn && c.githubClientId ? "github" : c.workosClientId ? "workos" : "off",
      ),
      Effect.catchCause(() => Effect.succeed<SignInMode>("off")),
    ),
  );
  return mode;
}

export function useSignInMode(): SignInMode {
  const [m, setM] = useState<SignInMode>("loading");
  useEffect(() => {
    let live = true;
    void signInMode().then((v) => live && setM(v));
    return () => {
      live = false;
    };
  }, []);
  return m;
}

/** Raised when sign-in can't happen here (a WorkOS relay, outside the app). */
class SignInUnavailable extends Error {}

/**
 * A token for creating a channel: null on a relay without sign-in. In the app, the bridge signs in
 * (or hands back the token it keeps); in a plain browser, a dev relay takes the person's name.
 */
export async function tokenForCreate(fresh = false): Promise<string | null> {
  const m = await signInMode();
  if (m === "off") return null;
  const b = bridge();
  if (b) {
    // fresh: the relay refused the kept token (expired, revoked, another relay's), so drop it and sign in again.
    if (fresh) await b.signOut();
    const kept = fresh ? null : await b.getToken();
    if (kept) return kept;
    const r = await b.signIn();
    if ("token" in r) return r.token;
    return (await b.devSignIn(devName())).token;
  }
  if (m === "dev") return `dev:${devName()}`;
  throw new SignInUnavailable("Creating a channel on this relay needs sign-in, which the Channels desktop app does.");
}

/** The person's name as a dev relay's user (letters, digits, - and _). */
function devName(): string {
  return (
    (secrets().person?.name ?? "someone")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "someone"
  );
}
