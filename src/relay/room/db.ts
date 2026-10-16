import * as Context from "effect/Context";
import { b64url, fromB64url } from "../../crypto.ts";
import { PAGE_LIMIT, type Envelope, type ReadMark } from "../../protocol.ts";
import type { Policy } from "../policy.ts";
import type { DirectoryUpdate } from "./directory.ts";
import { utcDay } from "./limits.ts";
import type { RequestBody } from "./requests.ts";

export type SqlParam = string | number | null | Uint8Array;

export interface Sql {
  run(query: string, ...params: SqlParam[]): void;
  all<T>(query: string, ...params: SqlParam[]): T[];
}

type Stored = string | Uint8Array | ArrayBuffer;

const CT_CHARS = "CASE WHEN typeof(ct) = 'blob' THEN (LENGTH(ct) * 4 + 2) / 3 ELSE LENGTH(ct) END";

function packed(s: string): string | Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) return s;
  const bytes = fromB64url(s);
  return b64url(bytes) === s ? bytes : s;
}

function unpacked(v: Stored): string {
  return typeof v === "string" ? v : b64url(v instanceof Uint8Array ? v : new Uint8Array(v));
}

const DROP_BATCH = 64;

const READS_TABLE = "CREATE TABLE reads (pk TEXT PRIMARY KEY, seq INTEGER NOT NULL, at INTEGER NOT NULL)";

const REQUEST_COLUMNS = [
  ["kind", "TEXT NOT NULL DEFAULT 'agent'"],
  ["sponsor_user", "TEXT"],
  ["sponsor_name", "TEXT"],
  ["received", "INTEGER"],
  ["sponsor_req", "TEXT"],
  ["commit_to", "TEXT"],
  ["owner_nonce", "TEXT"],
  ["reveal", "TEXT"],
] as const;

interface Counters {
  bytes: number;
  day: string;
  n: number;
  head?: number;
}

const migrated = new WeakSet<Sql>();

interface Warm {
  exists: boolean | null;
  meta: Map<string, string | null>;
  head: number | null;
  members: Map<string, { active: boolean; readOnly: boolean } | null>;
  reads: Map<string, number>;
}

const warmRooms = new WeakMap<Sql, Warm>();

type Revised = "roster" | "info";

const coldRoom = (): Warm => ({ exists: null, meta: new Map(), head: null, members: new Map(), reads: new Map() });

export function forgetRoom(sql: Sql): void {
  warmRooms.delete(sql);
  migrated.delete(sql);
}

export class RoomDb {
  constructor(
    readonly sql: Sql,
    readonly roomId: string,
  ) {
    if (!migrated.has(sql) && this.exists() && !this.isLegacy()) {
      this.migrate();
      migrated.add(sql);
    }
  }

  private get warm(): Warm {
    let w = warmRooms.get(this.sql);
    if (!w) warmRooms.set(this.sql, (w = coldRoom()));
    return w;
  }

  exists(): boolean {
    const w = this.warm;
    w.exists ??= this.sql.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").length > 0;
    return w.exists;
  }

  isLegacy(): boolean {
    return this.exists() && !this.get("owner_pk");
  }

