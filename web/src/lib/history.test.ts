// The sealed history cache: ciphertext at rest, one member's rows stay theirs,
// and a hole or a seq past the relay head is thrown out instead of shown.

import { afterAll, beforeEach, expect, test } from "bun:test"
import { b64url, seal } from "@kiwi/core/crypto.ts"
import { generateIdentity, sign } from "@kiwi/core/identity.ts"
import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"
import { openKept, openRow, openRows, packKept, packRow, packEnvelope } from "@kiwi/core/cache-row.ts"
import {
  forgetAllHistory,
  forgetHistory,
  openCached,
  openHistory,
  readCached,
  readKept,
  rememberKept,
  rememberRow,
  rememberRows,
  useHistoryDb,
  type CachedKept,
  type CachedRow,
  type HistoryDb,
} from "./history.ts"

const SENTINEL = "SENTINEL-plain-text-should-not-rest"
const ROOM = "a".repeat(32)
const ROOM_B = "b".repeat(32)
const PK_A = "pk-account-a"
const PK_B = "pk-account-b"

let store: HistoryDb
let key: string

function memoryDb(): HistoryDb {
  const rows = new Map<string, CachedRow>()
  const kept = new Map<string, CachedKept>()
  const id = (room: string, pk: string, seq: number) => `${room}\0${pk}\0${seq}`
  const list = (room: string, pk: string) =>
    [...rows.entries()]
      .filter(([k]) => k.startsWith(`${room}\0${pk}\0`))
      .map(([, row]) => row)
      .sort((a, b) => a.seq - b.seq)
  return {
    put: async (room, pk, row) => {
      rows.set(id(room, pk, row.seq), row)
    },
    putRows: async (room, pk, batch, oldest) => {
      for (const row of batch) rows.set(id(room, pk, row.seq), row)
      for (const row of list(room, pk)) if (row.seq < oldest) rows.delete(id(room, pk, row.seq))
    },
    rows: async (room, pk) => list(room, pk),
    trimBelow: async (room, pk, oldest) => {
      for (const row of list(room, pk)) if (row.seq < oldest) rows.delete(id(room, pk, row.seq))
    },
    trimAbove: async (room, pk, newest) => {
      for (const row of list(room, pk)) if (row.seq > newest) rows.delete(id(room, pk, row.seq))
    },
    drop: async (room, pk) => {
      for (const row of list(room, pk)) rows.delete(id(room, pk, row.seq))
      kept.delete(`${room}\0${pk}`)
    },
    dropAll: async () => {
      rows.clear()
      kept.clear()
    },
    putKept: async (room, pk, k) => void kept.set(`${room}\0${pk}`, k),
    kept: async (room, pk) => kept.get(`${room}\0${pk}`) ?? null,
  }
}

function msg(seq: number, body: string): Message {
  return {
    v: PROTOCOL_VERSION,
    id: `id-${seq}`,
    from: "Ada",
    kind: "msg",
    body,
    ts: 1_700_000_000_000 + seq,
    seq,
    rts: 1_800_000_000_000 + seq,
    sigOk: true,
  }
}

async function rememberMessage(room: string, pk: string, epoch: number, k: string, m: Message, limit: number): Promise<void> {
  await rememberRow(room, pk, await packRow(k, room, epoch, m), limit)
}

beforeEach(() => {
  store = memoryDb()
  useHistoryDb(store)
  key = b64url(crypto.getRandomValues(new Uint8Array(32)))
})

afterAll(() => {
  useHistoryDb(null)
})

test("a stored row is ciphertext, and a changed seq does not open", async () => {
  const row = await packRow(key, ROOM, 1, msg(4, SENTINEL))
  expect(JSON.stringify(row).includes(SENTINEL)).toBe(false)
  expect(row).toEqual({ seq: 4, rts: 1_800_000_000_004, e: 1, iv: row.iv, ct: row.ct })

  const opened = await openRow(row, ROOM, { "1": key })
  expect(opened?.body).toBe(SENTINEL)
  expect(opened?.seq).toBe(4)
  expect(opened?.sigOk).toBe(false)

  expect(await openRow({ ...row, seq: 5 }, ROOM, { "1": key })).toBeNull()
  expect(await openRow(row, ROOM, { "1": b64url(crypto.getRandomValues(new Uint8Array(32))) })).toBeNull()
})

