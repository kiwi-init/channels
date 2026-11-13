import { Database } from "bun:sqlite";
import { existsSync, realpathSync } from "node:fs";

export function realDir(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    // A folder that can't be resolved is matched as given.
    return dir;
  }
}

export function withDb<T>(file: string, read: (db: Database) => T, none: T): T {
  if (!existsSync(file)) return none;
  let db: Database | null = null;
  try {
    db = new Database(file, { readonly: true });
    return read(db);
  } catch {
    // ZCode may hold the database mid-write or change its schema: nothing is read this time.
    return none;
  } finally {
    db?.close();
  }
}
