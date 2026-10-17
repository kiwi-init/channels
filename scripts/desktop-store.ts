import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ChannelIdentityView, PersonView } from "../desktop/src/bridge.ts";

export interface DesktopStore {
  relayUrl: string;
  person: PersonView | null;
  channels: ChannelIdentityView[];
  signin?: { access: string; exp: number };
}

export function readDesktopStore(opts: { dir?: string; keychain?: string } = {}): DesktopStore {
  const folder = opts.dir ?? join(homedir(), "Library", "Application Support", "kiwi-desktop");
  const service = opts.keychain ?? "kiwi-desktop Safe Storage";
  const password = execFileSync("security", ["find-generic-password", "-w", "-s", service], { encoding: "utf8" }).trim();
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const raw = readFileSync(join(folder, "kiwi-store.bin"));
  if (raw.subarray(0, 3).toString("latin1") !== "v10") throw new Error("this store is not an encrypted macOS store");
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(3)), decipher.final()]).toString("utf8")) as DesktopStore;
}
