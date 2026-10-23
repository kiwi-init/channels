import { Utils, type BrowserWindow } from "electrobun/main";

import { drive } from "./eb-driver.ts";
import { testHomeProblem } from "./eb-test-home.ts";
import { testVault } from "./eb-test-store.ts";
import { normalizeRelay } from "./guard.ts";
import { mutate, openStore } from "./store.ts";

declare const KIWI_EB_TEST: boolean;

export const wrongTestHome = (): string | null => (KIWI_EB_TEST ? testHomeProblem(Utils.paths.userData, process.env.CFFIXED_USER_HOME) : null);

export function openTestStore(): boolean {
  if (KIWI_EB_TEST) {
    openStore(testVault(Utils.paths.userData));
    const relay = normalizeRelay(process.env.KIWI_EB_RELAY ?? "");
    if (relay) mutate((s) => void (s.relayUrl = relay));
    return true;
  }
  return false;
}

export function driveForTests(win: BrowserWindow): void {
  if (KIWI_EB_TEST) {
    const socket = process.env.KIWI_EB_DRIVER;
    if (socket) drive(win.webview, socket);
  }
}
