import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import type { AnswerMemory, BlobMemory } from "@kiwi/core/client.ts";
import type { Member } from "@kiwi/core/membership.ts";
import { BLOB_ID_RE, type Message } from "@kiwi/core/protocol.ts";
import type { FoldBase } from "@kiwi/core/state.ts";
import { withLock } from "./file.ts";
import { home, safe, writePrivate } from "./paths.ts";

export const fileRecordMemory = {
  get(room: string, pk: string): Member | null {
    try {
      return (JSON.parse(readFileSync(join(home(), "records", `${safe(room)}.json`), "utf8")) as Record<string, Member>)[pk] ?? null;
    } catch {
      return null;
    }
  },
  set(room: string, pk: string, m: Member): void {
    const path = join(home(), "records", `${safe(room)}.json`);
    mkdirSync(join(home(), "records"), { recursive: true, mode: 0o700 });
    withLock(`${path}.lock`, () => {
      let all: Record<string, Member> = {};
      try {
        all = JSON.parse(readFileSync(path, "utf8")) as Record<string, Member>;
      } catch {
        // First record for this room, or a torn file: start over (the relay serves them all again).
      }
      all[pk] = m;
      writePrivate(path, JSON.stringify(all));
    });
  },
};

export const fileAnswerMemory: AnswerMemory = {
  get(room, what) {
    try {
      const kept = JSON.parse(readFileSync(join(home(), "answers", safe(room), `${what}.json`), "utf8")) as { etag?: unknown; data?: unknown };
      return typeof kept.etag === "string" && kept.data && typeof kept.data === "object" ? { etag: kept.etag, data: kept.data } : null;
    } catch {
      return null;
    }
  },
  set(room, what, answer) {
    writePrivate(join(home(), "answers", safe(room), `${what}.json`), JSON.stringify(answer));
  },
};

export const blobDir = (room: string) => join(home(), "cache", `${safe(room)}.blobs`);

const BLOB_CACHE_BYTES = 128 * 1024 ** 2;

function trimBlobs(dir: string, most: number): void {
  const files = readdirSync(dir)
    .filter((f) => BLOB_ID_RE.test(f))
    .flatMap((f) => {
      try {
        const s = statSync(join(dir, f));
        return [{ path: join(dir, f), size: s.size, used: s.mtimeMs }];
      } catch {
        return [];
      }
    });
  let total = files.reduce((n, f) => n + f.size, 0);
  if (total <= most) return;
  files.sort((a, b) => a.used - b.used);
  for (const f of files) {
    if (total <= most) return;
    rmSync(f.path, { force: true });
    total -= f.size;
  }
}

export function fileBlobs(most = BLOB_CACHE_BYTES): BlobMemory {
  return {
    get(room, id) {
      if (!BLOB_ID_RE.test(id)) return null;
      const path = join(blobDir(room), id);
      try {
        const blob = new Uint8Array(readFileSync(path));
        const now = new Date();
        utimesSync(path, now, now);
        return blob;
      } catch {
        return null;
      }
    },
    set(room, id, blob) {
      if (!BLOB_ID_RE.test(id)) return;
      try {
        writePrivate(join(blobDir(room), id), blob);
        trimBlobs(blobDir(room), most);
      } catch {
        // Only a cache: a blob not kept here is fetched from the relay again.
      }
    },
    drop(room, id) {
      if (!BLOB_ID_RE.test(id)) return;
      rmSync(join(blobDir(room), id), { force: true });
    },
  };
}

export const fileBlobMemory = fileBlobs();

export function cachePath(roomId: string): string {
  return join(home(), "cache", `${roomId}.jsonl`);
}

export function readCache(roomId: string): Message[] {
  const path = cachePath(roomId);
  if (!existsSync(path)) return [];
  const bySeq = new Map<number, Message>();
  let lines = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    lines++;
    try {
      const m = JSON.parse(line) as Message;
      bySeq.set(m.seq, m);
    } catch {
      // A torn final line from a crash mid-write; the next sync refetches it.
    }
  }
  const messages = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  if (lines > messages.length) {
    withLock(`${path}.lock`, () => {
      writePrivate(path, messages.map((m) => JSON.stringify(m)).join("\n") + (messages.length ? "\n" : ""));
      writePrivate(`${path}.seq`, String(messages.at(-1)?.seq ?? 0));
    });
  }
  return messages;
}

export function appendCache(roomId: string, messages: Message[]): void {
  if (!messages.length) return;
  const path = cachePath(roomId);
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  withLock(`${path}.lock`, () => {
    const last = existsSync(`${path}.seq`) ? Number(readFileSync(`${path}.seq`, "utf8")) || 0 : 0;
    const fresh = messages.filter((m) => m.seq > last);
    if (!fresh.length) return;
    appendFileSync(path, fresh.map((m) => JSON.stringify(m)).join("\n") + "\n", { mode: 0o600 });
    writePrivate(`${path}.seq`, String(fresh.at(-1)!.seq));
  });
}

export function trimCache(roomId: string, base: FoldBase): number {
  const path = cachePath(roomId);
  if (!existsSync(path)) return 0;
  return withLock(`${path}.lock`, () => {
    if ((readBase(roomId)?.n ?? 0) < base.n) writePrivate(`${path}.base`, JSON.stringify(base));
    const kept: string[] = [];
    let dropped = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line) continue;
      try {
        if ((JSON.parse(line) as Message).seq > base.n) kept.push(line);
        else dropped++;
      } catch {
        // A torn line: dropped with the rest, the next sync refetches what it held.
        dropped++;
      }
    }
    if (dropped) writePrivate(path, kept.join("\n") + (kept.length ? "\n" : ""));
    return dropped;
  });
}

export function readBase(roomId: string): FoldBase | null {
  try {
    return JSON.parse(readFileSync(`${cachePath(roomId)}.base`, "utf8")) as FoldBase;
  } catch {
    return null;
  }
}

export function dropBase(roomId: string): void {
  rmSync(`${cachePath(roomId)}.base`, { force: true });
}

export function keepBase(roomId: string, base: FoldBase): void {
  const path = cachePath(roomId);
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  withLock(`${path}.lock`, () => {
    if ((readBase(roomId)?.n ?? 0) >= base.n) return;
    writePrivate(`${path}.base`, JSON.stringify(base));
  });
}
