// This browser's copy of a channel's history, so a reload fetches only what is new.
//
// At rest a row is ciphertext sealed to the channel key (the same key the member
// record already holds), plus the room id, the member key, the seq, the relay
// time, and the epoch of the key that sealed this copy. The message text is not
// stored. It is decrypted for the screen, then checked: the seq inside the seal
// has to match the row, so editing the row cannot move a message.
//
// Rows are keyed by room and member key, so two accounts in one browser do not
// share a cache. Leave, kick and close delete them. A hole, a seal
// that does not open, or a seq past the relay's head drops that cache and the
// page loads the usual window. The cache does not fill a gap or sort ahead of
// the relay. See history-plan.ts.

import type { CachedKept, CachedRow, Unread } from "@kiwi/core/cache-row.ts"
import type { Message } from "@kiwi/core/protocol.ts"
import { planReload } from "./history-plan"
import { markOnce } from "./marks"

export type { CachedKept, CachedRow }
export type OpenRows = (rows: CachedRow[]) => Promise<(Message | Unread | null)[]>

export interface HistoryDb {
  put(roomId: string, memberPk: string, row: CachedRow): Promise<void>
  putRows(roomId: string, memberPk: string, rows: CachedRow[], oldestKept: number): Promise<void>
  rows(roomId: string, memberPk: string): Promise<CachedRow[]>
  /** Delete seqs below `oldestKept` for this room and member. */
  trimBelow(roomId: string, memberPk: string, oldestKept: number): Promise<void>
  /** Delete seqs above `newestKept` for this room and member. */
  trimAbove(roomId: string, memberPk: string, newestKept: number): Promise<void>
  drop(roomId: string, memberPk: string): Promise<void>
  dropAll(): Promise<void>
  putKept(roomId: string, memberPk: string, kept: CachedKept): Promise<void>
  kept(roomId: string, memberPk: string): Promise<CachedKept | null>
}

const DB = "mc.history"
const STORE = "rows"
const KEPT = "kept"

function range(roomId: string, memberPk: string, hi: number, hiOpen: boolean): IDBKeyRange {
  return IDBKeyRange.bound([roomId, memberPk, 0], [roomId, memberPk, hi], false, hiOpen)
}

/** Seqs strictly above `newestKept`. */
function rangeAbove(roomId: string, memberPk: string, newestKept: number): IDBKeyRange {
  return IDBKeyRange.bound([roomId, memberPk, newestKept], [roomId, memberPk, Number.MAX_SAFE_INTEGER], true, false)
}

function idb(): { db: HistoryDb; open: () => Promise<IDBDatabase> } {
  let open: Promise<IDBDatabase> | null = null
  const openDb = (): Promise<IDBDatabase> =>
    (open ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB, 2)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
        if (!db.objectStoreNames.contains(KEPT)) db.createObjectStore(KEPT)
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => {
          db.close()
          open = null
        }
        db.onclose = () => {
          open = null
        }
        resolve(db)
      }
      req.onerror = () => {
        open = null
        reject(req.error)
      }
    }))

  const once = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void, name: string = STORE): Promise<T> => {
    const db = await openDb()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(name, mode)
      const out = fn(tx.objectStore(name))
      tx.oncomplete = () => resolve((out && "result" in out ? out.result : undefined) as T)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void, name: string = STORE): Promise<T> => {
    try {
      return await once(mode, fn, name)
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "InvalidStateError")) throw err
      // The kept connection closed under us (another tab upgraded or the browser closed it): open a fresh one, once.
      open = null
      return once(mode, fn, name)
    }
  }

  const db: HistoryDb = {
    put: (roomId, memberPk, row) => run<void>("readwrite", (s) => void s.put(row, [roomId, memberPk, row.seq])),
    putRows: (roomId, memberPk, rows, oldestKept) =>
      run<void>("readwrite", (s) => {
        for (const row of rows) s.put(row, [roomId, memberPk, row.seq])
        s.delete(range(roomId, memberPk, oldestKept, true))
      }),
    rows: (roomId, memberPk) => run<CachedRow[]>("readonly", (s) => s.getAll(range(roomId, memberPk, Number.MAX_SAFE_INTEGER, false))),
    trimBelow: (roomId, memberPk, oldestKept) => run<void>("readwrite", (s) => void s.delete(range(roomId, memberPk, oldestKept, true))),
    trimAbove: (roomId, memberPk, newestKept) => run<void>("readwrite", (s) => void s.delete(rangeAbove(roomId, memberPk, newestKept))),
    drop: async (roomId, memberPk) => {
      await run<void>("readwrite", (s) => void s.delete(range(roomId, memberPk, Number.MAX_SAFE_INTEGER, false)))
      await run<void>("readwrite", (s) => void s.delete([roomId, memberPk]), KEPT)
    },
    dropAll: async () => {
      await run<void>("readwrite", (s) => void s.clear())
      await run<void>("readwrite", (s) => void s.clear(), KEPT)
    },
    putKept: (roomId, memberPk, kept) => run<void>("readwrite", (s) => void s.put(kept, [roomId, memberPk]), KEPT),
    kept: async (roomId, memberPk) => (await run<CachedKept | undefined>("readonly", (s) => s.get([roomId, memberPk]), KEPT)) ?? null,
  }
  return { db, open: openDb }
}

