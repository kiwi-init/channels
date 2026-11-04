import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { b64url, fromB64url } from "../crypto.ts";
import type { DocStore } from "../doc/hub.ts";
import { DOC_THREAD_RE } from "../protocol.ts";

interface OnDisk {
  head: number;
  state: string;
  unsent: string | null;
}

const wellFormed = (x: unknown): x is OnDisk => {
  const d = x as Partial<OnDisk> | null;
  return !!d && Number.isSafeInteger(d.head) && (d.head ?? -1) >= 0 && typeof d.state === "string" && (d.unsent === null || typeof d.unsent === "string");
};

export function fileDocStore(dir: string): DocStore {
  const path = (th: string) => {
    if (!DOC_THREAD_RE.test(th)) throw new Error(`not a doc id: ${th}`);
    return join(dir, `${th}.json`);
  };
  return {
    load: async (th) => {
      const file = path(th);
      let raw: string;
      try {
        raw = await readFile(file, "utf8");
      } catch {
        // No local copy yet: the doc comes from the relay.
        return null;
      }
      let d: unknown;
      try {
        d = JSON.parse(raw);
      } catch {
        // A torn or foreign file is ignored; the relay still has the doc.
        return null;
      }
      return wellFormed(d) ? { head: d.head, state: fromB64url(d.state), unsent: d.unsent ? fromB64url(d.unsent) : null } : null;
    },
    save: async (th, saved) => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = path(th);
      const tmp = `${file}.${process.pid}.tmp`;
      const body: OnDisk = { head: saved.head, state: b64url(saved.state), unsent: saved.unsent ? b64url(saved.unsent) : null };
      await writeFile(tmp, JSON.stringify(body), { mode: 0o600 });
      await rename(tmp, file);
    },
  };
}
