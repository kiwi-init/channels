import type { BrowserWindow } from "electrobun/main";

import { drive } from "./eb-driver.ts";
import { startupMarks } from "./eb-startup.ts";
import { testHomeProblem } from "./eb-test-home.ts";
import { testVault } from "./eb-test-store.ts";
import { normalizeRelay } from "./guard.ts";
import { dataDir } from "./host-eb.ts";
import { forceFrostForTest, frostAllowed, windowLooks } from "./native-eb.ts";
import { mutate, openStore } from "./store.ts";

declare const KIWI_EB_TEST: boolean;

export const wrongTestHome = (): string | null => (KIWI_EB_TEST ? testHomeProblem(dataDir, process.env.CFFIXED_USER_HOME) : null);

export function openTestStore(first: () => void): boolean {
  if (KIWI_EB_TEST) {
    first();
    openStore(testVault(dataDir));
    const relay = normalizeRelay(process.env.KIWI_EB_RELAY ?? "");
    if (relay) mutate((s) => void (s.relayUrl = relay));
    return true;
  }
  return false;
}

export function driveForTests(win: BrowserWindow): void {
  if (KIWI_EB_TEST) {
    const socket = process.env.KIWI_EB_DRIVER;
    if (socket)
      drive(win.webview, socket, {
        startup: startupMarks,
        closeWindow: () => (win.requestClose(), true),
        window: () => ({ visible: win.isVisible(), minimized: win.isMinimized() }),
        frame: () => win.getFrame(),
        spellCheck: () => win.spellCheck,
        looks: () => windowLooks(),
        frostAllowed: () => frostAllowed(),
        solidForTest: () => (forceFrostForTest(false), true),
        frostForTest: () => (forceFrostForTest(true), true),
        exitForTest: () => (setTimeout(() => process.exit(0), 100), true),
        placeForTest: () => {
          const f = win.getFrame();
          win.setFrame(f.x + 40, f.y + 30, f.width - 160, f.height - 90);
          return win.getFrame();
        },
      });
  }
}
