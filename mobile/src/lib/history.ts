import type { CachedRow } from "@mc/cache-row.ts"
import type { Message } from "@mc/protocol.ts"
import { planReload } from "@web/lib/history-plan"

export type { CachedRow }
export type OpenRows = (rows: CachedRow[]) => Promise<(Message | null)[]>
export type SqlValue = string | number | null

export interface Sql {
  run(sql: string, params: SqlValue[]): Promise<void>
  all<T>(sql: string, params: SqlValue[]): Promise<T[]>
}

export interface HistoryDb {
  put(roomId: string, memberPk: string, row: CachedRow): Promise<void>
  rows(roomId: string, memberPk: string): Promise<CachedRow[]>
  trimBelow(roomId: string, memberPk: string, oldestKept: number): Promise<void>
  trimAbove(roomId: string, memberPk: string, newestKept: number): Promise<void>
  drop(roomId: string, memberPk: string): Promise<void>
  dropAll(): Promise<void>
}

export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS rows (room TEXT NOT NULL, member TEXT NOT NULL, seq INTEGER NOT NULL, rts INTEGER, e INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, PRIMARY KEY (room, member, seq)) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS marks (room TEXT NOT NULL, member TEXT NOT NULL, mark INTEGER NOT NULL, PRIMARY KEY (room, member)) WITHOUT ROWID",
]

interface StoredRow {
  seq: number
  rts: number | null
  e: number
  iv: string
  ct: string
}

export function sqliteHistory(sql: Sql): HistoryDb {
  return {
    put: (room, member, row) =>
      sql.run("INSERT OR REPLACE INTO rows (room, member, seq, rts, e, iv, ct) VALUES (?, ?, ?, ?, ?, ?, ?)", [room, member, row.seq, row.rts ?? null, row.e, row.iv, row.ct]),
    rows: async (room, member) => {
      const stored = await sql.all<StoredRow>("SELECT seq, rts, e, iv, ct FROM rows WHERE room = ? AND member = ? ORDER BY seq", [room, member])
      return stored.map(({ rts, ...row }) => (rts === null ? row : { ...row, rts }))
    },
    trimBelow: (room, member, oldestKept) => sql.run("DELETE FROM rows WHERE room = ? AND member = ? AND seq < ?", [room, member, oldestKept]),
    trimAbove: (room, member, newestKept) => sql.run("DELETE FROM rows WHERE room = ? AND member = ? AND seq > ?", [room, member, newestKept]),
    drop: async (room, member) => {
      await sql.run("DELETE FROM rows WHERE room = ? AND member = ?", [room, member])
      await sql.run("DELETE FROM marks WHERE room = ? AND member = ?", [room, member])
    },
    dropAll: async () => {
      await sql.run("DELETE FROM rows", [])
      await sql.run("DELETE FROM marks", [])
    },
  }
}

export async function rememberRow(db: HistoryDb, roomId: string, memberPk: string, row: CachedRow, limit: number): Promise<void> {
  if (!Number.isSafeInteger(row.seq) || row.seq <= 0) return
  await db.put(roomId, memberPk, row)
  await db.trimBelow(roomId, memberPk, row.seq - limit + 1)
}

export async function readCached(db: HistoryDb, roomId: string, memberPk: string, openRows: OpenRows, head: number, limit: number): Promise<{ messages: Message[]; since: number }> {
  const stored = await db.rows(roomId, memberPk)
  const opened = (await openRows(stored)).filter((m): m is Message => m !== null)
  const plan = planReload(
    opened.map((m) => m.seq),
    head,
    limit
  )
  if (!plan.keep.length) {
    if (stored.length) await db.drop(roomId, memberPk)
  } else {
    await db.trimBelow(roomId, memberPk, plan.keep[0]!)
    await db.trimAbove(roomId, memberPk, plan.keep[plan.keep.length - 1]!)
  }
  const keep = new Set(plan.keep)
  const messages = opened.filter((m) => keep.has(m.seq)).sort((a, b) => a.seq - b.seq)
  return { messages, since: plan.since }
}
