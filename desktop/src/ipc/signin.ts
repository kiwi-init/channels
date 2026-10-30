import type { SignInResult } from "../bridge.ts";
import type { Serves } from "../calls.ts";
import type { Host } from "../host.ts";
import { createToken, githubSignInToken, githubSignsIn, relayConfig, signInMain } from "../signin.ts";
import { signInWithGithub } from "./github.ts";
import { mutate, store } from "../store.ts";

export function signInCalls(host: Host): Serves<"signIn" | "devSignIn" | "getToken" | "signOut"> {
  return {
    signIn: async (): Promise<SignInResult> => {
      if (githubSignsIn(await relayConfig(store.relayUrl))) return { token: (await githubSignInToken()) ?? (await signInWithGithub(host)) };
      return signInMain((u) => host.openExternal(u));
    },
    devSignIn: async (name: string) => {
      if (!(await relayConfig(store.relayUrl)).dev) throw new Error("this relay doesn't take dev sign-in");
      const clean = name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "dev";
      mutate((s) => (s.signin = { access: `dev:${clean}`, refresh: "", exp: Number.MAX_SAFE_INTEGER }));
      return { token: `dev:${clean}` };
    },
    getToken: () => createToken(),
    signOut: async () => {
      const github = githubSignsIn(await relayConfig(store.relayUrl).catch(() => ({})));
      mutate((s) => {
        if (!github) s.signin = undefined;
        else if (s.github) s.github = { ...s.github, token: "" };
      });
    },
  };
}
