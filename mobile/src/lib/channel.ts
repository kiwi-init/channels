import { openRows as openCachedRows, packRow } from "@mc/cache-row.ts"
import type { Message } from "@mc/protocol.ts"
import { fold, type ChannelState, type Roster, type Task } from "@mc/state.ts"

import { readCached, rememberRow, type HistoryDb, type Sql } from "./history"

const WINDOW = 1000

export interface Room {
  roomId: string
  memberPk: string
  keys: Record<string, string>
}

export interface ChannelView {
  state: ChannelState
  tasks: Task[]
  unread: number
}

export async function loadHistory(db: HistoryDb, room: Room, head: number, limit = WINDOW): Promise<{ messages: Message[]; since: number }> {
  return readCached(db, room.roomId, room.memberPk, (rows) => openCachedRows(rows, room.roomId, room.keys), head, limit)
}

export async function saveMessage(db: HistoryDb, room: Room, epoch: number, message: Message, limit = WINDOW): Promise<void> {
  const key = room.keys[String(epoch)]
  if (!key) return
  await rememberRow(db, room.roomId, room.memberPk, await packRow(key, room.roomId, epoch, message), limit)
}

export function merge(messages: readonly Message[], incoming: readonly Message[]): Message[] {
  const bySeq = new Map<number, Message>()
  for (const m of messages) bySeq.set(m.seq, m)
  for (const m of incoming) bySeq.set(m.seq, m)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

export function unreadCount(messages: readonly Message[], mark: number, self: string): number {
  return messages.filter((m) => m.seq > mark && m.kind !== "event" && m.from !== self).length
}

export function viewOf(messages: readonly Message[], roster: Roster, mark: number, self: string, now = Date.now()): ChannelView {
  const state = fold([...messages], roster, now)
  const tasks = [...state.tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  return { state, tasks, unread: unreadCount(messages, mark, self) }
}

export async function readMark(sql: Sql, room: Room): Promise<number> {
  const found = await sql.all<{ mark: number }>("SELECT mark FROM marks WHERE room = ? AND member = ?", [room.roomId, room.memberPk])
  return found[0]?.mark ?? 0
}

export async function setReadMark(sql: Sql, room: Room, seq: number): Promise<void> {
  if (!Number.isSafeInteger(seq) || seq < 0) return
  await sql.run("INSERT INTO marks (room, member, mark) VALUES (?, ?, ?) ON CONFLICT (room, member) DO UPDATE SET mark = MAX(mark, excluded.mark)", [room.roomId, room.memberPk, seq])
}
