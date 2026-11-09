import * as Context from "effect/Context";
import { b64url, fromB64url } from "@kiwi/core/crypto.ts";
import { PAGE_BYTES, PAGE_LIMIT, type DocEnvelope, type Envelope, type ReadMark } from "@kiwi/core/protocol.ts";
import type { PushRegistration } from "@kiwi/core/push.ts";
import type { Policy } from "../policy.ts";
import type { PushTarget } from "../push.ts";
import type { DirectoryUpdate } from "./directory.ts";
import { utcDay } from "./limits.ts";
import type { RequestBody } from "./requests.ts";

export type SqlParam = string | number | null | Uint8Array;

export interface Sql {
  run(query: string, ...params: SqlParam[]): void;
  all<T>(query: string, ...params: SqlParam[]): T[];
  transaction?<T>(work: () => T): T;
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

const BLOB_GRACE_MS = 3_600_000;

const READS_TABLE = "CREATE TABLE reads (pk TEXT PRIMARY KEY, seq INTEGER NOT NULL, at INTEGER NOT NULL)";

const SLOTS_TABLE = "CREATE TABLE slots (id TEXT PRIMARY KEY, holder TEXT NOT NULL, seq INTEGER NOT NULL, until INTEGER NOT NULL)";

const REVIEW_TICKETS_TABLE = "CREATE TABLE review_tickets (id TEXT PRIMARY KEY, key TEXT NOT NULL, holder TEXT NOT NULL, issued INTEGER NOT NULL, seq INTEGER)";

const DELEGATIONS_TABLE = "CREATE TABLE delegations (pk TEXT PRIMARY KEY, d TEXT NOT NULL, until INTEGER NOT NULL, keys TEXT NOT NULL)";

const DOCS_TABLE = "CREATE TABLE docs (th TEXT NOT NULL, dseq INTEGER NOT NULL, ts INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, e INTEGER NOT NULL, PRIMARY KEY (th, dseq))";

const DOC_SNAPS_TABLE = "CREATE TABLE doc_snaps (th TEXT PRIMARY KEY, upto INTEGER NOT NULL, ts INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, e INTEGER NOT NULL)";

const DOC_VERSIONS_TABLE = "CREATE TABLE doc_versions (th TEXT NOT NULL, upto INTEGER NOT NULL, ts INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, e INTEGER NOT NULL, PRIMARY KEY (th, upto))";

export interface DocVersion {
  upto: number;
  ts: number;
  bytes: number;
}

export interface DocStat {
  th: string;
  bytes: number;
  n: number;
  upto: number;
  last: number;
}

export interface DocLog {
  head: number;
  upto: number;
  n: number;
  bytes: number;
  oldest: number;
}

type DocRow = { dseq: number; ts: number; iv: Stored; ct: Stored; e: number };

const REQUEST_COLUMNS = [
  ["kind", "TEXT NOT NULL DEFAULT 'agent'"],
  ["sponsor_user", "TEXT"],
  ["sponsor_name", "TEXT"],
  ["received", "INTEGER"],
  ["sponsor_req", "TEXT"],
  ["commit_to", "TEXT"],
  ["owner_nonce", "TEXT"],
  ["reveal", "TEXT"],
  ["dpk", "TEXT"],
  ["dbox", "TEXT"],
  ["dsig", "TEXT"],
] as const;

type PendingRow = RequestBody & { kind: string; ownerNonce: string | null; reveal: string | null; dbox?: string; dsig?: string };

export interface StoredSnapshot {
  n: number;
  e: number;
  iv: string;
  ct: string;
  hash: string;
  sig: string;
  at: number;
}

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
  blobs: boolean | null;
  notes: boolean | null;
  push: boolean | null;
  sends: Map<string, Sent> | null;
  counters: Counters | null | undefined;
}

interface Sent {
  seq: number;
  ts: number;
}

const SEND_SCAN = 256;

const COUNTERS_EVERY = 50;

const sendKey = (sender: string, cid: string): string => `${sender} ${cid}`;

const warmRooms = new WeakMap<Sql, Warm>();

type Revised = "roster" | "info";

