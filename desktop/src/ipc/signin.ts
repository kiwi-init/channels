import { ipcMain } from "electron";

import type { SignInResult } from "../bridge.ts";
import { freshToken, relayConfig, signInMain } from "../signin.ts";
import { mutate, store } from "../store.ts";

export function wireSignInIpc(): void {
  ipcMain.handle("kiwi:sign-in", (): Promise<SignInResult> => signInMain());
  ipcMain.handle("kiwi:dev-sign-in", async (_e, name: string) => {
    if (!(await relayConfig(store.relayUrl)).dev) throw new Error("this relay doesn't take dev sign-in");
    const clean = name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "dev";
    mutate((s) => (s.signin = { access: `dev:${clean}`, refresh: "", exp: Number.MAX_SAFE_INTEGER }));
    return { token: `dev:${clean}` };
  });
  ipcMain.handle("kiwi:token", () => freshToken());
  ipcMain.handle("kiwi:sign-out", () => mutate((s) => (s.signin = undefined)));
}