  init(): void {
    warmRooms.set(this.sql, { ...coldRoom(), exists: true, head: 0 });
    this.sql.run("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    this.sql.run("CREATE TABLE msgs (seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, e INTEGER NOT NULL)");
    this.sql.run(
      "CREATE TABLE members (pk TEXT PRIMARY KEY, xpk TEXT NOT NULL, rec TEXT NOT NULL, rec_e INTEGER NOT NULL, since INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, read_only INTEGER NOT NULL DEFAULT 0, admits_until INTEGER, admitted_by TEXT)",
    );
    this.sql.run("CREATE TABLE keys (pk TEXT NOT NULL, e INTEGER NOT NULL, wrapped TEXT NOT NULL, PRIMARY KEY (pk, e))");
    this.sql.run(
      `CREATE TABLE requests (id TEXT PRIMARY KEY, pk TEXT NOT NULL UNIQUE, xpk TEXT NOT NULL, box TEXT NOT NULL, sig TEXT NOT NULL, ts INTEGER NOT NULL, status TEXT NOT NULL, ${REQUEST_COLUMNS.map(([col, def]) => `${col} ${def}`).join(", ")})`,
    );
    this.sql.run(READS_TABLE);
  }

  migrate(): void {
    if (migrated.has(this.sql)) return;
    const memberCols = new Set(this.sql.all<{ name: string }>("PRAGMA table_info(members)").map((c) => c.name));
    if (!memberCols.has("read_only")) this.sql.run("ALTER TABLE members ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0");
    if (!memberCols.has("admits_until")) this.sql.run("ALTER TABLE members ADD COLUMN admits_until INTEGER");
    if (!memberCols.has("admitted_by")) this.sql.run("ALTER TABLE members ADD COLUMN admitted_by TEXT");
    if (!memberCols.has("gone")) this.sql.run("ALTER TABLE members ADD COLUMN gone TEXT");
    const cols = new Set(this.sql.all<{ name: string }>("PRAGMA table_info(requests)").map((c) => c.name));
    for (const [col, def] of REQUEST_COLUMNS) {
      if (!cols.has(col)) this.sql.run(`ALTER TABLE requests ADD COLUMN ${col} ${def}`);
    }
    this.sql.run(READS_TABLE.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
    migrated.add(this.sql);
  }

  reads(): ReadMark[] {
    return this.sql.all<ReadMark>("SELECT r.pk AS pk, r.seq AS seq, r.at AS at FROM reads r JOIN members m ON m.pk = r.pk AND m.active = 1");
  }

  get(k: string): string | undefined {
    const meta = this.warm.meta;
    if (!meta.has(k)) meta.set(k, this.sql.all<{ v: string }>("SELECT v FROM meta WHERE k = ?", k)[0]?.v ?? null);
    return meta.get(k) ?? undefined;
  }

  set(k: string, v: string | number): void {
    this.sql.run("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", k, String(v));
    this.warm.meta.set(k, String(v));
  }

  changed(what: Revised): void {
    this.set(`${what}_rev`, crypto.randomUUID().replaceAll("-", "").slice(0, 16));
  }

  etag(what: Revised): string {
    return `"${what}-${this.get(`${what}_rev`) ?? "0"}"`;
  }

  ownerUser(): string | undefined {
    return this.get("owner_user");
  }

  private member(pk: string): { active: boolean; readOnly: boolean } | null {
    const members = this.warm.members;
    if (!members.has(pk)) {
      const row = this.sql.all<{ active: number; read_only: number }>("SELECT active, read_only FROM members WHERE pk = ?", pk)[0];
      members.set(pk, row ? { active: row.active === 1, readOnly: row.read_only === 1 } : null);
    }
    return members.get(pk) ?? null;
  }

  isMember(pk: string): boolean {
    return this.member(pk)?.active === true;
  }

  isReadOnly(pk: string): boolean {
    return this.member(pk)?.readOnly === true;
  }

  membersChanged(pk: string): void {
    this.warm.members.delete(pk);
    this.warm.reads.delete(pk);
  }

  head(): number {
    const w = this.warm;
    w.head ??= Math.max(this.sql.all<{ s: number | null }>("SELECT MAX(seq) AS s FROM msgs")[0]?.s ?? 0, this.counters()?.head ?? 0);
    return w.head;
  }

  insert(seq: number, ts: number, iv: string, ct: string, e: number): void {
    this.sql.run("INSERT INTO msgs (seq, ts, iv, ct, e) VALUES (?, ?, ?, ?, ?)", seq, ts, packed(iv), packed(ct), e);
    this.warm.head = seq;
  }

  readThrough(pk: string): number {
    const reads = this.warm.reads;
    if (!reads.has(pk)) reads.set(pk, this.sql.all<{ seq: number }>("SELECT seq FROM reads WHERE pk = ?", pk)[0]?.seq ?? 0);
    return reads.get(pk) ?? 0;
  }

  setReadThrough(pk: string, seq: number, at: number): void {
    this.sql.run("INSERT INTO reads (pk, seq, at) VALUES (?, ?, ?) ON CONFLICT (pk) DO UPDATE SET seq = excluded.seq, at = excluded.at", pk, seq, at);
    this.warm.reads.set(pk, seq);
  }

  counters(): Counters | null {
    const raw = this.get("usage");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Counters;
    } catch {
      return null;
    }
  }

  setCounters(u: Counters): void {
    this.set("usage", JSON.stringify(u));
  }

  messagesOn(now: number): number {
    const u = this.counters();
    return u?.day === utcDay(now) ? u.n : 0;
  }

  storedBytes(): number {
    const u = this.counters();
    if (u) return u.bytes;
    const total = this.sql.all<{ n: number }>(`SELECT COALESCE(SUM(${CT_CHARS}), 0) AS n FROM msgs`)[0]?.n ?? 0;
    this.setCounters({ bytes: total, day: "", n: 0 });
    return total;
  }

  dropThrough(seq: number): number {
    if (seq <= 0) return 0;
    const freed = this.sql.all<{ n: number }>(`SELECT COALESCE(SUM(${CT_CHARS}), 0) AS n FROM msgs WHERE seq <= ?`, seq)[0]?.n ?? 0;
    if (freed) this.sql.run("DELETE FROM msgs WHERE seq <= ?", seq);
    return freed;
  }

  dropOldest(need: number): number {
    let freed = 0;
    let through = 0;
    while (freed < need) {
      const batch = this.sql.all<{ seq: number; n: number }>(`SELECT seq, ${CT_CHARS} AS n FROM msgs WHERE seq > ? ORDER BY seq LIMIT ?`, through, DROP_BATCH);
      for (const r of batch) {
        freed += r.n;
        through = r.seq;
        if (freed >= need) break;
      }
      if (batch.length < DROP_BATCH) break;
    }
    if (through) this.sql.run("DELETE FROM msgs WHERE seq <= ?", through);
    return freed;
  }

  activeMembers(): number {
    return this.sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE active = 1")[0]?.n ?? 0;
  }

  since(seq: number, limit = PAGE_LIMIT): Envelope[] {
    return this.sql
      .all<{ seq: number; ts: number; iv: Stored; ct: Stored; e: number }>("SELECT seq, ts, iv, ct, e FROM msgs WHERE seq > ? ORDER BY seq LIMIT ?", seq, Math.min(Math.max(limit, 1), PAGE_LIMIT))
      .map((r) => ({ seq: r.seq, ts: r.ts, iv: unpacked(r.iv), ct: unpacked(r.ct), e: r.e }));
  }

  range(after: number, through: number): Envelope[] {
    return this.sql
      .all<{ seq: number; ts: number; iv: Stored; ct: Stored; e: number }>("SELECT seq, ts, iv, ct, e FROM msgs WHERE seq > ? AND seq <= ? ORDER BY seq LIMIT ?", after, through, PAGE_LIMIT)
      .map((r) => ({ seq: r.seq, ts: r.ts, iv: unpacked(r.iv), ct: unpacked(r.ct), e: r.e }));
  }

  storedPageGen(): string | null {
    return this.get("page_gen") ?? null;
  }

  pageGen(): string {
    const known = this.storedPageGen();
    if (known) return known;
    const gen = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    this.set("page_gen", gen);
    return gen;
  }

  icon(): { e: number; iv: string; ct: string } | null {
    const t = this.get("icon");
    return t ? (JSON.parse(t) as { e: number; iv: string; ct: string }) : null;
  }

  iconAt(): number | null {
    return Number(this.get("icon_at")) || null;
  }

  getTitlesSig(): string | null {
    return this.get("titles_sig") || null;
  }

  title(): { iv: string; ct: string } | null {
    const t = this.get("title");
    return t ? (JSON.parse(t) as { iv: string; ct: string }) : null;
  }

  settings(): { iv: string; ct: string } | null {
    const t = this.get("settings");
    return t ? (JSON.parse(t) as { iv: string; ct: string }) : null;
  }

  unlinkAll(): DirectoryUpdate[] {
    const owner = this.ownerUser();
    return owner ? [{ user: owner, room: this.roomId, entry: null }] : [];
  }

  members(): { pk: string; xpk: string; rec: string; e: number; active: number; read_only: number }[] {
    return this.sql.all("SELECT pk, xpk, rec, rec_e AS e, active, read_only FROM members ORDER BY since");
  }

  pendingRequests(): (RequestBody & { kind: string; ownerNonce: string | null; reveal: string | null })[] {
    this.migrate();
    return this.sql.all(
      "SELECT id, pk, xpk, box, sig, ts, commit_to AS \"commit\", owner_nonce AS ownerNonce, reveal, kind FROM requests WHERE status = 'pending' AND commit_to IS NOT NULL ORDER BY COALESCE(received, ts)",
    );
  }

  deny(id: string): void {
    this.sql.run("UPDATE requests SET status = 'denied' WHERE id = ?", id);
  }
}

export class RoomStore extends Context.Service<RoomStore, RoomDb>()("kiwi/relay/RoomStore") {}

export type RoomServices = RoomStore | Policy;
