import os from "node:os";
import path from "node:path";

import type { KeySources } from "./launcher-key.ts";
import { readLegacyStore } from "./legacy-store.ts";
import { openStore, STORE_FILE, type OpenStore, type Refusal } from "./store-v2.ts";
import type { StoreFile, StoreVault } from "./store.ts";

export function ebDataDir(identifier: string, channel: string, platform: NodeJS.Platform = process.platform, home: string = os.homedir(), env: NodeJS.ProcessEnv = process.env): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(identifier) || !/^[a-z0-9-]+$/.test(channel))
    throw new Error(`the app's data folder needs a plain identifier and channel, not ${JSON.stringify(identifier)} and ${JSON.stringify(channel)}`);
  const root =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : platform === "win32"
        ? env["LOCALAPPDATA"] || path.join(home, "AppData", "Local")
        : env["XDG_DATA_HOME"] || path.join(home, ".local", "share");
  return path.join(root, identifier, channel);
}

export interface EbStoreOptions {
  dir: string;
  keys: KeySources | Error;
  home?: string;
  platform?: NodeJS.Platform;
}

export async function openEbStore({ dir, keys, home = os.homedir(), platform = process.platform }: EbStoreOptions): Promise<OpenStore> {
  if (keys instanceof Error) return { kind: "unreadable", why: keys.message, file: path.join(dir, STORE_FILE), cause: "launcher" };
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

export const REFUSAL_ADVICE: Record<Refusal, string> = {
  keychain: "Unlock your keychain, then quit and reopen Channels.",
  keyless: "Its key is no longer in your keychain. Restore your keychain from a backup, then reopen Channels.",
  deleted:
    "Your keychain still holds its key, but both copies of the store are gone. Put the store back from a backup, then reopen Channels: it won't start over by itself, so a deleted store can't be replaced without you noticing.",
  legacy: "Unlock your keychain so Channels can read what the earlier Channels app saved, then quit and reopen Channels.",
  "legacy-plain": "The earlier Channels app always encrypted that file on a Mac, so Channels won't take a plain copy. If you didn't put it there, someone else may have.",
  save: "Make sure your disk has room and Channels' data folder can be written, then reopen Channels.",
  copy: "Restore the store from a backup, then reopen Channels.",
  launcher: "Open Channels from your Applications folder: only its signed launcher can give it its key.",
};

export function v2Vault(opened: OpenStore): StoreVault {
  return {
    where: () => opened.file,
    load: () => (opened.kind === "open" ? { ok: true, file: opened.json as Partial<StoreFile> | null, resave: false } : { ok: false, why: opened.why, advice: REFUSAL_ADVICE[opened.cause] }),
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
