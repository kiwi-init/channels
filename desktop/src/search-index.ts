import { Database } from "bun:sqlite";

import type { IndexHit } from "./search-types.ts";

export interface IndexedRow {
  seq: number;
  room: string;
  from: string;
  text: string;
}

export interface IndexStamp {
  rules: number;
  ops: number;
  through: number;
}

const SCHEMA = [
  "CREATE VIRTUAL TABLE IF NOT EXISTS hits USING fts5(body, who, room UNINDEXED, tokenize = 'unicode61 remove_diacritics 2')",
  "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
];

const MAX_TERMS = 12;

function matchQuery(query: string): string | null {
  const terms = query
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 0)
    .slice(0, MAX_TERMS);
  return terms.length ? terms.map((t) => `"${t}"*`).join(" ") : null;
}

export class SearchIndex {
  private constructor(private readonly db: Database) {
    for (const sql of SCHEMA) db.run(sql);
  }

  static empty(): SearchIndex {
    return new SearchIndex(new Database(":memory:"));
  }

  static from(bytes: Uint8Array<ArrayBuffer>): SearchIndex | null {
    try {
      const index = new SearchIndex(Database.deserialize(bytes));
      return index.stamp() ? index : (index.close(), null);
    } catch {
      // A file that doesn't open as an index is rebuilt from the archive instead.
      return null;
    }
  }

  stamp(): IndexStamp | null {
    const raw = this.get("stamp");
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<IndexStamp>;
    return Number.isSafeInteger(s.rules) && Number.isSafeInteger(s.ops) && Number.isSafeInteger(s.through) ? { rules: s.rules!, ops: s.ops!, through: s.through! } : null;
  }

  setStamp(stamp: IndexStamp): void {
    this.set("stamp", JSON.stringify(stamp));
  }

  get(k: string): string | null {
    return this.db.query<{ v: string }, [string]>("SELECT v FROM meta WHERE k = ?").get(k)?.v ?? null;
  }

  set(k: string, v: string): void {
    this.db.run("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", [k, v]);
  }

  put(rows: readonly IndexedRow[]): void {
    const drop = this.db.prepare("DELETE FROM hits WHERE rowid = ?");
    const add = this.db.prepare("INSERT INTO hits (rowid, body, who, room) VALUES (?, ?, ?, ?)");
    this.db.transaction(() => {
      for (const r of rows) {
        drop.run(r.seq);
        if (r.text.trim()) add.run(r.seq, r.text, r.from, r.room);
      }
    })();
  }

  drop(seqs: readonly number[]): void {
    const drop = this.db.prepare("DELETE FROM hits WHERE rowid = ?");
    this.db.transaction(() => {
      for (const seq of seqs) drop.run(seq);
    })();
  }

  retext(seq: number, text: string): void {
    if (text.trim()) this.db.run("UPDATE hits SET body = ? WHERE rowid = ?", [text, seq]);
    else this.drop([seq]);
  }

  dropRoom(room: string): void {
    this.db.run("DELETE FROM hits WHERE room = ?", [room]);
  }

  search(query: string, rooms: readonly string[], limit: number): IndexHit[] {
    const match = matchQuery(query);
    if (!match || !rooms.length) return [];
    const marks = rooms.map(() => "?").join(", ");
    return this.db
      .query<{ seq: number; rank: number }, (string | number)[]>(`SELECT rowid AS seq, rank FROM hits WHERE hits MATCH ? AND room IN (${marks}) ORDER BY rank, rowid DESC LIMIT ?`)
      .all(match, ...rooms, Math.max(1, Math.min(limit, 500)));
  }

  rows(): { seq: number; room: string; text: string }[] {
    return this.db.query<{ seq: number; room: string; text: string }, []>("SELECT rowid AS seq, room, body AS text FROM hits ORDER BY rowid").all();
  }

  count(): number {
    return this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM hits").get()?.n ?? 0;
  }

  bytes(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.db.serialize());
  }

  close(): void {
    this.db.close();
  }
}
