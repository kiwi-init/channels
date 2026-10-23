import { Utils } from "electrobun/main";

import { openTestStore } from "./test-build-eb.ts";
import { bundle } from "./host-eb.ts";
import { brokenStore, openStore, type StoreVault } from "./store.ts";

const memoryVault: StoreVault = { where: () => `memory, nothing saved (${bundle.identifier})`, load: () => ({ ok: true, file: null, resave: false }), save: () => {} };

export function openStoreForThisBuild(): void {
  if (!openTestStore()) openStore(memoryVault);
}

export function warnIfStoreBroken(): void {
  const broken = brokenStore();
  if (broken) void Utils.showMessageBox({ type: "error", message: "Channels can't read its saved keys", detail: broken.message });
}
