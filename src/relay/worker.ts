// Cloudflare relay: one SQLite-backed Durable Object per channel.
//
// Sockets use the hibernation API, so a room with idle agents connected is
// evicted from memory and billed nothing; heartbeats are answered by the
// runtime's auto-response without waking it. Each socket remembers which
// member key opened it, so removing a member disconnects exactly them.

import { DurableObject } from "cloudflare:workers";
import * as Layer from "effect/Layer";
import { CLOSE_CLOSED, CLOSE_REMOVED, GONE_WORDS, PING, PONG } from "../protocol.ts";
import { ChannelGone, NotFound, Refused, UpdateRequired } from "./failures.ts";
import { Human, workosFromSettings, type HumanAuth } from "./human.ts";
import { Policy, policyFrom, type RelayPolicy } from "./policy.ts";
import {
  Directory as ChannelLists, // the service; the Durable Object below counts owned channels instead
  holdEntry,
  releasable,
  reserveSlot,
  RoomDb,
  relayConfig,
  authenticateSocket,
  errorResponse,
  expire,
  forgetRoom,
  idleExpired,
  missingFingerprint,
  onClientFrame,
  parseRoomPath,
  touch,
  welcomeFrames,
  wsHeaders,
  type DirectoryEntry,
  type DirectoryUpdate,
  type Effects,
  type Sql,
} from "./room.ts";
import { MAILBOX_TTL_MS } from "../mailbox.ts";
import { corsPreflight, onMailboxHttp, withCors, type MailboxStore } from "./mailbox.ts";
import { makeRelay, onHttp, runRoom, runRoomSync, type Relay } from "./route.ts";

interface Env {
  CHANNELS: DurableObjectNamespace<Channel>;
  /** One per signed-in person: the channels they own, for the quota on POST /create. */
  OWNERS: DurableObjectNamespace<Owners>;
  /** One per pairing mailbox id: two sealed slots, gone ten minutes after the first write. */
  MAILBOX: DurableObjectNamespace<MailboxBox>;
  /** When set, channels belong to humans signed in with this WorkOS AuthKit client. */
  WORKOS_CLIENT_ID?: string;
  /** The AuthKit domain (https://….authkit.app or a custom one), whose keys may also sign tokens. Comma-separated while moving domains. */
  WORKOS_AUTHKIT_DOMAIN?: string;
  /** Secret, optional: lets the beta list match people by email (the relay never names owners from it). */
  WORKOS_API_KEY?: string;
  /** 20 mailbox writes per minute per client address (pairing codes are pasted by hand). */
  MAILBOX_WRITES: RateLimit;
  /** "off": don't retry a room request the platform refused (to count refusals, e.g. on a canary). */
  KIWI_ROOM_RETRY?: string;
}

let humanAuth: HumanAuth | null | undefined;
/** One verifier (and JWKS cache) per isolate. */
function human(env: Env): HumanAuth | null {
  if (humanAuth === undefined) {
    humanAuth = workosFromSettings({ clientId: env.WORKOS_CLIENT_ID, authkitDomain: env.WORKOS_AUTHKIT_DOMAIN, apiKey: env.WORKOS_API_KEY });
  }
  return humanAuth;
}

type Owned = ChannelLists["Service"];
let peopleOf: { env: Env; owned: Owned } | undefined;
/**
 * The owned-channel counts rooms read for the quota: each person's Owners object, reached through
 * this isolate's cached fetchers. Built once per isolate, like the verifier above.
 */
function owned(env: Env): Owned {
  if (peopleOf?.env !== env) {
    const at = (user: string) => env.OWNERS.get(env.OWNERS.idFromName(user));
    const post = (user: string, path: string, body: object) => at(user).fetch(`https://owners/${path}`, { method: "POST", body: JSON.stringify(body) });
    peopleOf = {
      env,
      owned: {
        list: async (user) => (await at(user).fetch("https://owners/")).json(),
        reserve: async (user, room, most) => ((await (await post(user, "reserve", { room, most })).json()) as { ok: boolean }).ok,
        release: async (user, room) => void (await post(user, "release", { room })),
      },
    };
  }
  return peopleOf.owned;
}

export class Channel extends DurableObject<Env> {
  private readonly sql: Sql;
  private readonly policy: RelayPolicy;
  /** What this channel's room runs with: sign-in, policy and the owner's owned-channel count. */
  private readonly relay: Relay;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = {
      run: (q, ...p) => void ctx.storage.sql.exec(q, ...p),
      all: <T>(q: string, ...p: (string | number | null)[]) => ctx.storage.sql.exec(q, ...p).toArray() as T[],
    };
    this.policy = policyFrom(env as unknown as Record<string, string | undefined>);
    this.relay = makeRelay(
      Layer.mergeAll(
        Layer.succeed(Human, human(env)),
        Layer.succeed(Policy, this.policy),
        Layer.succeed(ChannelLists, owned(env)),
      ),
    );
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private store(roomId: string): RoomDb {
    return new RoomDb(this.sql, roomId);
  }

