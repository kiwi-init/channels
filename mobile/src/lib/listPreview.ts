import { openRows } from "@mc/cache-row.ts"
import type { Message } from "@mc/protocol.ts"
import { excerpt } from "@web/lib/format"

import { readMark } from "./channel"
import type { HistoryDb, Sql } from "./history"

export interface Preview {
  recent: { from: string; text: string } | null
  fresh: boolean
  ts: number | null
}

export interface PreviewSeat {
  roomId: string
  memberPk: string
  me: string
  keys: Record<string, string>
}

const NONE: Preview = { recent: null, fresh: false, ts: null }

function lastChat(messages: readonly Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.kind !== "event") return m
  }
  return undefined
}

export async function previewOf(history: HistoryDb, sql: Sql | null, seat: PreviewSeat): Promise<Preview> {
  const rows = await history.rows(seat.roomId, seat.memberPk).catch(() => [])
  if (!rows.length) return NONE
  const opened = (await openRows(rows, seat.roomId, seat.keys)).filter((m): m is Message => m !== null).sort((a, b) => a.seq - b.seq)
  const last = lastChat(opened)
  if (!last) return NONE
  const mark = sql ? await readMark(sql, { roomId: seat.roomId, memberPk: seat.memberPk, keys: seat.keys }).catch(() => 0) : 0
  const text = last.imgs?.length && last.body === last.imgs.map((img) => img.name).join(", ") ? "Image" : excerpt(last.body, 120)
  return { recent: { from: last.from === seat.me ? "You" : last.from, text }, fresh: last.seq > mark && last.from !== seat.me, ts: last.ts }
}