let backing: HistoryDb | null = null
let opening: (() => Promise<IDBDatabase>) | null = null

function db(): HistoryDb {
  if (!backing) {
    if (typeof indexedDB === "undefined") throw new Error("no indexedDB")
    const made = idb()
    backing = made.db
    opening = made.open
  }
  return backing
}

export async function openHistory(): Promise<void> {
  if (typeof indexedDB === "undefined") return
  db()
  try {
    await opening?.()
    markOnce("kiwi:history-open")
  } catch {
    // A failed open resets itself: the channel's first read opens it again and reports its own error.
  }
}

/** Tests substitute a memory database. Pass null to go back to IndexedDB. */
export function useHistoryDb(next: HistoryDb | null): void {
  backing = next
  opening = null
}

export async function rememberRows(roomId: string, memberPk: string, rows: CachedRow[], limit: number): Promise<void> {
  const kept = rows.filter((row) => Number.isSafeInteger(row.seq) && row.seq > 0)
  if (!kept.length) return
  await db().putRows(roomId, memberPk, kept, Math.max(...kept.map((row) => row.seq)) - limit + 1)
}

export const rememberRow = (roomId: string, memberPk: string, row: CachedRow, limit: number): Promise<void> => rememberRows(roomId, memberPk, [row], limit)

/**
 * Messages to paint, and the exclusive seq to stream from. An unusable cache
 * is deleted here, so the next save starts clean.
 */
export interface OpenedCache {
  stored: number
  opened: (Message | Unread)[]
}

export async function openCached(roomId: string, memberPk: string, openRows: OpenRows): Promise<OpenedCache> {
  const stored = await db().rows(roomId, memberPk)
  markOnce("kiwi:cache-read")
  return { stored: stored.length, opened: (await openRows(stored)).filter((m): m is Message | Unread => m !== null) }
}

export async function readCached(
  roomId: string,
  memberPk: string,
  openRows: OpenRows,
  head: number,
  limit: number
): Promise<{ messages: Message[]; unread: number[]; firstSeq: number | undefined; since: number }> {
  return planCached(roomId, memberPk, await openCached(roomId, memberPk, openRows), head, limit)
}

export async function planCached(
  roomId: string,
  memberPk: string,
  { stored, opened }: OpenedCache,
  head: number,
  limit: number
): Promise<{ messages: Message[]; unread: number[]; firstSeq: number | undefined; since: number }> {
  const plan = planReload(
    opened.map((m) => m.seq),
    head,
    limit
  )
  if (!plan.keep.length) {
    if (stored) await db().drop(roomId, memberPk)
  } else {
    // Drop a prefix the window no longer wants, and any seq past the relay head
    // so a later head cannot revive it ahead of the relay.
    await db().trimBelow(roomId, memberPk, plan.keep[0]!)
    await db().trimAbove(roomId, memberPk, plan.keep[plan.keep.length - 1]!)
  }
  const keep = new Set(plan.keep)
  const kept = opened.filter((m) => keep.has(m.seq)).sort((a, b) => a.seq - b.seq)
  return { messages: kept.filter((m): m is Message => !("unread" in m)), unread: kept.filter((m) => "unread" in m).map((m) => m.seq), firstSeq: kept[0]?.seq, since: plan.since }
}

export async function rememberKept(roomId: string, memberPk: string, kept: CachedKept): Promise<void> {
  await db().putKept(roomId, memberPk, kept)
}

export async function readKept(roomId: string, memberPk: string): Promise<CachedKept | null> {
  return db().kept(roomId, memberPk)
}

export async function forgetHistory(roomId: string, memberPk: string): Promise<void> {
  await db().drop(roomId, memberPk)
}

export async function forgetAllHistory(): Promise<void> {
  await db().dropAll()
}
