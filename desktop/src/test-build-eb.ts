import Electrobun, { type BrowserWindow } from "electrobun/main";

import { linksOpened } from "./deep-links.ts";
import { drive } from "./eb-driver.ts";
import { startupMarks } from "./eb-startup.ts";
import { testHomeProblem } from "./eb-test-home.ts";
import { testVault } from "./eb-test-store.ts";
import { normalizeRelay } from "./guard.ts";
import { launchArgs } from "./single-instance.ts";
import { dataDir } from "./host-eb.ts";
import { forceFrostForTest, frostAllowed, windowLooks } from "./native-eb.ts";
import { browserOpens } from "./open.ts";
import { minWindowWidth } from "./window-size.ts";
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

const BRIDGE_EVENTS = ["dom-ready", "host-message", "will-navigate", "new-window-open"];

function hearBridgeEvents(win: BrowserWindow): () => { name: string; detail: string }[] {
  const heard: { name: string; detail: string }[] = [];
  const detailOf = (e: unknown): string => {
    const data = typeof e === "object" && e !== null && "data" in e ? e.data : null;
    const detail = typeof data === "object" && data !== null && "detail" in data ? data.detail : "";
    return (typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300);
  };
  for (const name of BRIDGE_EVENTS) Electrobun.events.on(`${name}-${win.webview.id}`, (e: unknown) => void heard.push({ name, detail: detailOf(e) }));
  return () => [...heard];
}

export function driveForTests(win: BrowserWindow): void {
  if (KIWI_EB_TEST) {
    const socket = process.env.KIWI_EB_DRIVER;
    const bridgeEvents = hearBridgeEvents(win);
    if (socket)
      drive(win.webview, socket, {
        bridgeEvents,
        startup: startupMarks,
        linksOpened,
        browserOpens,
        argv: () => ({ argv: process.argv, launch: launchArgs() }),
        closeWindow: () => (win.requestClose(), true),
        activate: () => (win.activate(), true),
        window: () => ({ visible: win.isVisible(), minimized: win.isMinimized() }),
        frame: () => win.getFrame(),
        spellCheck: () => win.spellCheck,
        looks: () => windowLooks(),
        frostAllowed: () => frostAllowed(),
        solidForTest: () => (forceFrostForTest(false), true),
        frostForTest: () => (forceFrostForTest(true), true),
        narrowForTest: () => {
          const f = win.getFrame();
          win.setFrame(f.x, f.y, 1000, Math.max(f.height, 700));
          return win.getFrame();
        },
        minimizeForTest: () => (win.minimize(), true),
        unminimizeForTest: () => (win.unminimize(), true),
        placeForTest: () => {
          const f = win.getFrame();
          const step = f.width - 80 > minWindowWidth(process.platform) + 40 ? 1 : -1;
          win.setFrame(f.x + 20 * step, f.y + 15 * step, f.width - 80 * step, f.height - 45 * step);
          return win.getFrame();
        },
      });
  }
}
