import { DatabaseSync } from "node:sqlite"

import { newChannelKey } from "@mc/crypto.ts"
import { PROTOCOL_VERSION, type Message } from "@mc/protocol.ts"

import { loadHistory, merge, readMark, saveMessage, setReadMark, unreadCount, viewOf, type Room } from "./channel"
import { SCHEMA, sqliteHistory, type Sql, type SqlValue } from "./history"

function memorySql(): Sql {
  const db = new DatabaseSync(":memory:")
  for (const statement of SCHEMA) db.exec(statement)
  return {
    run: async (statement: string, params: SqlValue[]) => void db.prepare(statement).run(...params),
    all: async <T>(statement: string, params: SqlValue[]) => db.prepare(statement).all(...params) as T[],
  }
}

const key = newChannelKey()
const room: Room = { roomId: "room-1", memberPk: "pk-me", keys: { "1": key } }

const message = (seq: number, from = "ann", kind: Message["kind"] = "msg"): Message => ({
  v: PROTOCOL_VERSION,
  id: `m${seq}`,
  from,
  kind,
  body: `body ${seq}`,
  ts: 1000 + seq,
  seq,
  rts: 1000 + seq,
  sigOk: false,
})

describe("channel store", () => {
  it("shows cached messages after a cold start and asks the relay only for what is new", async () => {
    const sql = memorySql()
    const db = sqliteHistory(sql)
    for (let seq = 1; seq <= 5; seq++) await saveMessage(db, room, 1, message(seq))

    const cold = await loadHistory(sqliteHistory(sql), room, 5)
    expect(cold.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5])
    expect(cold.messages[2]?.body).toBe("body 3")
    expect(cold.since).toBe(5)
  })

  it("keeps only the newest window", async () => {
    const db = sqliteHistory(memorySql())
    for (let seq = 1; seq <= 6; seq++) await saveMessage(db, room, 1, message(seq), 3)
    const cold = await loadHistory(db, room, 6, 3)
    expect(cold.messages.map((m) => m.seq)).toEqual([4, 5, 6])
  })

  it("drops a cache with a hole, or one the relay has not reached", async () => {
    const sql = memorySql()
    const db = sqliteHistory(sql)
    await saveMessage(db, room, 1, message(1))
    await saveMessage(db, room, 1, message(3))
    expect((await loadHistory(db, room, 3)).messages).toEqual([])
    expect(await db.rows(room.roomId, room.memberPk)).toEqual([])
  })

  it("does not open rows without the channel key, and keeps two accounts apart", async () => {
    const sql = memorySql()
    const db = sqliteHistory(sql)
    await saveMessage(db, room, 1, message(1))
    expect((await loadHistory(db, { ...room, keys: {} }, 1)).messages).toEqual([])
    await saveMessage(db, room, 1, message(1))
    expect((await loadHistory(db, { ...room, memberPk: "pk-other" }, 1)).messages).toEqual([])
  })

  it("merges by seq and counts unread: not events, not my own, only past the mark", () => {
    const all = merge([message(1), message(2)], [message(2), message(3, "me"), message(4, "ann", "event"), message(5)])
    expect(all.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5])
    expect(unreadCount(all, 1, "me")).toBe(2)
    expect(unreadCount(all, 5, "me")).toBe(0)
  })

  it("keeps the read mark from going back, per room and member", async () => {
    const sql = memorySql()
    expect(await readMark(sql, room)).toBe(0)
    await setReadMark(sql, room, 7)
    await setReadMark(sql, room, 3)
    expect(await readMark(sql, room)).toBe(7)
    expect(await readMark(sql, { ...room, roomId: "room-2" })).toBe(0)
  })

  it("folds a view with tasks and unread", () => {
    const view = viewOf([message(1), message(2)], [], 0, "me")
    expect(view.unread).toBe(2)
    expect(view.tasks).toEqual([])
  })
})
