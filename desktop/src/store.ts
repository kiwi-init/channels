import fs from "node:fs";
import path from "node:path";
import { app, dialog, safeStorage } from "electron";

import type { Identity } from "@kiwi/core/identity.ts";
import type { Personality } from "@kiwi/core/personality.ts";
import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts";
import type { ChannelIdentityView, ComputerView, PendingItem, PersonView, StoreSnapshot } from "./bridge.ts";
import { chooseStore, normalizeRelay, snapshotOf, writePrivate, keyringState, needsResave, type KeyringState } from "./guard.ts";
import { tellKeys } from "./keys-process.ts";
import type { VoiceStore } from "./voice.ts";
import { logMainError } from "./main-log.ts";
import { currentWindow } from "./window.ts";

export interface StoreFile {
  relayUrl: string;
  person: PersonView | null;
  channels: ChannelIdentityView[];
  computers: ComputerView[];
  pending: PendingItem[];
  signin?: { access: string; refresh: string; exp: number };
  github?: { login: string; id: number; token: string; at: number; relay?: string; clientId?: string };
  migrated?: boolean;
  voice?: VoiceStore;
  personalities?: Personality[];
}

const storePath = () => path.join(app.getPath("userData"), "kiwi-store.bin");

function defaults(): StoreFile {
  return { relayUrl: DEFAULT_RELAY, person: null, channels: [], computers: [], pending: [] };
}

export let store: StoreFile = defaults();

let storeBroken: string | null = null;

let keys: KeyringState = "keyring";

const backupPath = () => `${storePath()}.bak`;

function readBackup(): Buffer | null {
  try {
    return fs.readFileSync(backupPath());
  } catch {
    // No backup yet, or one this user can't read: the main file alone decides, as before backups.
    return null;
  }
}

export function loadStore(): void {
  let raw: Buffer | null = null;
  try {
    raw = fs.readFileSync(storePath());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") storeBroken = e instanceof Error ? e.message : String(e);
  }
  const choice = storeBroken ? null : chooseStore(raw, readBackup(), safeStorage.isEncryptionAvailable() ? (b) => safeStorage.decryptString(b) : null);
  if (choice?.restore) writePrivate(storePath(), choice.restore);
  const read = choice?.read ?? null;
  const backend = process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : null;
  keys = keyringState(process.platform, safeStorage.isEncryptionAvailable(), backend);
  if (read?.kind === "ok") store = { ...defaults(), ...(read.json as Partial<StoreFile>) };
  else {
    store = defaults();
    if (read?.kind === "unreadable") storeBroken = read.why;
  }
  store.relayUrl = normalizeRelay(store.relayUrl) ?? DEFAULT_RELAY;
  if (read && needsResave(process.platform, choice?.restore ?? raw, read, keys)) saveStore();
  if (keys === "plain" && process.platform === "linux") logMainError(new Error(`no keyring (safeStorage backend ${backend ?? "none"}): the keys in ${storePath()} are kept without encryption`));
}

const brokenError = () =>
  new Error(`Channels can't read its saved keys (${storeBroken}), so it saves nothing over them. Unlock your keychain, then quit and reopen Channels. The file is ${storePath()}.`);

function saveStore(): void {
  if (storeBroken) throw brokenError();
  const json = JSON.stringify(store);
  const raw = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, "utf8");
  writePrivate(storePath(), raw);
  writePrivate(backupPath(), raw);
}

export function warnIfBroken(): void {
  if (!storeBroken) return;
  void dialog.showMessageBox({ type: "error", message: "Channels can't read its saved keys", detail: brokenError().message });
}

export const snapshot = (): StoreSnapshot => snapshotOf(store);
const broadcast = () => currentWindow()?.webContents.send("kiwi:store", snapshot());
export const mutate = (fn: (s: StoreFile) => void) => {
  if (storeBroken) throw brokenError();
  fn(store);
  saveStore();
  broadcast();
  tellKeys({ type: "seats", seats: store.channels, person: store.person?.pk ?? null });
};

export function requirePerson(): Identity {
  const p = store.person;
  if (!p || !p.xsk) throw new Error("make your person key first");
  return { name: p.name, pk: p.pk, sk: p.sk, xpk: p.xpk, xsk: p.xsk };
}

export function upsertComputer(c: ComputerView): void {
  mutate((s) => {
    s.computers = [...s.computers.filter((x) => x.machinePk !== c.machinePk), c];
  });
}
