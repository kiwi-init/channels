import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SecretRow } from "@kiwi/core/secrets.ts";
import { home, safe, writePrivate } from "./paths.ts";

const MAX_KEPT = 128;

export function secretsDir(roomId: string): string {
  return join(home(), "secrets", safe(roomId));
}

const secretsPath = (roomId: string, name: string) => join(secretsDir(roomId), `${safe(name)}.json`);

const isRow = (r: unknown): r is SecretRow => {
  const o = r as Partial<SecretRow> | null;
  return !!o && typeof o.id === "string" && typeof o.box === "string" && typeof o.at === "number";
};

export function readSecrets(roomId: string, name: string): SecretRow[] {
  const path = secretsPath(roomId, name);
  if (!existsSync(path)) return [];
  try {
    const kept: unknown = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(kept) ? kept.filter(isRow).slice(0, MAX_KEPT) : [];
  } catch {
    // A torn or foreign file holds no copy worth trusting: the next fetch writes it again.
    return [];
  }
}

export function keepSecrets(roomId: string, name: string, current: readonly SecretRow[]): void {
  const fresh = current.map(({ id, box, at }) => ({ id, box, at }));
  const before = readSecrets(roomId, name).filter((r) => !fresh.some((f) => f.box === r.box));
  const rows = [...fresh, ...before].slice(0, MAX_KEPT);
  if (rows.length) writePrivate(secretsPath(roomId, name), `${JSON.stringify(rows)}\n`);
}

export function forgetSecrets(roomId: string, name: string): void {
  rmSync(secretsPath(roomId, name), { force: true });
}
