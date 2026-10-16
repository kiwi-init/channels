import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite"

import { SCHEMA, sqliteHistory, type HistoryDb, type Sql, type SqlValue } from "./history"

let opened: Promise<SQLiteDatabase> | null = null

function database(): Promise<SQLiteDatabase> {
  opened ??= openDatabaseAsync("kiwi.db").then(async (db) => {
    for (const statement of SCHEMA) await db.execAsync(statement)
    return db
  })
  return opened
}

export const sql: Sql = {
  run: async (statement: string, params: SqlValue[]) => {
    await (await database()).runAsync(statement, params)
  },
  all: async <T>(statement: string, params: SqlValue[]) => (await database()).getAllAsync<T>(statement, params),
}

export const history: HistoryDb = sqliteHistory(sql)
