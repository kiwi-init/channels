import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { home, safe, writePrivate } from "./paths.ts";

export async function loadIdentity(name: string, roomId: string): Promise<Identity> {
  const path = join(identityDir(roomId), `${safe(name)}.json`);
  const legacy = join(home(), "identities", `${safe(name)}.json`);
  if (!existsSync(path) && existsSync(legacy)) {
    writePrivate(path, readFileSync(legacy, "utf8"));
    rmSync(legacy, { force: true });
  }
  if (existsSync(path)) {
    const stored = JSON.parse(readFileSync(path, "utf8")) as Identity;
    const id = await withExchangeKey(stored);
    if (id !== stored) writePrivate(path, JSON.stringify(id, null, 2) + "\n");
    return id;
  }
  const id = await generateIdentity(name);
  writePrivate(path, JSON.stringify(id, null, 2) + "\n");
  return id;
}

export function saveIdentity(id: Identity, roomId: string): void {
  const path = join(identityDir(roomId), `${safe(id.name)}.json`);
  if (existsSync(path)) throw new Error(`this computer already has a key named ${id.name} in this channel`);
  writePrivate(path, JSON.stringify(id, null, 2) + "\n");
}

export function identityDir(roomId: string): string {
  return join(home(), "identities", safe(roomId));
}

export function forgetIdentity(name: string, roomId: string): void {
  rmSync(join(identityDir(roomId), `${safe(name)}.json`), { force: true });
}

export function identitiesIn(roomId: string): string[] {
  const dir = identityDir(roomId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return (JSON.parse(readFileSync(join(dir, f), "utf8")) as Identity).name;
      } catch {
        return null;
      }
    })
    .filter((n): n is string => !!n);
}

export function forgetIdentities(roomId: string): void {
  rmSync(identityDir(roomId), { recursive: true, force: true });
}
