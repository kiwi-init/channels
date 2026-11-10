import { dataDir } from "./host-eb.ts";
import { launcherKeys } from "./launcher-channel-eb.ts";
import { logFile, logMainError } from "./main-log.ts";
import { messageBox } from "./message-box-eb.ts";
import { openEbStore, plainNote, unmarkedNote, v2Vault } from "./store-eb.ts";
import type { OpenStore } from "./store-v2.ts";
import { openStore, unreadableStore } from "./store.ts";
import { openTestStore } from "./test-build-eb.ts";
import type { Unreadable } from "./unreadable-store.ts";

let opened: OpenStore | null = null;

function endKeySession(): void {
  if (launcherKeys instanceof Error) return;
  try {
    launcherKeys.done();
  } catch {
    // A test build may start without the launcher in front, and then there's no session to end.
  }
}

export async function openStoreForThisBuild(): Promise<void> {
  if (openTestStore(endKeySession)) return;
  opened = await openEbStore({ dir: dataDir, keys: launcherKeys });
  openStore(v2Vault(opened));
}

export const keyringLocked = (): boolean => opened?.kind === "unreadable" && opened.cause === "locked";

export function unreadable(): Unreadable | null {
  const broken = keyringLocked() ? null : unreadableStore();
  return broken ? { ...broken, log: logFile() } : null;
}

export function warnAboutStore(): void {
  const plain = opened ? plainNote(opened) : null;
  if (plain) logMainError(new Error(plain));
  const unmarked = opened ? unmarkedNote(opened) : null;
  if (unmarked) {
    logMainError(new Error(unmarked));
    void messageBox({ type: "warning", message: "Channels couldn't mark its store key ready", detail: unmarked });
  }
}
