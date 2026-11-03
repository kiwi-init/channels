import type { SignInResult } from "../bridge.ts";
import type { Serves } from "../calls.ts";
import type { Host } from "../host.ts";
import { githubSignInToken, githubSignsIn, relayConfig, signInToken } from "../signin.ts";
import { signInWithGithub } from "./github.ts";
import { mutate, store } from "../store.ts";

export function signInCalls(host: Host): Serves<"signIn" | "devSignIn" | "getToken" | "signOut"> {
  return {
    signIn: async (): Promise<SignInResult> => {
      const config = await relayConfig(store.relayUrl);
      if (config.dev) return { dev: true };
      if (!githubSignsIn(config)) throw new Error("this relay has no sign-in");
      return { token: (await githubSignInToken()) ?? (await signInWithGithub(host)) };
    },
    devSignIn: async (name: string) => {
      if (!(await relayConfig(store.relayUrl)).dev) throw new Error("this relay doesn't take dev sign-in");
      const clean = name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "dev";
      mutate((s) => (s.signin = { access: `dev:${clean}` }));
      return { token: `dev:${clean}` };
    },
    getToken: () => signInToken(),
    signOut: async () => {
      const dev = !!(await relayConfig(store.relayUrl).catch(() => null))?.dev;
      mutate((s) => {
        s.signin = undefined;
        if (!dev && s.github) s.github = { ...s.github, token: "" };
      });
    },
  };
}