  override async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const route = parseRoomPath(url.pathname)!;
      // No fingerprint: 426 before this object reads the room.
      const early = missingFingerprint(req.method, route.rest, url);
      if (early) return withCors(errorResponse(early));
      const db = this.store(route.roomId);
      if (route.rest === "/ws") {
        if (db.isLegacy()) {
          await this.apply({ wipe: true });
          return errorResponse(new ChannelGone({ message: "no such channel" }));
        }
        if (req.headers.get("upgrade") !== "websocket") return errorResponse(new UpdateRequired({ message: "expected websocket" }));
        const pk = await runRoom(this.relay, db, authenticateSocket(req));
        const { 0: client, 1: server } = new WebSocketPair();
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ pk, room: route.roomId });
        for (const f of runRoomSync(this.relay, db, welcomeFrames(Number(url.searchParams.get("since") ?? 0) || 0))) server.send(f);
        await this.apply({ expireAt: runRoomSync(this.relay, db, touch) ?? undefined });
        return new Response(null, { status: 101, webSocket: client, headers: wsHeaders(req) });
      }
      const { res, fx } = await onHttp(this.relay, db, req, route.rest);
      if (fx) await this.apply(fx);
      return withCors(res);
    } catch (err) {
      return withCors(errorResponse(err));
    }
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const { room, pk } = ws.deserializeAttachment() as { room: string; pk: string };
    const fx = runRoomSync(this.relay, this.store(room), onClientFrame(typeof data === "string" ? data : new TextDecoder().decode(data), pk));
    if (fx.reply) ws.send(fx.reply);
    await this.apply(fx, ws);
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code === 1005 ? 1000 : code);
    } catch {}
  }

  private async apply(fx: Effects, sender?: WebSocket): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    for (const f of fx.broadcast ?? []) for (const ws of sockets) send(ws, f);
    if (fx.others) for (const ws of sockets) if (ws !== sender) send(ws, fx.others);
    if (fx.disconnect) {
      for (const ws of sockets) {
        if ((ws.deserializeAttachment() as { pk?: string } | null)?.pk === fx.disconnect.pk) close(ws, CLOSE_REMOVED, GONE_WORDS[fx.disconnect.how]);
      }
    }
    // Owned-channel counts are best-effort: a failure there must never stop a close from wiping.
    if (fx.directory?.length) {
      await Promise.allSettled(
        fx.directory.map((u) => this.env.OWNERS.get(this.env.OWNERS.idFromName(u.user)).fetch("https://owners/apply", { method: "POST", body: JSON.stringify(u) })),
      );
    }
    if (fx.wipe) {
      // Closing leaves no breadcrumbs: every row and table goes, alarms included.
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      forgetRoom(this.sql);
      for (const ws of sockets) close(ws, CLOSE_CLOSED, "channel closed");
    } else if (fx.expireAt) {
      await this.ctx.storage.setAlarm(fx.expireAt);
    }
  }

  /** An idle room's expiry check: expire it if nobody's connected and nothing was stored since. */
  override async alarm(): Promise<void> {
    const room = (this.sql.all<{ v: string }>("SELECT v FROM meta WHERE k = 'room'")[0] ?? null)?.v;
    if (!room) return;
    const db = this.store(room);
    const days = this.policy.expireAfterDays;
    if (!days) return;
    // Someone's still connected: look again later rather than cut them off.
    if (this.ctx.getWebSockets().length) return void (await this.ctx.storage.setAlarm(Date.now() + days * 86_400_000));
    if (runRoomSync(this.relay, db, idleExpired)) await this.apply(runRoomSync(this.relay, db, expire));
    else await this.ctx.storage.setAlarm(Number(this.sql.all<{ v: string }>("SELECT v FROM meta WHERE k = 'active'")[0]?.v ?? Date.now()) + days * 86_400_000);
  }
}

/** One signed-in person's owned channels: room ids and join codes only, for the quota on POST /create. */
export class Owners extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS owned (room TEXT PRIMARY KEY, entry TEXT NOT NULL)");
  }

  override async fetch(req: Request): Promise<Response> {
    const sql = this.ctx.storage.sql;
    const entries = () => (sql.exec("SELECT entry FROM owned").toArray() as { entry: string }[]).map((r) => JSON.parse(r.entry) as DirectoryEntry);
    const path = new URL(req.url).pathname;
    // One object per person, and no await between the count and the hold: two creates can't both pass.
    if (req.method === "POST" && path === "/reserve") {
      const { room, most } = (await req.json()) as { room: string; most: number };
      const { ok, stale } = reserveSlot(entries(), room, most, Date.now());
      for (const r of stale) sql.exec("DELETE FROM owned WHERE room = ?", r);
      if (ok && !entries().some((e) => e.room === room)) sql.exec("INSERT INTO owned (room, entry) VALUES (?, ?)", room, JSON.stringify(holdEntry(room, Date.now())));
      return Response.json({ ok });
    }
    if (req.method === "POST" && path === "/release") {
      const { room } = (await req.json()) as { room: string };
      if (releasable(entries().find((e) => e.room === room))) sql.exec("DELETE FROM owned WHERE room = ?", room);
      return Response.json({ ok: true });
    }
    if (req.method === "POST") {
      const u = (await req.json()) as DirectoryUpdate;
      if (u.entry?.owner) sql.exec("INSERT OR REPLACE INTO owned (room, entry) VALUES (?, ?)", u.room, JSON.stringify(u.entry));
      else sql.exec("DELETE FROM owned WHERE room = ?", u.room);
      return Response.json({ ok: true });
    }
    return Response.json(entries());
  }
}

