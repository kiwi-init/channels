import { Utils } from "electrobun/main";

import { dataDir } from "./host-eb.ts";
import { launcherKeys } from "./launcher-channel-eb.ts";
import { logMainError } from "./main-log.ts";
import { openEbStore, plainNote, unmarkedNote, v2Vault } from "./store-eb.ts";
import type { OpenStore } from "./store-v2.ts";
import { brokenStore, openStore } from "./store.ts";
import { openTestStore } from "./test-build-eb.ts";

declare const KIWI_EB_LIVEWIRE: boolean;

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
  opened = await openEbStore({ dir: dataDir, keys: launcherKeys, importLegacy: !KIWI_EB_LIVEWIRE });
  openStore(v2Vault(opened));
}

export function warnIfStoreBroken(): void {
  const broken = brokenStore();
  if (broken) void Utils.showMessageBox({ type: "error", message: "Channels can't read its saved keys", detail: broken.message });
  const plain = opened ? plainNote(opened) : null;
  if (plain) logMainError(new Error(plain));
  const unmarked = opened ? unmarkedNote(opened) : null;
  if (unmarked) {
    logMainError(new Error(unmarked));
    void Utils.showMessageBox({ type: "warning", message: "Channels couldn't mark its store key ready", detail: unmarked });
  }
}
