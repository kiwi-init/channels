// A one-time pairing mailbox at the relay, where two of one person's
// programs meet: the desktop app and a computer pairing with it (`kiwi pair`).
// Whoever starts makes a random secret; the person pastes its code on the
// other side. The relay only ever sees a mailbox id hashed from the secret,
// and boxes sealed under keys derived from it, so it can't read, forge or
// swap either side's message. See src/mailbox.ts for the client side.
//
//   PUT /v1/mailbox/<id>/<a|b>  {box}   write one slot, once (≤ 64 KiB)
//   GET /v1/mailbox/<id>/<a|b>          {box}, or 404 while empty
//   DELETE /v1/mailbox/<id>             remove both slots (best effort)
//
// Unauthenticated: the id is unguessable (a hash of the secret). Writes are
// rate-limited per client address; reads are polled, so they aren't. The
// mailbox lives ten minutes from its first write, then reads 404 and a write
// starts it over. Expired rows are deleted on read; adapters also sweep.
//
// Shared by the Cloudflare and Bun relays. Nothing here touches storage
// directly: each adapter implements MailboxStore with its own tables.

import { MAILBOX_ID_RE, MAILBOX_MAX_BYTES, MAILBOX_TTL_MS } from "@kiwi/core/mailbox.ts";
import { readText } from "./http.ts";
import type { Sql } from "./room/db.ts";

interface MailboxSlots {
  a: string | null;
  b: string | null;
  firstAt: number;
}

export interface MailboxStore {
  load(id: string): Promise<MailboxSlots | null>;
  save(id: string, rec: MailboxSlots): Promise<void>;
  drop(id: string): Promise<void>;
}

export function sqlMailboxStore(sql: Sql, storage: { expireAt(at: number): Promise<void>; wipe(): Promise<void> }): MailboxStore {
  const kept = () => sql.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").length > 0;
  const box = (slot: "a" | "b") => sql.all<{ box: string }>("SELECT box FROM slots WHERE slot = ?", slot)[0]?.box ?? null;
  return {
    load: async () => {
      if (!kept()) return null;
      const first = sql.all<{ firstAt: number }>("SELECT firstAt FROM meta")[0];
      return first ? { a: box("a"), b: box("b"), firstAt: first.firstAt } : null;
    },
    save: async (_id, rec) => {
      sql.run("CREATE TABLE IF NOT EXISTS slots (slot TEXT PRIMARY KEY, box TEXT NOT NULL)");
      sql.run("CREATE TABLE IF NOT EXISTS meta (k INTEGER PRIMARY KEY CHECK (k = 1), firstAt INTEGER NOT NULL)");
      sql.run("INSERT OR REPLACE INTO meta (k, firstAt) VALUES (1, ?)", rec.firstAt);
      for (const s of ["a", "b"] as const) {
        const written = rec[s];
        if (written) sql.run("INSERT OR REPLACE INTO slots (slot, box) VALUES (?, ?)", s, written);
      }
      await storage.expireAt(rec.firstAt + MAILBOX_TTL_MS);
    },
    drop: () => storage.wipe(),
  };
}

const PATH = /^\/v1\/mailbox\/([A-Za-z0-9_-]{43})(?:\/(a|b))?$/;

// ---------- CORS: the app's renderer isn't served by the relay any more ----------
//
// Requests carry signatures, never cookies, so answering any origin opens
// nothing. Adapters wrap every /v1/* response (and answer OPTIONS) with this.

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, PUT, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-human-token, if-none-match",
  "access-control-expose-headers": "etag",
  "access-control-max-age": "86400",
};

/** The preflight every /v1/* path answers. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
}

/** A response with the origin header set. */
export function withCors(res: Response): Response {
  // A WebSocket upgrade (101, carrying the socket) can't be rebuilt: new Response() refuses
  // status 101 and would drop the socket. CORS doesn't apply to it anyway.
  if (res.status === 101 || (res as Response & { webSocket?: unknown }).webSocket) return res;
  const headers = new Headers(res.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-expose-headers", "etag");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const json = (data: unknown, status: number, tag: string, error: string) => withCors(Response.json(data ?? { error, tag }, { status }));

/**
 * One mailbox request, or null when the path isn't a mailbox's. `ip` is the
 * client address for the write limiter (`allow`: false refuses with 429);
 * without either, writes aren't limited (tests pass neither).
 */
export async function onMailboxHttp(
  req: Request,
  store: MailboxStore,
  opts: { now?: () => number; ip?: string | null; allow?: (ip: string) => boolean | Promise<boolean> } = {},
): Promise<Response | null> {
  const m = PATH.exec(new URL(req.url).pathname);
  if (!m) return null;
  const id = m[1]!;
  const slot = m[2];
  if (!MAILBOX_ID_RE.test(id)) return null;
  const now = (opts.now ?? Date.now)();

  if (req.method === "OPTIONS") return corsPreflight();

  if (req.method === "DELETE" && !slot) {
    await store.drop(id).catch(() => {});
    return withCors(new Response(null, { status: 204 }));
  }

  if ((req.method === "GET" || req.method === "PUT") && (slot === "a" || slot === "b")) {
    let rec = await store.load(id);
    if (rec && now - rec.firstAt > MAILBOX_TTL_MS) {
      await store.drop(id).catch(() => {});
      rec = null;
    }
    if (req.method === "GET") {
      const box = rec?.[slot];
      if (!box) return json(null, 404, "NotFound", "empty");
      return withCors(Response.json({ box }));
    }
    // PUT: one write per slot. Reads poll every second or so, so only writes count.
    if (opts.ip && opts.allow && !(await opts.allow(opts.ip))) {
      return json(null, 429, "TooMany", "too many pairing attempts; try again in a few minutes");
    }
    const text = await readText(req.body, MAILBOX_MAX_BYTES + 1024, req.headers.get("content-length"));
    if (text === null) return json(null, 413, "TooLarge", "a mailbox slot holds at most 64 KiB");
    let box: unknown;
    try {
      box = (JSON.parse(text) as { box?: unknown })?.box;
    } catch {
      return json(null, 400, "BadRequest", "bad json");
    }
    if (typeof box !== "string" || !box) return json(null, 400, "BadRequest", "a slot takes {box}");
    if (new TextEncoder().encode(box).length > MAILBOX_MAX_BYTES) {
      return json(null, 413, "TooLarge", "a mailbox slot holds at most 64 KiB");
    }
    if (rec?.[slot]) return json(null, 409, "Conflict", "already written");
    await store.save(id, { a: rec?.a ?? null, b: rec?.b ?? null, [slot]: box, firstAt: rec?.firstAt ?? now });
    return withCors(new Response(null, { status: 204 }));
  }

  if (req.method === "GET" || req.method === "PUT" || req.method === "DELETE") {
    return json(null, 400, "BadRequest", "a mailbox takes /v1/mailbox/<id>/a, /v1/mailbox/<id>/b, or DELETE /v1/mailbox/<id>");
  }
  return json(null, 405, "MethodNotAllowed", "use GET, PUT or DELETE");
}
