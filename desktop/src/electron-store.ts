import path from "node:path";
import { app, dialog, safeStorage } from "electron";

import { keyringState, loadCopies, needsResave, writePrivate } from "./guard.ts";
import { logMainError } from "./main-log.ts";
import { brokenStore, type StoreFile, type StoreVault, type VaultRead } from "./store.ts";

const storePath = () => path.join(app.getPath("userData"), "kiwi-store.bin");

const backupPath = () => `${storePath()}.bak`;

function load(): VaultRead {
  const backend = process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : null;
  const keys = keyringState(process.platform, safeStorage.isEncryptionAvailable(), backend);
  if (keys === "plain" && process.platform === "linux") logMainError(new Error(`no keyring (safeStorage backend ${backend ?? "none"}): the keys in ${storePath()} are kept without encryption`));
  const loaded = loadCopies(storePath(), safeStorage.isEncryptionAvailable() ? (b) => safeStorage.decryptString(b) : null);
  if (!loaded.ok) return { ok: false, why: loaded.why };
  const { choice, raw } = loaded;
  if (choice.restore) writePrivate(storePath(), choice.restore);
  const read = choice.read;
  if (read.kind === "unreadable") return { ok: false, why: read.why };
  if (read.kind !== "ok") return { ok: true, file: null, resave: false };
  return { ok: true, file: read.json as Partial<StoreFile>, resave: needsResave(process.platform, choice.restore ?? raw, read, keys) };
}

function save(file: StoreFile): void {
  const json = JSON.stringify(file);
  const raw = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, "utf8");
  writePrivate(storePath(), raw);
  writePrivate(backupPath(), raw);
}

export const electronVault: StoreVault = { where: storePath, load, save };

export function warnIfBroken(): void {
  const broken = brokenStore();
  if (broken) void dialog.showMessageBox({ type: "error", message: "Channels can't read its saved keys", detail: broken.message });
}
