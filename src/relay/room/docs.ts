import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import {
  DOC_COMPACT,
  DOC_COMPACT_BYTES,
  DOC_COMPACT_UPDATES,
  DOC_PRUNE_IDLE_MS,
  DOC_VERSION_EVERY_MS,
  DOC_VERSIONS,
  MAX_CT_LENGTH,
  MAX_DOC_LOG_BYTES,
  MAX_DOC_LOG_UPDATES,
  MAX_DOC_PRUNE,
  MAX_DOC_SNAP_LENGTH,
  wellFormedThread,
  type DocEnvelope,
} from "@kiwi/core/protocol.ts";
import { BadRequest, Conflict, NotFound, ReadOnly, TooLarge } from "../failures.ts";
import { Policy } from "../policy.ts";
import { fits, StoredEnvelope } from "../schema.ts";
import { readMeta } from "./auth.ts";
import { RoomStore, type DocLog } from "./db.ts";
import { formatBytes } from "./limits.ts";
import { READ_ONLY } from "./messages.ts";

interface DocStored {
  update: DocEnvelope;
  compact: boolean;
}

const sealed = Effect.fn("Room.docSealed")(function* (th: unknown, iv: unknown, ct: unknown, e: number, sender: string, max: number) {
  const db = yield* RoomStore;
  if (db.isReadOnly(sender)) return yield* new ReadOnly({ message: READ_ONLY });
  if (!wellFormedThread(th)) return yield* new BadRequest({ message: "bad thread id" });
  if (typeof iv !== "string" || typeof ct !== "string" || !fits(StoredEnvelope, { iv, ct })) return yield* new BadRequest({ message: "bad envelope" });
  if (ct.length > max) return yield* new TooLarge({ message: "doc update too large" });
  const { epoch } = yield* readMeta;
  if (e !== epoch) return yield* new Conflict({ message: `stale key epoch ${e}; current is ${epoch}` });
  return { db, th, iv, ct, epoch };
});

const roomFor = Effect.fn("Room.docRoom")(function* (adding: number, freed = 0) {
  const db = yield* RoomStore;
  const cap = (yield* Policy).bytesPerChannel;
  if (db.docBytes() - freed + adding > cap) return yield* new TooLarge({ message: `this channel's docs hold all they may (${formatBytes(cap)})` });
});

const wantsCompact = (log: DocLog, epoch: number): boolean => log.bytes >= DOC_COMPACT_BYTES || log.n >= DOC_COMPACT_UPDATES || log.oldest < epoch;

export const docAppend = Effect.fn("Room.docAppend")(function* (th: unknown, iv: unknown, ct: unknown, e: number, sender: string) {
  const ok = yield* sealed(th, iv, ct, e, sender, MAX_CT_LENGTH);
  const log = ok.db.docLog(ok.th);
  if (log.bytes + ok.ct.length > MAX_DOC_LOG_BYTES || log.n >= MAX_DOC_LOG_UPDATES) return yield* new TooLarge({ message: DOC_COMPACT });
  yield* roomFor(ok.ct.length);
  const ts = yield* Clock.currentTimeMillis;
  const dseq = log.head + 1;
  ok.db.docAppend(ok.th, dseq, ts, ok.iv, ok.ct, ok.epoch);
  const after: DocLog = { ...log, head: dseq, n: log.n + 1, bytes: log.bytes + ok.ct.length, oldest: Math.min(log.oldest, ok.epoch) };
  return { update: { th: ok.th, dseq, ts, iv: ok.iv, ct: ok.ct, e: ok.epoch }, compact: wantsCompact(after, ok.epoch) } satisfies DocStored;
});

export const docSnap = Effect.fn("Room.docSnap")(function* (th: unknown, upto: unknown, iv: unknown, ct: unknown, e: number, sender: string) {
  const ok = yield* sealed(th, iv, ct, e, sender, MAX_DOC_SNAP_LENGTH);
  const log = ok.db.docLog(ok.th);
  if (!Number.isSafeInteger(upto) || (upto as number) <= log.upto || (upto as number) > log.head) {
    return yield* new Conflict({ message: `a snapshot must cover past ${log.upto} and no further than ${log.head}` });
  }
  yield* roomFor(ok.ct.length, log.bytes);
  const ts = yield* Clock.currentTimeMillis;
  ok.db.docSnap(ok.th, upto as number, ts, ok.iv, ok.ct, ok.epoch, { versions: DOC_VERSIONS, everyMs: DOC_VERSION_EVERY_MS });
  return { th: ok.th, dseq: upto as number, ts, iv: ok.iv, ct: ok.ct, e: ok.epoch, snap: true as const };
});

export const docsListed = Effect.fn("Room.docsListed")(function* () {
  return (yield* RoomStore).docList();
});

export const docVersions = Effect.fn("Room.docVersions")(function* (th: unknown) {
  if (!wellFormedThread(th)) return yield* new BadRequest({ message: "bad thread id" });
  return (yield* RoomStore).docVersions(th);
});

export const docVersion = Effect.fn("Room.docVersion")(function* (th: unknown, upto: unknown) {
  if (!wellFormedThread(th)) return yield* new BadRequest({ message: "bad thread id" });
  if (!Number.isSafeInteger(upto) || (upto as number) <= 0) return yield* new BadRequest({ message: "upto: a version's number" });
  const got = (yield* RoomStore).docVersion(th, upto as number);
  if (!got) return yield* new NotFound({ message: "no such version of this doc" });
  return got;
});

export const docsPrune = Effect.fn("Room.docsPrune")(function* (ths: unknown) {
  if (!Array.isArray(ths) || ths.length > MAX_DOC_PRUNE || !ths.every(wellFormedThread)) return yield* new BadRequest({ message: `th: up to ${MAX_DOC_PRUNE} doc ids` });
  const db = yield* RoomStore;
  const now = yield* Clock.currentTimeMillis;
  const listed = new Map(db.docList().map((d) => [d.th, d]));
  const dropped: string[] = [];
  const kept: string[] = [];
  let freed = 0;
  for (const th of new Set(ths)) {
    const d = listed.get(th);
    if (!d) continue;
    if (now - d.last < DOC_PRUNE_IDLE_MS) {
      kept.push(th);
      continue;
    }
    freed += db.docDrop(th);
    dropped.push(th);
  }
  return { dropped, kept, freed };
});

export const docBacklog = Effect.fn("Room.docBacklog")(function* (th: string, since: unknown) {
  const db = yield* RoomStore;
  const from = Number.isSafeInteger(since) && (since as number) > 0 ? (since as number) : 0;
  return { updates: db.docSince(th, from), head: db.docLog(th).head };
});
