import fs from "node:fs";
import path from "node:path";

import { writePrivate } from "./guard.ts";
import type { StoreFile, StoreVault, VaultRead } from "./store.ts";

export const TEST_STORE_FILE = "kiwi-eb-test-store.json";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function testVault(dir: string): StoreVault {
  const file = path.join(dir, TEST_STORE_FILE);
  const load = (): VaultRead => {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch (e) {
      // No file is a first run; any other failure is a store this build can't read, so nothing saves over it.
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, file: null, resave: false };
      return { ok: false, why: e instanceof Error ? e.message : String(e) };
    }
    let json: unknown;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      // A torn or edited file isn't a store: refuse it whole rather than start over it.
      return { ok: false, why: `${TEST_STORE_FILE} isn't JSON` };
    }
    return isRecord(json) ? { ok: true, file: json as Partial<StoreFile>, resave: false } : { ok: false, why: `${TEST_STORE_FILE} isn't a store` };
  };
  return { where: () => file, load, save: (store) => writePrivate(file, Buffer.from(JSON.stringify(store), "utf8")) };
}
