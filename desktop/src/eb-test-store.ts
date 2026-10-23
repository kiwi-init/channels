import fs from "node:fs";
import path from "node:path";

import type { StoreFile, StoreVault, VaultRead } from "./store.ts";

const TEST_STORE = "kiwi-eb-test-store.json";

export function testVault(dir: string): StoreVault {
  const file = path.join(dir, TEST_STORE);
  return {
    where: () => file,
    load: (): VaultRead => (fs.existsSync(file) ? { ok: true, file: JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StoreFile>, resave: false } : { ok: true, file: null, resave: false }),
    save: (store: StoreFile) => {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(store), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    },
  };
}