test("a signed message still verifies after a cache round trip", async () => {
  const id = await generateIdentity("Ada")
  const signed = await sign(id, {
    v: PROTOCOL_VERSION,
    id: "id-1",
    from: "Ada",
    kind: "msg" as const,
    body: "signed",
    ts: 10,
  })
  await rememberMessage(ROOM, PK_A, 1, key, { ...signed, seq: 1, rts: 20, sigOk: true }, 10)
  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, { "1": key }), 1, 10)
  expect(out.messages.map((m) => ({ body: m.body, seq: m.seq, sigOk: m.sigOk, pk: m.pk }))).toEqual([{ body: "signed", seq: 1, sigOk: true, pk: id.pk }])
})

test("two members and two rooms do not read each other's rows", async () => {
  const keys = { "1": key }
  await rememberMessage(ROOM, PK_A, 1, key, msg(1, "a-in-room"), 10)
  await rememberMessage(ROOM, PK_B, 1, key, msg(1, "b-in-room"), 10)
  await rememberMessage(ROOM_B, PK_A, 1, key, msg(1, "a-in-other"), 10)

  const a = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 1, 10)
  expect(a.messages.map((m) => m.body)).toEqual(["a-in-room"])
  expect(a.since).toBe(1)

  const b = await readCached(ROOM, PK_B, (rows) => openRows(rows, ROOM, keys), 1, 10)
  expect(b.messages.map((m) => m.body)).toEqual(["b-in-room"])
})

test("a row that does not open is a hole, so the cache is dropped", async () => {
  const keys = { "1": key }
  await rememberMessage(ROOM, PK_A, 1, key, msg(1, "one"), 10)
  await rememberMessage(ROOM, PK_A, 1, key, msg(2, "two"), 10)
  await rememberMessage(ROOM, PK_A, 1, key, msg(3, "three"), 10)
  const rows = await store.rows(ROOM, PK_A)
  const broken = rows.find((r) => r.seq === 2)!
  await store.put(ROOM, PK_A, { ...broken, ct: "not-ciphertext" })

  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 3, 10)
  expect(out).toEqual({ messages: [], unread: [], firstSeq: undefined, since: 0 })
  expect(await store.rows(ROOM, PK_A)).toEqual([])
})

test("a hole drops the cache and asks for the usual window", async () => {
  const keys = { "1": key }
  await rememberMessage(ROOM, PK_A, 1, key, msg(1, "one"), 10)
  await rememberMessage(ROOM, PK_A, 1, key, msg(3, "three"), 10)

  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 3, 10)
  expect(out).toEqual({ messages: [], unread: [], firstSeq: undefined, since: 0 })
  expect(await store.rows(ROOM, PK_A)).toEqual([])
})

test("a seq past the relay head is dropped and cannot return later", async () => {
  const keys = { "1": key }
  await rememberMessage(ROOM, PK_A, 1, key, msg(1, "one"), 10)
  await rememberMessage(ROOM, PK_A, 1, key, msg(2, "two"), 10)
  await rememberMessage(ROOM, PK_A, 1, key, msg(9, "nine"), 10)

  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 2, 10)
  expect(out.messages.map((m) => m.seq)).toEqual([1, 2])
  expect(out.messages.map((m) => m.body)).toEqual(["one", "two"])
  expect(out.since).toBe(2)
  expect((await store.rows(ROOM, PK_A)).map((r) => r.seq)).toEqual([1, 2])
})

test("only the newest limit messages stay, in seq order", async () => {
  const keys = { "1": key }
  for (let seq = 1; seq <= 5; seq++) await rememberMessage(ROOM, PK_A, 1, key, msg(seq, `m${seq}`), 3)

  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 5, 3)
  expect(out.messages.map((m) => m.seq)).toEqual([3, 4, 5])
  expect(out.since).toBe(5)
})

