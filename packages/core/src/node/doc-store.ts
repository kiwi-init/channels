import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { b64url, fromB64url, openWith, sealWith } from "../crypto.ts";
import type { DocStore } from "../doc/hub.ts";
import { DOC_THREAD_RE } from "../protocol.ts";

interface OnDisk {
  head: number;
  state: string;
  unsent: string | null;
}

export interface DocSeat {
  roomId: string;
  sk: string;
}

const enc = new TextEncoder();

const wellFormed = (x: unknown): x is OnDisk => {
  const d = x as Partial<OnDisk> | null;
  return !!d && Number.isSafeInteger(d.head) && (d.head ?? -1) >= 0 && typeof d.state === "string" && (d.unsent === null || typeof d.unsent === "string");
};

async function storeKey(seat: DocSeat): Promise<string> {
  const base = await crypto.subtle.importKey("raw", enc.encode(seat.sk), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: enc.encode(seat.roomId), info: enc.encode("kiwi-doc-store") }, base, 256);
  return b64url(new Uint8Array(bits));
}

const sealedAs = (roomId: string, th: string) => `kiwi-doc-store\n${roomId}\n${th}`;

export const forgetDocs = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true });

export function fileDocStore(dir: string, seat: DocSeat): DocStore {
  let key: Promise<string> | null = null;
  const keyed = () => (key ??= storeKey(seat));
  const path = (th: string) => {
    if (!DOC_THREAD_RE.test(th)) throw new Error(`not a doc id: ${th}`);
    return join(dir, `${th}.doc`);
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
      const plain = await openWith(await keyed(), raw.trim(), sealedAs(seat.roomId, th));
      let d: unknown;
      try {
        d = plain === null ? null : JSON.parse(plain);
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
      await writeFile(tmp, await sealWith(await keyed(), JSON.stringify(body), sealedAs(seat.roomId, th)), { mode: 0o600 });
      await rename(tmp, file);
    },
  };
}