/** One pairing mailbox: two sealed slots, gone ten minutes after the first write. */
export class MailboxBox extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS slots (slot TEXT PRIMARY KEY, box TEXT NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS meta (k INTEGER PRIMARY KEY CHECK (k = 1), firstAt INTEGER NOT NULL)");
  }

  override async fetch(req: Request): Promise<Response> {
    const sql = this.ctx.storage.sql;
    const store: MailboxStore = {
      load: async () => {
        const first = sql.exec("SELECT firstAt FROM meta").toArray()[0] as { firstAt: number } | undefined;
        if (!first) return null;
        const at = (s: string) => (sql.exec("SELECT box FROM slots WHERE slot = ?", s).toArray()[0] as { box: string } | undefined)?.box ?? null;
        return { a: at("a"), b: at("b"), firstAt: first.firstAt };
      },
      save: async (_id, rec) => {
        sql.exec("INSERT OR REPLACE INTO meta (k, firstAt) VALUES (1, ?)", rec.firstAt);
        for (const s of ["a", "b"] as const) {
          if (rec[s]) sql.exec("INSERT OR REPLACE INTO slots (slot, box) VALUES (?, ?)", s, rec[s]);
        }
        // A mailbox nobody reads still dies on time.
        await this.ctx.storage.setAlarm(rec.firstAt + MAILBOX_TTL_MS);
      },
      drop: async () => {
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
      },
    };
    const ip = req.headers.get("cf-connecting-ip");
    const res =
      (await onMailboxHttp(req, store, {
        ip,
        allow: async (key) => (await this.env.MAILBOX_WRITES.limit({ key })).success,
      })) ?? withCors(errorResponse(new NotFound({ message: "not found" })));
    // A write starts the expiry clock even when the alarm below failed to set.
    return res;
  }

  /** The ten minutes are up: leave nothing behind. */
  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

function send(ws: WebSocket, f: string): void {
  try {
    ws.send(f);
  } catch {}
}

function close(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {}
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/v1/config") return withCors(relayConfig(human(env)));
    // The desktop app's renderer isn't served by the relay: /v1/* answers any origin.
    if (req.method === "OPTIONS" && url.pathname.startsWith("/v1/")) return corsPreflight();
    if (url.pathname.startsWith("/v1/mailbox")) {
      // One object per mailbox id; a path without one is a 404, never a wake-up.
      const id = /^\/v1\/mailbox\/([A-Za-z0-9_-]{43})(?:\/(?:a|b))?$/.exec(url.pathname)?.[1];
      if (!id) return withCors(errorResponse(new NotFound({ message: "not found" })));
      return env.MAILBOX.get(env.MAILBOX.idFromName(id)).fetch(req);
    }
    const route = parseRoomPath(url.pathname);
    if (!route) return withCors(errorResponse(new NotFound({ message: "not found" })));
    // No fingerprint: 426 before the room's object is woken.
    const early = missingFingerprint(req.method, route.rest, url);
    if (early) return withCors(errorResponse(early));
    return toRoom(env, route.roomId, req);
  },
} satisfies ExportedHandler<Env>;

/**
 * Forward a request to its room's Durable Object. The platform can refuse one
 * (an object restarting after a deploy, an overloaded one): say so in the logs,
 * retry a read once when the platform marks the error retryable, and answer a
 * clean 503 instead of an opaque platform error.
 */
async function toRoom(env: Env, roomId: string, req: Request): Promise<Response> {
  const stub = () => env.CHANNELS.get(env.CHANNELS.idFromName(roomId));
  const read = req.method === "GET" || req.method === "HEAD";
  try {
    return withCors(await stub().fetch(req));
  } catch (err) {
    const e = err as Error & { retryable?: boolean; overloaded?: boolean };
    // No room id or path in the log: only what went wrong.
    console.error(JSON.stringify({ at: "room-stub", method: req.method, retryable: !!e.retryable, overloaded: !!e.overloaded, error: e.message }));
    // KIWI_ROOM_RETRY=off turns the retry off (to count refusals as they happen, e.g. on a canary).
    if (read && e.retryable && !e.overloaded && env.KIWI_ROOM_RETRY !== "off") {
      try {
        return withCors(await stub().fetch(req));
      } catch (again) {
        console.error(JSON.stringify({ at: "room-stub-retry", method: req.method, error: (again as Error).message }));
      }
    }
    return withCors(errorResponse(new Refused({ status: 503, message: "the channel is busy or restarting; try again in a moment", tag: "Internal" })));
  }
}
