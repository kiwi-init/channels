import { DatabaseSync } from "node:sqlite"

import { newChannelKey } from "@mc/crypto.ts"
import { PROTOCOL_VERSION, type Message } from "@mc/protocol.ts"

import { saveMessage, setReadMark, type Room } from "./channel"
import { SCHEMA, sqliteHistory, type Sql, type SqlValue } from "./history"
import { previewOf } from "./listPreview"

function memorySql(): Sql {
  const db = new DatabaseSync(":memory:")
  for (const statement of SCHEMA) db.exec(statement)
  return {
    run: async (statement: string, params: SqlValue[]) => void db.prepare(statement).run(...params),
    all: async <T>(statement: string, params: SqlValue[]) => db.prepare(statement).all(...params) as T[],
  }
}

const room: Room = { roomId: "room-1", memberPk: "pk-me", keys: { "1": newChannelKey() } }
const seat = { ...room, me: "me" }

const message = (seq: number, from: string, kind: Message["kind"] = "msg", body = `body ${seq}`): Message => ({
  v: PROTOCOL_VERSION,
  id: `m${seq}`,
  from,
  kind,
  body,
  ts: 1000 + seq,
  seq,
  rts: 1000 + seq,
  sigOk: false,
})

describe("previewOf", () => {
  it("is empty for a channel nothing was cached for", async () => {
    expect(await previewOf(sqliteHistory(memorySql()), null, seat)).toEqual({ recent: null, fresh: false, ts: null })
  })

  it("shows the newest message that is not an event, as 'You' for mine, and fresh when unread", async () => {
    const sql = memorySql()
    const db = sqliteHistory(sql)
    await saveMessage(db, room, 1, message(1, "ann"))
    await saveMessage(db, room, 1, message(2, "ann", "event"))
    expect(await previewOf(db, sql, seat)).toMatchObject({ recent: { from: "ann", text: "body 1" }, fresh: true })
    await saveMessage(db, room, 1, message(3, "me"))
    expect(await previewOf(db, sql, seat)).toMatchObject({ recent: { from: "You", text: "body 3" }, fresh: false })
  })

  it("is not fresh once the read mark has caught up, and names an image-only message", async () => {
    const sql = memorySql()
    const db = sqliteHistory(sql)
    await saveMessage(db, room, 1, { ...message(1, "ann", "msg", "pic.png"), imgs: [{ name: "pic.png", mime: "image/png", data: "AA==" }] })
    expect(await previewOf(db, sql, seat)).toMatchObject({ recent: { text: "Image" }, fresh: true })
    await setReadMark(sql, room, 1)
    expect((await previewOf(db, sql, seat)).fresh).toBe(false)
  })
})
