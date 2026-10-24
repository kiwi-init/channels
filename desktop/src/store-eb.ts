import os from "node:os";
import path from "node:path";

import type { KeySources } from "./launcher-key.ts";
import { readLegacyStore } from "./legacy-store.ts";
import { openStore, STORE_FILE, type OpenStore } from "./store-v2.ts";
import type { StoreFile, StoreVault } from "./store.ts";

export interface EbStoreOptions {
  dir: string;
  keys: KeySources | Error;
  home?: string;
  platform?: NodeJS.Platform;
}

export async function openEbStore({ dir, keys, home = os.homedir(), platform = process.platform }: EbStoreOptions): Promise<OpenStore> {
  if (keys instanceof Error) return { kind: "unreadable", why: keys.message, file: path.join(dir, STORE_FILE) };
  try {
    return await openStore({ dir, key: keys.key, legacy: () => readLegacyStore(keys.legacy, platform, home), platform });
  } finally {
    try {
      keys.done();
    } catch {
      // The launcher has gone already: the store is open or refused either way, and nothing asks it for a key again.
    }
  }
}

export function v2Vault(opened: OpenStore): StoreVault {
  return {
    where: () => opened.file,
    load: () => (opened.kind === "open" ? { ok: true, file: opened.json as Partial<StoreFile> | null, resave: false } : { ok: false, why: opened.why }),
    save: (file) => {
      if (opened.kind !== "open") throw new Error(`the store can't be saved: ${opened.why}`);
      opened.save(JSON.stringify(file));
    },
  };
}

export function unmarkedNote(opened: OpenStore): string | null {
  if (opened.kind !== "open" || opened.unmarked === null) return null;
  return `Your keychain didn't keep the mark that says your store key's first save finished (${opened.unmarked}). Your keys are saved, but until the keychain keeps that mark, Channels can't tell a deleted store from a first start.`;
}