test("a batch of messages is one write that keeps only the newest limit", async () => {
  const keys = { "1": key }
  let writes = 0
  const counted = { ...store, putRows: (...a: Parameters<HistoryDb["putRows"]>) => (writes++, store.putRows(...a)) }
  useHistoryDb(counted)
  await rememberRows(ROOM, PK_A, await Promise.all([1, 2, 3, 4, 5].map((seq) => packRow(key, ROOM, 1, msg(seq, `m${seq}`)))), 3)
  await rememberRows(ROOM, PK_A, [], 3)
  expect(writes).toBe(1)
  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 5, 3)
  expect(out.messages.map((m) => m.seq)).toEqual([3, 4, 5])
})

test("leave drops one member; sign-out drops every row", async () => {
  const keys = { "1": key }
  await rememberMessage(ROOM, PK_A, 1, key, msg(1, "a"), 10)
  await rememberMessage(ROOM, PK_B, 1, key, msg(1, "b"), 10)

  await forgetHistory(ROOM, PK_A)
  expect((await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 1, 10)).messages).toEqual([])
  expect((await readCached(ROOM, PK_B, (rows) => openRows(rows, ROOM, keys), 1, 10)).messages.map((m) => m.body)).toEqual(["b"])

  await forgetAllHistory()
  expect(await store.rows(ROOM, PK_B)).toEqual([])
})

test("a row sealed before the keys left the window still opens", async () => {
  const { seq, rts, sigOk, ...payload } = msg(7, "from an older app")
  void sigOk
  const sealed = await seal(key, ROOM, { seq, msg: payload })
  const old: CachedRow = { seq, rts, e: 1, iv: sealed.iv, ct: sealed.ct }
  await store.put(ROOM, PK_A, old)
  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, { "1": key }), 7, 10)
  expect(out.messages.map((m) => m.body)).toEqual(["from an older app"])
})

async function sealedPayload(k: string, payload: object): Promise<{ iv: string; ct: string }> {
  return seal(k, ROOM, payload)
}

test("a message this build can't read is kept as an unread row: no hole, so the cache survives", async () => {
  const keys = { "1": key }
  await rememberMessage(ROOM, PK_A, 1, key, msg(1, "one"), 10)
  const malformed = await sealedPayload(key, { ...msg(2, ""), kind: "event", ev: { op: "task.add" } })
  await rememberRow(ROOM, PK_A, await packEnvelope(key, ROOM, 1, { seq: 2, ts: 30, e: 1, ...malformed }), 10)
  await rememberMessage(ROOM, PK_A, 1, key, msg(3, "three"), 10)

  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 3, 10)
  expect(out.messages.map((m) => m.body)).toEqual(["one", "three"])
  expect(out.unread).toEqual([2])
  expect(out.firstSeq).toBe(1)
  expect(out.since).toBe(3)
  expect((await store.rows(ROOM, PK_A)).map((r) => r.seq)).toEqual([1, 2, 3])
})

test("an unread row opens as the message once the build can read it, and a moved one doesn't open", async () => {
  const readable = await sealedPayload(key, { v: PROTOCOL_VERSION, id: "id-7", from: "Ada", kind: "msg", body: SENTINEL, ts: 7 })
  const row = await packEnvelope(key, ROOM, 1, { seq: 7, ts: 70, e: 1, ...readable })
  expect(JSON.stringify(row).includes(SENTINEL)).toBe(false)
  expect(await openRow(row, ROOM, { "1": key })).toMatchObject({ body: SENTINEL, seq: 7, rts: 70 })

  const unreadable = await sealedPayload(key, { v: PROTOCOL_VERSION, id: "id-8", from: "Ada", kind: "event", body: "", ts: 8, ev: { op: "task.add" } })
  const later = await packEnvelope(key, ROOM, 1, { seq: 8, ts: 80, e: 1, ...unreadable })
  expect(await openRow(later, ROOM, { "1": key })).toEqual({ seq: 8, unread: true })
  expect(await openRow({ ...later, seq: 9 }, ROOM, { "1": key })).toBeNull()
})

