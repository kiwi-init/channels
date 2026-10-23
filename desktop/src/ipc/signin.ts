import type { SignInResult } from "../bridge.ts";
import type { Serves } from "../calls.ts";
import type { Host } from "../host.ts";
import { freshToken, relayConfig, signInMain } from "../signin.ts";
import { mutate, store } from "../store.ts";

export function signInCalls(host: Host): Serves<"signIn" | "devSignIn" | "getToken" | "signOut"> {
  return {
    signIn: (): Promise<SignInResult> => signInMain((u) => host.openExternal(u)),
    devSignIn: async (name: string) => {
      if (!(await relayConfig(store.relayUrl)).dev) throw new Error("this relay doesn't take dev sign-in");
      const clean = name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "dev";
      mutate((s) => (s.signin = { access: `dev:${clean}`, refresh: "", exp: Number.MAX_SAFE_INTEGER }));
      return { token: `dev:${clean}` };
    },
    getToken: () => freshToken(),
    signOut: () => mutate((s) => (s.signin = undefined)),
  };
}