const coldRoom = (): Warm => ({ exists: null, meta: new Map(), head: null, members: new Map(), reads: new Map(), blobs: null, notes: null, push: null, sends: null, counters: undefined });

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
    warmRooms.set(this.sql, { ...coldRoom(), exists: true, head: 0, blobs: false, notes: false });
    this.sql.run("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    this.sql.run("CREATE TABLE msgs (seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, e INTEGER NOT NULL, sent TEXT)");
    this.sql.run(
      "CREATE TABLE members (pk TEXT PRIMARY KEY, xpk TEXT NOT NULL, rec TEXT NOT NULL, rec_e INTEGER NOT NULL, since INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, read_only INTEGER NOT NULL DEFAULT 0, admits_until INTEGER, admitted_by TEXT, delegation TEXT)",
    );
    this.sql.run("CREATE TABLE keys (pk TEXT NOT NULL, e INTEGER NOT NULL, wrapped TEXT NOT NULL, PRIMARY KEY (pk, e))");
    this.sql.run(
      `CREATE TABLE requests (id TEXT PRIMARY KEY, pk TEXT NOT NULL UNIQUE, xpk TEXT NOT NULL, box TEXT NOT NULL, sig TEXT NOT NULL, ts INTEGER NOT NULL, status TEXT NOT NULL, ${REQUEST_COLUMNS.map(([col, def]) => `${col} ${def}`).join(", ")})`,
    );
    this.sql.run(READS_TABLE);
    this.sql.run(SLOTS_TABLE);
    this.sql.run(REVIEW_TICKETS_TABLE);
    this.sql.run(DELEGATIONS_TABLE);
    this.sql.run(DOCS_TABLE);
    this.sql.run(DOC_SNAPS_TABLE);
    this.sql.run(DOC_VERSIONS_TABLE);
  }

  migrate(): void {
    if (migrated.has(this.sql)) return;
    const memberCols = new Set(this.sql.all<{ name: string }>("PRAGMA table_info(members)").map((c) => c.name));
    if (!memberCols.has("read_only")) this.sql.run("ALTER TABLE members ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0");
    if (!memberCols.has("admits_until")) this.sql.run("ALTER TABLE members ADD COLUMN admits_until INTEGER");
    if (!memberCols.has("admitted_by")) this.sql.run("ALTER TABLE members ADD COLUMN admitted_by TEXT");
    if (!memberCols.has("gone")) this.sql.run("ALTER TABLE members ADD COLUMN gone TEXT");
    if (!memberCols.has("delegation")) this.sql.run("ALTER TABLE members ADD COLUMN delegation TEXT");
    const cols = new Set(this.sql.all<{ name: string }>("PRAGMA table_info(requests)").map((c) => c.name));
    for (const [col, def] of REQUEST_COLUMNS) {
      if (!cols.has(col)) this.sql.run(`ALTER TABLE requests ADD COLUMN ${col} ${def}`);
    }
    this.sql.run(READS_TABLE.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
    this.sql.run(SLOTS_TABLE.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
    this.sql.run(REVIEW_TICKETS_TABLE.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
    if (!this.sql.all<{ name: string }>("PRAGMA table_info(msgs)").some((c) => c.name === "sent")) this.sql.run("ALTER TABLE msgs ADD COLUMN sent TEXT");
    if (this.sql.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sends'").length) {
      this.sql.run("UPDATE msgs SET sent = (SELECT s.sender || ' ' || s.cid FROM sends s WHERE s.seq = msgs.seq) WHERE seq IN (SELECT seq FROM sends)");
      this.sql.run("DROP TABLE sends");
    }
    this.sql.run(DELEGATIONS_TABLE.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
    this.sql.run(DOCS_TABLE.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
    this.sql.run(DOC_SNAPS_TABLE.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
    this.sql.run(DOC_VERSIONS_TABLE.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
    this.sql.run("DROP TABLE IF EXISTS secrets");
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
    return `"${what}-${what === "info" ? "2." : ""}${this.get(`${what}_rev`) ?? "0"}"`;
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

  atomically<T>(work: () => T): T {
    try {
      return this.sql.transaction ? this.sql.transaction(work) : work();
    } catch (err) {
      // The writes rolled back, so what this room holds in memory may not match the file any more: read it again next time.
      forgetRoom(this.sql);
      throw err;
    }
  }

  insert(seq: number, ts: number, iv: string, ct: string, e: number, send?: { sender: string; cid: string; since: number }): void {
    const sent = send ? sendKey(send.sender, send.cid) : null;
    if (sent) this.sql.run("INSERT INTO msgs (seq, ts, iv, ct, e, sent) VALUES (?, ?, ?, ?, ?, ?)", seq, ts, packed(iv), packed(ct), e, sent);
    else this.sql.run("INSERT INTO msgs (seq, ts, iv, ct, e) VALUES (?, ?, ?, ?, ?)", seq, ts, packed(iv), packed(ct), e);
    this.warm.head = seq;
    if (!send || !sent) return;
    const sends = this.recentSends(send.since);
    sends.set(sent, { seq, ts });
    if (seq % 100 === 0) for (const [k, v] of sends) if (v.ts < send.since) sends.delete(k);
  }

  priorSend(sender: string, cid: string, since: number): Sent | null {
    const hit = this.recentSends(since).get(sendKey(sender, cid));
    return hit && hit.ts >= since ? hit : null;
  }

  private recentSends(since: number): Map<string, Sent> {
    const w = this.warm;
    if (w.sends) return w.sends;
    const sends = new Map<string, Sent>();
    let below = Number.MAX_SAFE_INTEGER;
    for (;;) {
      const rows = this.sql.all<{ seq: number; ts: number; sent: string | null }>("SELECT seq, ts, sent FROM msgs WHERE seq < ? ORDER BY seq DESC LIMIT ?", below, SEND_SCAN);
      for (const r of rows) if (r.sent && r.ts >= since) sends.set(r.sent, { seq: r.seq, ts: r.ts });
      const last = rows.at(-1);
      if (!last || rows.length < SEND_SCAN || last.ts < since) break;
      below = last.seq;
    }
    w.sends = sends;
    return sends;
  }

  issueTicket(id: string, key: string, holder: string, issued: number): void {
    this.sql.run("INSERT INTO review_tickets (id, key, holder, issued, seq) VALUES (?, ?, ?, ?, NULL)", id, key, holder, issued);
  }

  ticket(id: string): { key: string; holder: string; issued: number; seq: number | null } | null {
    return this.sql.all<{ key: string; holder: string; issued: number; seq: number | null }>("SELECT key, holder, issued, seq FROM review_tickets WHERE id = ?", id)[0] ?? null;
  }

  deliverTickets(ids: readonly string[], seq: number): void {
    for (const id of ids) this.sql.run("UPDATE review_tickets SET seq = ? WHERE id = ? AND seq IS NULL", seq, id);
  }

  fenceAt(key: string, pendingSince: number): { pending: boolean; delivered: number | null; known: boolean } {
    const row = this.sql.all<{ pending: number; delivered: number | null; n: number }>(
      "SELECT SUM(CASE WHEN seq IS NULL AND issued > ? THEN 1 ELSE 0 END) AS pending, MAX(seq) AS delivered, COUNT(*) AS n FROM review_tickets WHERE key = ?",
      pendingSince,
      key,
    )[0];
    return { pending: (row?.pending ?? 0) > 0, delivered: row?.delivered ?? null, known: (row?.n ?? 0) > 0 };
  }

  slotHolder(id: string, now: number): { holder: string; seq: number } | null {
    return this.sql.all<{ holder: string; seq: number }>("SELECT holder, seq FROM slots WHERE id = ? AND until > ?", id, now)[0] ?? null;
  }

  takeSlot(id: string, holder: string, seq: number, until: number, now: number): void {
    this.sql.run("DELETE FROM slots WHERE until <= ?", now);
    this.sql.run(
      "INSERT INTO slots (id, holder, seq, until) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET holder = excluded.holder, seq = excluded.seq, until = excluded.until",
      id,
      holder,
      seq,
      until,
    );
  }

  freeSlots(ids: readonly string[], holder: string): void {
    if (ids.length) this.sql.run(`DELETE FROM slots WHERE holder = ? AND id IN (${ids.map(() => "?").join(", ")})`, holder, ...ids);
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
    const w = this.warm;
    if (w.counters !== undefined) return w.counters;
    const raw = this.get("usage");
    let saved: Counters | null = null;
    try {
      if (raw) saved = JSON.parse(raw) as Counters;
    } catch {
      // A damaged copy: storedBytes counts the channel again from its messages.
    }
    w.counters = saved && saved.head !== undefined ? this.withLater(saved) : saved;
    return w.counters;
  }

  private withLater(saved: Counters): Counters {
    const u = { ...saved };
    for (const r of this.sql.all<{ seq: number; ts: number; n: number }>(`SELECT seq, ts, ${CT_CHARS} AS n FROM msgs WHERE seq > ? ORDER BY seq`, saved.head ?? 0)) {
      const day = utcDay(r.ts);
      u.n = day === u.day ? u.n + 1 : 1;
      u.day = day;
      u.bytes += r.n;
      u.head = r.seq;
    }
    return u;
  }

  setCounters(u: Counters): void {
    const full = { ...u, head: this.head() };
    this.set("usage", JSON.stringify(full));
    this.warm.counters = full;
  }

  countMessage(u: Counters): void {
    if (!this.get("usage") || this.head() % COUNTERS_EVERY === 0) return this.setCounters(u);
    this.warm.counters = { ...u, head: this.head() };
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

  bytesThrough(seq: number): number {
    return this.sql.all<{ n: number }>(`SELECT COALESCE(SUM(${CT_CHARS}), 0) AS n FROM msgs WHERE seq <= ?`, seq)[0]?.n ?? 0;
  }

  dropOldest(need: number, upTo = Number.MAX_SAFE_INTEGER): number {
    let freed = 0;
    let through = 0;
    while (freed < need) {
      const batch = this.sql.all<{ seq: number; n: number }>(`SELECT seq, ${CT_CHARS} AS n FROM msgs WHERE seq > ? AND seq <= ? ORDER BY seq LIMIT ?`, through, upTo, DROP_BATCH);
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

  private hasPush(): boolean {
    const w = this.warm;
    w.push ??= this.sql.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'push'").length > 0;
    return w.push;
  }

  setPush(pk: string, r: PushRegistration, at: number): void {
    if (!this.hasPush()) {
      this.sql.run("CREATE TABLE IF NOT EXISTS push (pk TEXT PRIMARY KEY, platform TEXT NOT NULL, token TEXT NOT NULL, tag TEXT NOT NULL, sandbox INTEGER NOT NULL, at INTEGER NOT NULL)");
      this.warm.push = true;
    }
    this.sql.run("DELETE FROM push WHERE token = ? AND pk != ?", r.token, pk);
    this.sql.run("INSERT OR REPLACE INTO push (pk, platform, token, tag, sandbox, at) VALUES (?, ?, ?, ?, ?, ?)", pk, r.platform, r.token, r.tag, r.sandbox ? 1 : 0, at);
  }

  dropPush(pk: string): void {
    if (this.hasPush()) this.sql.run("DELETE FROM push WHERE pk = ?", pk);
  }

  dropPushTokens(tokens: readonly string[]): void {
    if (!this.hasPush()) return;
    for (const token of tokens) this.sql.run("DELETE FROM push WHERE token = ?", token);
  }

  pushFor(pks: readonly string[]): PushTarget[] {
    if (!pks.length || !this.hasPush()) return [];
    return this.sql
      .all<Omit<PushTarget, "sandbox"> & { sandbox: number }>(
        `SELECT p.pk, p.platform, p.token, p.tag, p.sandbox FROM push p JOIN members m ON m.pk = p.pk WHERE m.active = 1 AND p.pk IN (${pks.map(() => "?").join(", ")})`,
        ...pks,
      )
      .map((r) => ({ ...r, sandbox: r.sandbox === 1 }));
  }

  private hasNotes(): boolean {
    const w = this.warm;
    w.notes ??= this.sql.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes'").length > 0;
    return w.notes;
  }

  note(id: string): { box: string; version: number; writer: string } | null {
    if (!this.hasNotes()) return null;
    return this.sql.all<{ box: string; version: number; writer: string }>("SELECT box, version, writer FROM notes WHERE id = ?", id)[0] ?? null;
  }

  notesBy(writer: string): number {
    if (!this.hasNotes()) return 0;
    return this.sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE writer = ?", writer)[0]?.n ?? 0;
  }

  putNote(id: string, writer: string, version: number, box: string, at: number): void {
    if (!this.hasNotes()) {
      this.sql.run("CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, writer TEXT NOT NULL, version INTEGER NOT NULL, box TEXT NOT NULL, at INTEGER NOT NULL)");
      this.warm.notes = true;
    }
    this.sql.run("INSERT OR REPLACE INTO notes (id, writer, version, box, at) VALUES (?, ?, ?, ?, ?)", id, writer, version, box, at);
  }

  dropNotesBefore(at: number): number {
    if (!this.hasNotes()) return 0;
    const freed = this.sql.all<{ n: number }>("SELECT COALESCE(SUM(LENGTH(box)), 0) AS n FROM notes WHERE at < ?", at)[0]?.n ?? 0;
    if (freed) this.sql.run("DELETE FROM notes WHERE at < ?", at);
    return freed;
  }

  private hasBlobs(): boolean {
    const w = this.warm;
    w.blobs ??= this.sql.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'blobs'").length > 0;
    return w.blobs;
  }

  blob(id: string): Uint8Array<ArrayBuffer> | null {
    if (!this.hasBlobs()) return null;
    const b = this.sql.all<{ bytes: Uint8Array<ArrayBuffer> | ArrayBuffer }>("SELECT bytes FROM blobs WHERE id = ?", id)[0]?.bytes;
    return b === undefined ? null : b instanceof Uint8Array ? b : new Uint8Array(b);
  }

  hasBlob(id: string): boolean {
    return this.hasBlobs() && this.sql.all("SELECT 1 FROM blobs WHERE id = ?", id).length > 0;
  }

  putBlob(id: string, bytes: Uint8Array<ArrayBuffer>, at: number): void {
    if (!this.hasBlobs()) {
      this.sql.run("CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, bytes BLOB NOT NULL, size INTEGER NOT NULL, at INTEGER NOT NULL)");
      this.warm.blobs = true;
    }
    this.sql.run("INSERT OR IGNORE INTO blobs (id, bytes, size, at) VALUES (?, ?, ?, ?)", id, bytes, bytes.length, at);
  }

  pruneBlobs(): number {
    if (!this.hasBlobs()) return 0;
    const oldest = this.sql.all<{ ts: number }>("SELECT ts FROM msgs ORDER BY seq LIMIT 1")[0]?.ts;
    if (oldest === undefined) return 0;
    const before = oldest - BLOB_GRACE_MS;
    const freed = this.sql.all<{ n: number }>("SELECT COALESCE(SUM(size), 0) AS n FROM blobs WHERE at < ?", before)[0]?.n ?? 0;
    if (freed) this.sql.run("DELETE FROM blobs WHERE at < ?", before);
    return freed;
  }

  dropOldestBlobs(need: number): number {
    if (!this.hasBlobs()) return 0;
    let freed = 0;
    const gone: string[] = [];
    for (const r of this.sql.all<{ id: string; size: number }>("SELECT id, size FROM blobs ORDER BY at")) {
      if (freed >= need) break;
      freed += r.size;
      gone.push(r.id);
    }
    for (const id of gone) this.sql.run("DELETE FROM blobs WHERE id = ?", id);
    return freed;
  }

  activeMembers(): number {
    return this.sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE active = 1")[0]?.n ?? 0;
  }

  since(seq: number, limit = PAGE_LIMIT): Envelope[] {
    const sizes = this.sql.all<{ seq: number; size: number }>(
      "SELECT seq, length(iv) + length(ct) AS size FROM msgs WHERE seq > ? ORDER BY seq LIMIT ?",
      seq,
      Math.min(Math.max(limit, 1), PAGE_LIMIT),
    );
    if (!sizes.length) return [];
    let through = seq;
    let bytes = 0;
    for (const r of sizes) {
      if (through > seq && bytes + r.size > PAGE_BYTES) break;
      bytes += r.size;
      through = r.seq;
    }
    return this.range(seq, through);
  }

  rangeBytes(after: number, through: number): number {
    return this.sql.all<{ n: number | null }>("SELECT SUM(length(iv) + length(ct)) AS n FROM msgs WHERE seq > ? AND seq <= ?", after, through)[0]?.n ?? 0;
  }

  range(after: number, through: number): Envelope[] {
    return this.sql
      .all<{ seq: number; ts: number; iv: Stored; ct: Stored; e: number }>("SELECT seq, ts, iv, ct, e FROM msgs WHERE seq > ? AND seq <= ? ORDER BY seq LIMIT ?", after, through, PAGE_LIMIT)
      .map((r) => ({ seq: r.seq, ts: r.ts, iv: unpacked(r.iv), ct: unpacked(r.ct), e: r.e }));
  }

  docLog(th: string): DocLog {
    const snap = this.sql.all<{ upto: number; e: number }>("SELECT upto, e FROM doc_snaps WHERE th = ?", th)[0];
    const log = this.sql.all<{ head: number | null; n: number; bytes: number; oldest: number | null }>(
      `SELECT MAX(dseq) AS head, COUNT(*) AS n, COALESCE(SUM(${CT_CHARS}), 0) AS bytes, MIN(e) AS oldest FROM docs WHERE th = ?`,
      th,
    )[0];
    const upto = snap?.upto ?? 0;
    return {
      head: Math.max(log?.head ?? 0, upto),
      upto,
      n: log?.n ?? 0,
      bytes: log?.bytes ?? 0,
      oldest: Math.min(log?.oldest ?? Number.MAX_SAFE_INTEGER, snap?.e ?? Number.MAX_SAFE_INTEGER),
    };
  }

  docAppend(th: string, dseq: number, ts: number, iv: string, ct: string, e: number): void {
    this.sql.run("INSERT INTO docs (th, dseq, ts, iv, ct, e) VALUES (?, ?, ?, ?, ?, ?)", th, dseq, ts, packed(iv), packed(ct), e);
    this.setDocBytes(this.docBytes() + ct.length);
  }

  docSnap(th: string, upto: number, ts: number, iv: string, ct: string, e: number, keep: { versions: number; everyMs: number }): void {
    const covered = this.sql.all<{ n: number }>(`SELECT COALESCE(SUM(${CT_CHARS}), 0) AS n FROM docs WHERE th = ? AND dseq <= ?`, th, upto)[0]?.n ?? 0;
    const was = this.sql.all<{ ts: number; n: number }>(`SELECT ts, ${CT_CHARS} AS n FROM doc_snaps WHERE th = ?`, th)[0];
    const newest = this.sql.all<{ ts: number }>("SELECT MAX(ts) AS ts FROM doc_versions WHERE th = ?", th)[0]?.ts ?? null;
    const kept = was && keep.versions > 1 && (newest === null || was.ts - newest >= keep.everyMs);
    if (kept) this.sql.run("INSERT OR REPLACE INTO doc_versions (th, upto, ts, iv, ct, e) SELECT th, upto, ts, iv, ct, e FROM doc_snaps WHERE th = ?", th);
    const trimmed =
      this.sql.all<{ n: number }>(
        `SELECT COALESCE(SUM(${CT_CHARS}), 0) AS n FROM doc_versions WHERE th = ? AND upto NOT IN (SELECT upto FROM doc_versions WHERE th = ? ORDER BY upto DESC LIMIT ?)`,
        th,
        th,
        Math.max(keep.versions - 1, 0),
      )[0]?.n ?? 0;
    this.sql.run("DELETE FROM doc_versions WHERE th = ? AND upto NOT IN (SELECT upto FROM doc_versions WHERE th = ? ORDER BY upto DESC LIMIT ?)", th, th, Math.max(keep.versions - 1, 0));
    const old = kept ? trimmed : (was?.n ?? 0) + trimmed;
    this.sql.run("DELETE FROM docs WHERE th = ? AND dseq <= ?", th, upto);
    this.sql.run(
      "INSERT INTO doc_snaps (th, upto, ts, iv, ct, e) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (th) DO UPDATE SET upto = excluded.upto, ts = excluded.ts, iv = excluded.iv, ct = excluded.ct, e = excluded.e",
      th,
      upto,
      ts,
      packed(iv),
      packed(ct),
      e,
    );
    this.setDocBytes(Math.max(0, this.docBytes() - covered - old + ct.length));
  }

  docSince(th: string, since: number): DocEnvelope[] {
    const snap = this.sql.all<DocRow>("SELECT upto AS dseq, ts, iv, ct, e FROM doc_snaps WHERE th = ?", th)[0];
    const sent = snap && since < snap.dseq ? snap : null;
    const rows = this.sql.all<DocRow>("SELECT dseq, ts, iv, ct, e FROM docs WHERE th = ? AND dseq > ? ORDER BY dseq", th, sent ? sent.dseq : since);
    const envelope = (r: DocRow): DocEnvelope => ({ th, dseq: r.dseq, ts: r.ts, iv: unpacked(r.iv), ct: unpacked(r.ct), e: r.e });
    return [...(sent ? [{ ...envelope(sent), snap: true as const }] : []), ...rows.map(envelope)];
  }

  docVersions(th: string): DocVersion[] {
    const now = this.sql.all<DocVersion>(`SELECT upto, ts, ${CT_CHARS} AS bytes FROM doc_snaps WHERE th = ?`, th);
    const older = this.sql.all<DocVersion>(`SELECT upto, ts, ${CT_CHARS} AS bytes FROM doc_versions WHERE th = ? ORDER BY upto DESC`, th);
    return [...now, ...older];
  }

  docVersion(th: string, upto: number): DocEnvelope | null {
    const row =
      this.sql.all<DocRow>("SELECT upto AS dseq, ts, iv, ct, e FROM doc_snaps WHERE th = ? AND upto = ?", th, upto)[0] ??
      this.sql.all<DocRow>("SELECT upto AS dseq, ts, iv, ct, e FROM doc_versions WHERE th = ? AND upto = ?", th, upto)[0];
    return row ? { th, dseq: row.dseq, ts: row.ts, iv: unpacked(row.iv), ct: unpacked(row.ct), e: row.e, snap: true } : null;
  }

  docList(): DocStat[] {
    return this.sql.all<DocStat>(
      `SELECT th, SUM(bytes) AS bytes, SUM(n) AS n, MAX(upto) AS upto, MAX(last) AS last FROM (
        SELECT th, ${CT_CHARS} AS bytes, 1 AS n, 0 AS upto, ts AS last FROM docs
        UNION ALL SELECT th, ${CT_CHARS} AS bytes, 0 AS n, upto, ts AS last FROM doc_snaps
        UNION ALL SELECT th, ${CT_CHARS} AS bytes, 0 AS n, 0 AS upto, ts AS last FROM doc_versions
      ) GROUP BY th ORDER BY th`,
    );
  }

  docDrop(th: string): number {
    const freed =
      (this.sql.all<{ n: number }>(`SELECT COALESCE(SUM(${CT_CHARS}), 0) AS n FROM docs WHERE th = ?`, th)[0]?.n ?? 0) +
      (this.sql.all<{ n: number }>(`SELECT COALESCE(SUM(${CT_CHARS}), 0) AS n FROM doc_snaps WHERE th = ?`, th)[0]?.n ?? 0) +
      (this.sql.all<{ n: number }>(`SELECT COALESCE(SUM(${CT_CHARS}), 0) AS n FROM doc_versions WHERE th = ?`, th)[0]?.n ?? 0);
    this.sql.run("DELETE FROM docs WHERE th = ?", th);
    this.sql.run("DELETE FROM doc_snaps WHERE th = ?", th);
    this.sql.run("DELETE FROM doc_versions WHERE th = ?", th);
    this.setDocBytes(Math.max(0, this.docBytes() - freed));
    return freed;
  }

  docBytes(): number {
    const raw = this.get("doc_bytes");
    if (raw !== undefined) return Number(raw) || 0;
    const total =
      (this.sql.all<{ n: number }>(`SELECT COALESCE(SUM(${CT_CHARS}), 0) AS n FROM docs`)[0]?.n ?? 0) +
      (this.sql.all<{ n: number }>(`SELECT COALESCE(SUM(${CT_CHARS}), 0) AS n FROM doc_snaps`)[0]?.n ?? 0) +
      (this.sql.all<{ n: number }>(`SELECT COALESCE(SUM(${CT_CHARS}), 0) AS n FROM doc_versions`)[0]?.n ?? 0);
    this.setDocBytes(total);
    return total;
  }

  private setDocBytes(n: number): void {
    this.set("doc_bytes", n);
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

  title(): { e?: number; iv: string; ct: string } | null {
    const t = this.get("title");
    return t ? (JSON.parse(t) as { e?: number; iv: string; ct: string }) : null;
  }

  settings(): { e?: number; iv: string; ct: string } | null {
    const t = this.get("settings");
    return t ? (JSON.parse(t) as { e?: number; iv: string; ct: string }) : null;
  }

  snapshot(): StoredSnapshot | null {
    const t = this.sql.all<{ v: string }>("SELECT v FROM meta WHERE k = 'snapshot'")[0]?.v;
    return t ? (JSON.parse(t) as StoredSnapshot) : null;
  }

  setSnapshot(s: StoredSnapshot): void {
    this.sql.run("INSERT INTO meta (k, v) VALUES ('snapshot', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", JSON.stringify(s));
  }

  dropSnapshot(): number {
    const freed = this.snapshot()?.ct.length ?? 0;
    if (freed) this.sql.run("DELETE FROM meta WHERE k = 'snapshot'");
    return freed;
  }

  githubRepos(): string[] {
    const v = this.get("github_repos");
    return v ? (JSON.parse(v) as string[]) : [];
  }

  setGithubRepos(repos: string[]): void {
    this.set("github_repos", JSON.stringify(repos));
  }

  enqueueGithub(repo: string, item: string, now: number, ttlMs: number, most: number): void {
    this.set(`github_seen:${repo.toLowerCase()}`, now);
    this.sql.run("CREATE TABLE IF NOT EXISTS github_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, item TEXT NOT NULL)");
    this.sql.run("DELETE FROM github_queue WHERE at < ?", now - ttlMs);
    this.sql.run("INSERT INTO github_queue (at, item) VALUES (?, ?)", now, item);
    this.sql.run("DELETE FROM github_queue WHERE id <= (SELECT id FROM github_queue ORDER BY id DESC LIMIT 1 OFFSET ?)", most);
  }

  githubSeen(repo: string): number | null {
    const v = Number(this.get(`github_seen:${repo.toLowerCase()}`));
    return Number.isSafeInteger(v) && v > 0 ? v : null;
  }

  githubQueue(limit: number): { id: number; item: string }[] {
    if (!this.sql.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'github_queue'").length) return [];
    return this.sql.all("SELECT id, item FROM github_queue ORDER BY id LIMIT ?", limit);
  }

  ackGithub(upTo: number): void {
    if (this.sql.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'github_queue'").length) this.sql.run("DELETE FROM github_queue WHERE id <= ?", upTo);
  }

  unlinkAll(): DirectoryUpdate[] {
    const owner = this.ownerUser();
    return owner ? [{ user: owner, room: this.roomId, entry: null }] : [];
  }

  members(): { pk: string; xpk: string; rec: string; e: number; active: number; read_only: number; d?: string }[] {
    this.migrate();
    return this.sql
      .all<{ pk: string; xpk: string; rec: string; e: number; active: number; read_only: number; d: string | null }>(
        "SELECT pk, xpk, rec, rec_e AS e, active, read_only, delegation AS d FROM members ORDER BY since",
      )
      .map(({ d, ...m }) => (d ? { ...m, d } : m));
  }

  pendingRequests(delegate?: string): PendingRow[] {
    this.migrate();
    const cols = 'id, pk, xpk, box, sig, ts, commit_to AS "commit", owner_nonce AS ownerNonce, reveal, kind';
    const pending = "status = 'pending' AND commit_to IS NOT NULL";
    if (!delegate) return this.sql.all<PendingRow>(`SELECT ${cols} FROM requests WHERE ${pending} ORDER BY COALESCE(received, ts)`);
    return this.sql.all<PendingRow>(`SELECT ${cols}, dbox, dsig FROM requests WHERE ${pending} AND dpk = ? AND dbox IS NOT NULL AND dsig IS NOT NULL ORDER BY COALESCE(received, ts)`, delegate);
  }

  deny(id: string): void {
    this.sql.run("UPDATE requests SET status = 'denied', received = ? WHERE id = ?", Date.now(), id);
  }
}

export class RoomStore extends Context.Service<RoomStore, RoomDb>()("kiwi/relay/RoomStore") {}

export type RoomServices = RoomStore | Policy;