test("a channel's kept state rests sealed, opens only with its channel's key, and leaves with the member", async () => {
  const keys = { "1": key }
  const state = { roster: [{ name: SENTINEL, pk: "pk" }], base: null }
  await rememberKept(ROOM, PK_A, await packKept(key, ROOM, 1, state))
  await rememberKept(ROOM, PK_B, await packKept(key, ROOM, 1, { roster: [], base: null }))
  const sealed = await readKept(ROOM, PK_A)
  expect(JSON.stringify(sealed)).not.toContain(SENTINEL)
  expect(await openKept(sealed, ROOM, keys)).toEqual(state)
  expect(await openKept(sealed, ROOM_B, keys)).toBeNull()
  expect(await openKept(sealed, ROOM, { "1": b64url(crypto.getRandomValues(new Uint8Array(32))) })).toBeNull()

  await forgetHistory(ROOM, PK_A)
  expect(await readKept(ROOM, PK_A)).toBeNull()
  expect(await readKept(ROOM, PK_B)).not.toBeNull()
  await forgetAllHistory()
  expect(await readKept(ROOM, PK_B)).toBeNull()
})

test("a kept state never opens as a message row, and a row never opens as a kept state", async () => {
  const keys = { "1": key }
  const kept = await packKept(key, ROOM, 1, { roster: [], base: null })
  expect(await openRow({ seq: 1, ...kept }, ROOM, keys)).toBeNull()
  const row = await packRow(key, ROOM, 1, msg(1, "a"))
  expect(await openKept({ e: row.e, iv: row.iv, ct: row.ct }, ROOM, keys)).toBeNull()
})

function fakeIndexedDB(failures: number): { opens: string[]; restore: () => void } {
  const opens: string[] = []
  let left = failures
  const tx = {
    oncomplete: null as (() => void) | null,
    onerror: null,
    onabort: null,
    objectStore: () => ({
      getAll: () => {
        queueMicrotask(() => tx.oncomplete?.())
        return { result: [] }
      },
    }),
  }
  const database = { objectStoreNames: { contains: () => true }, transaction: () => tx, onversionchange: null, onclose: null }
  const factory = {
    open: (name: string, version: number) => {
      opens.push(`${name} v${version}`)
      const fail = left > 0
      left -= 1
      const req = {
        result: database,
        error: fail ? new DOMException("blocked", "UnknownError") : null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null,
      }
      queueMicrotask(() => (fail ? req.onerror?.() : req.onsuccess?.()))
      return req
    },
  }
  performance.clearMarks("kiwi:history-open")
  Object.defineProperty(globalThis, "indexedDB", { value: factory as unknown as IDBFactory, configurable: true })
  Object.defineProperty(globalThis, "IDBKeyRange", { value: { bound: () => ({}) } as unknown as typeof IDBKeyRange, configurable: true })
  return {
    opens,
    restore: () => {
      Reflect.deleteProperty(globalThis, "indexedDB")
      Reflect.deleteProperty(globalThis, "IDBKeyRange")
      performance.clearMarks("kiwi:history-open")
    },
  }
}

const noRows = async (rows: CachedRow[]) => rows.map(() => null)

test("openHistory opens the history database at page start, once, and the channel's first read reuses that connection (T2373)", async () => {
  const fake = fakeIndexedDB(0)
  useHistoryDb(null)
  try {
    const opened = openHistory()
    expect(fake.opens).toEqual(["mc.history v2"])
    await opened
    expect(performance.getEntriesByName("kiwi:history-open", "mark")).toHaveLength(1)
    expect(await openCached(ROOM, PK_A, noRows)).toEqual({ stored: 0, opened: [] })
    expect(fake.opens).toEqual(["mc.history v2"])
  } finally {
    fake.restore()
    useHistoryDb(store)
  }
})

test("a failed open at page start stays quiet and marks nothing, and the channel's first read opens the database again (T2373)", async () => {
  const fake = fakeIndexedDB(1)
  useHistoryDb(null)
  try {
    await expect(openHistory()).resolves.toBeUndefined()
    expect(performance.getEntriesByName("kiwi:history-open", "mark")).toHaveLength(0)
    expect(await openCached(ROOM, PK_A, noRows)).toEqual({ stored: 0, opened: [] })
    expect(fake.opens).toEqual(["mc.history v2", "mc.history v2"])
  } finally {
    fake.restore()
    useHistoryDb(store)
  }
})

test("openHistory without IndexedDB does nothing (T2373)", async () => {
  useHistoryDb(null)
  await expect(openHistory()).resolves.toBeUndefined()
  useHistoryDb(store)
})
