// Cloudflare relay: one SQLite-backed Durable Object per channel.
//
// Sockets use the hibernation API, so a room with idle agents connected is
// evicted from memory and billed nothing; heartbeats are answered by the
// runtime's auto-response without waking it. Each socket remembers which
// member key opened it, so removing a member disconnects exactly them.

import { DurableObject } from "cloudflare:workers";
import * as Layer from "effect/Layer";
import { CLOSE_CLOSED, CLOSE_REMOVED, GONE_WORDS, PING, PONG } from "@kiwi/core/protocol.ts";
import { ChannelGone, NotFound, Refused, TooMany, UpdateRequired } from "./failures.ts";
import { Human, withGithub, workosFromSettings, type HumanAuth } from "./human.ts";
import { pageSecret, Policy, policyFrom, type RelayPolicy } from "./policy.ts";
import { edgePage, PAGE_PATH, type PageCache } from "./pages.ts";
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
  gateRoom,
  idleExpired,
  missingFingerprint,
  onClientFrame,
  reown as reownRoom,
  wantsEcho,
  parseRoomPath,
  takesPresence,
  touch,
  wantsReads,
  wantsWatch,
  welcomeFrames,
  wsHeaders,
  type DirectoryEntry,
  type DirectoryUpdate,
  type Effects,
  type Sql,
  type SqlParam,
} from "./room.ts";
import { corsPreflight, onMailboxHttp, sqlMailboxStore, withCors } from "./mailbox.ts";
import {
  MACHINE_ASKS_PER_MINUTE,
  MACHINE_BOX_TTL_MS,
  MACHINE_UNSEEN_MS,
  machineAlarmAt,
  onMachineHttp,
  onPersonHttp,
  personMachine,
  signedMachineRequest,
  signedPersonRequest,
  takeNewerList,
  type MachineBox,
  type MachineStore,
  type PersonMachine,
} from "./machine.ts";
import { ACCOUNT_ASKS_PER_MINUTE, accountUser, isAccountPath, onAccountHttp, sameEnrollment, type AccountStore } from "./account.ts";
import { ENROLL_TTL_MS, type Enrollment } from "@kiwi/core/enroll.ts";
import { accountHome, frozenWrite, MOVE_PATH, movedHuman, moveUsers, onMoveHttp, type Adoption, type MoveStore, type Row, type Rows } from "./move.ts";
import type { DeviceLink } from "@kiwi/core/devices.ts";
import type { Vault } from "@kiwi/core/recovery.ts";
import { allow as allowPerMinute } from "./room/limits.ts";
import { makeRelay, onHttp, runRoom, runRoomSync, type Relay } from "./route.ts";
import { GithubApp, githubAppFrom, GithubPush, githubPushFrom } from "./github-app.ts";
import { GITHUB_QUEUE_MAX, GITHUB_QUEUE_TTL_MS, onGithubHttp, type GithubItem, type GithubLink, type GithubRoutes } from "./github.ts";

interface Env {
  CHANNELS: DurableObjectNamespace<Channel>;
  /** One per signed-in person: the channels they own, for the quota on POST /create. */
  OWNERS: DurableObjectNamespace<Owners>;
  /** One per pairing mailbox id: two sealed slots, gone ten minutes after the first write. */
  MAILBOX: DurableObjectNamespace<MailboxBox>;
  /** One per paired computer: who may ask it to act, its sealed asks, and its live socket. */
  MACHINES: DurableObjectNamespace<MachineInbox>;
  PERSON_MACHINES: DurableObjectNamespace<PersonMachines>;
  ACCOUNTS: DurableObjectNamespace<Account>;
  /** When set, channels belong to humans signed in with this WorkOS AuthKit client. */
  WORKOS_CLIENT_ID?: string;
  /** The AuthKit domain (https://….authkit.app or a custom one), whose keys may also sign tokens. Comma-separated while moving domains. */
  WORKOS_AUTHKIT_DOMAIN?: string;
  /** Secret, optional: lets the beta list match people by email (the relay never names owners from it). */
  WORKOS_API_KEY?: string;
  /** 20 mailbox writes per minute per client address (launch asks and enrolments). */
  MAILBOX_WRITES: RateLimit;
  /** 60 machine registrations and inbox writes per minute per client address. */
  MACHINE_WRITES: RateLimit;
  MAILBOX_READS: RateLimit;
  ROOM_JOINS: RateLimit;
  ROOM_CREATES: RateLimit;
  /** "off": don't retry a room request the platform refused (to count refusals, e.g. on a canary). */
  KIWI_ROOM_RETRY?: string;
  KIWI_PAGE_KEY?: string;
  REPOS: DurableObjectNamespace<Repos>;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_APP_CLIENT_ID?: string;
  /** Secret: lets the relay tell its GitHub App's sign-ins from any other app's. */
  GITHUB_APP_CLIENT_SECRET?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
}

const edgeCache: PageCache = {
  match: (key) => caches.default.match(key),
  put: (key, res) => caches.default.put(key, res),
};

let humanAuth: HumanAuth | null | undefined;
/** One verifier (and JWKS cache) per isolate. */
function human(env: Env): HumanAuth | null {
  if (humanAuth === undefined) {
    humanAuth = withGithub(workosFromSettings({ clientId: env.WORKOS_CLIENT_ID, authkitDomain: env.WORKOS_AUTHKIT_DOMAIN, apiKey: env.WORKOS_API_KEY }), {
      clientId: env.GITHUB_APP_CLIENT_ID,
      clientSecret: env.GITHUB_APP_CLIENT_SECRET,
    });
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
      run: (q, ...p) => void ctx.storage.sql.exec(q, ...p.map((v) => (v instanceof Uint8Array ? v.slice().buffer : v))),
      all: <T>(q: string, ...p: SqlParam[]) => ctx.storage.sql.exec(q, ...p).toArray() as T[],
    };
    this.policy = policyFrom(env as unknown as Record<string, string | undefined>);
    this.relay = makeRelay(
      Layer.mergeAll(
        Layer.succeed(
          Human,
          movedHuman(human(env), (user) => env.ACCOUNTS.get(env.ACCOUNTS.idFromName(user)).movedTo()),
        ),
        Layer.succeed(Policy, this.policy),
        Layer.succeed(ChannelLists, owned(env)),
        Layer.succeed(GithubApp, githubAppFrom({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY })),
        Layer.succeed(GithubPush, env.GITHUB_WEBHOOK_SECRET ? githubPushFrom() : null),
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
        const reads = wantsReads(url);
        const watch = wantsWatch(url);
        server.serializeAttachment({
          pk,
          room: route.roomId,
          reads,
          ...(takesPresence(url) && !watch ? {} : { presence: false }),
          ...(wantsEcho(url) ? {} : { echo: false }),
          ...(watch ? { watch } : {}),
        });
        for (const f of runRoomSync(this.relay, db, welcomeFrames(Number(url.searchParams.get("since") ?? 0) || 0, reads, watch))) server.send(f);
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
    const { room, pk, echo } = ws.deserializeAttachment() as { room: string; pk: string; echo?: boolean };
    const fx = runRoomSync(this.relay, this.store(room), onClientFrame(typeof data === "string" ? data : new TextDecoder().decode(data), pk, echo !== false));
    for (const f of [fx.reply ?? []].flat()) ws.send(f);
    await this.apply(fx, ws);
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code);
    } catch {
      // Already closed: closing back is only a courtesy.
    }
    const { room } = ws.deserializeAttachment() as { room: string };
    await this.apply({ expireAt: runRoomSync(this.relay, this.store(room), touch) ?? undefined });
  }

  private async apply(fx: Effects, sender?: WebSocket): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    const watching = fx.watch || fx.others ? new Set(sockets.filter(isWatch)) : null;
    for (const ws of sockets) for (const f of (watching?.has(ws) ? fx.watch : undefined) ?? fx.broadcast ?? []) send(ws, f);
    if (fx.others) for (const ws of sockets) if (ws !== sender && !watching?.has(ws)) send(ws, fx.others);
    if (fx.ephemeral) {
      for (const ws of sockets) if (ws !== sender && (ws.deserializeAttachment() as { presence?: boolean } | null)?.presence !== false) send(ws, fx.ephemeral);
    }
    if (fx.readers?.length) {
      for (const ws of sockets) {
        if (isWatch(ws) || (ws.deserializeAttachment() as { reads?: boolean } | null)?.reads === false) continue;
        for (const f of fx.readers) send(ws, f);
      }
    }
    if (fx.disconnect) {
      for (const ws of sockets) {
        if ((ws.deserializeAttachment() as { pk?: string } | null)?.pk === fx.disconnect.pk) close(ws, CLOSE_REMOVED, GONE_WORDS[fx.disconnect.how]);
      }
    }
    if (fx.github?.length) {
      await Promise.allSettled(fx.github.map((l) => this.env.REPOS.get(this.env.REPOS.idFromName(l.repo)).fetch("https://repos/apply", { method: "POST", body: JSON.stringify(l) })));
    }
    // Owned-channel counts are best-effort: a failure there must never stop a close from wiping.
    if (fx.directory?.length) {
      await Promise.allSettled(fx.directory.map((u) => this.env.OWNERS.get(this.env.OWNERS.idFromName(u.user)).fetch("https://owners/apply", { method: "POST", body: JSON.stringify(u) })));
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

  async reown(roomId: string, from: string, to: string): Promise<void> {
    const db = this.store(roomId);
    await this.apply({ directory: await runRoom(this.relay, db, reownRoom(from, to)) });
  }

  async enqueueGithub(roomId: string, item: GithubItem): Promise<boolean> {
    const db = this.store(roomId);
    if (!db.exists() || db.isLegacy()) return false;
    db.enqueueGithub(JSON.stringify(item), Date.now(), GITHUB_QUEUE_TTL_MS, GITHUB_QUEUE_MAX);
    return true;
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

export class Repos extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS rooms (room TEXT PRIMARY KEY)");
  }

  override async fetch(req: Request): Promise<Response> {
    const sql = this.ctx.storage.sql;
    if (req.method === "POST") {
      const l = (await req.json()) as GithubLink;
      if (l.on) sql.exec("INSERT OR IGNORE INTO rooms (room) VALUES (?)", l.room);
      else sql.exec("DELETE FROM rooms WHERE room = ?", l.room);
      return Response.json({ ok: true });
    }
    return Response.json((sql.exec("SELECT room FROM rooms").toArray() as { room: string }[]).map((r) => r.room));
  }
}

function githubRoutes(env: Env): GithubRoutes {
  const repos = (repo: string) => env.REPOS.get(env.REPOS.idFromName(repo));
  return {
    rooms: async (repo) => (await repos(repo).fetch("https://repos/")).json(),
    enqueue: (room, item) => env.CHANNELS.get(env.CHANNELS.idFromName(room)).enqueueGithub(room, item),
    drop: async (repo, room) => void (await repos(repo).fetch("https://repos/apply", { method: "POST", body: JSON.stringify({ repo, room, on: false }) })),
  };
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

/** One paired computer: the person bound to it, its sealed asks for a few minutes, and its daemon's socket. */
export class MachineInbox extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS binding (k INTEGER PRIMARY KEY CHECK (k = 1), person TEXT NOT NULL, mxpk TEXT NOT NULL, cert_at INTEGER NOT NULL, seen_at INTEGER NOT NULL)");
    const columns = ctx.storage.sql.exec("PRAGMA table_info(binding)").toArray();
    if (!columns.some((c) => c.name === "label")) ctx.storage.sql.exec("ALTER TABLE binding ADD COLUMN label TEXT NOT NULL DEFAULT ''");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS floor (k INTEGER PRIMARY KEY CHECK (k = 1), cert_at INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS boxes (id TEXT PRIMARY KEY, box TEXT NOT NULL, at INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS revoked (k INTEGER PRIMARY KEY CHECK (k = 1))");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS links (k INTEGER PRIMARY KEY CHECK (k = 1), links TEXT NOT NULL)");
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private live(): WebSocket[] {
    return this.ctx.getWebSockets("machine");
  }

  private async schedule(): Promise<void> {
    const sql = this.ctx.storage.sql;
    const oldest = (sql.exec("SELECT MIN(at) AS at FROM boxes").toArray()[0] as { at: number | null } | undefined)?.at ?? null;
    const seen = (sql.exec("SELECT seen_at FROM binding").toArray()[0] as { seen_at: number } | undefined)?.seen_at ?? null;
    const at = machineAlarmAt(oldest, seen);
    const set = await this.ctx.storage.getAlarm();
    if (at === null) await this.ctx.storage.deleteAlarm();
    else if (set === null || at < set) await this.ctx.storage.setAlarm(at);
  }

  private store(): MachineStore {
    const sql = this.ctx.storage.sql;
    return {
      binding: async () => {
        const row = sql.exec("SELECT person, mxpk, label, cert_at, seen_at FROM binding").toArray()[0] as { person: string; mxpk: string; label: string; cert_at: number; seen_at: number } | undefined;
        return row ? { person: row.person, mxpk: row.mxpk, label: row.label, certAt: row.cert_at, seenAt: row.seen_at } : null;
      },
      revoked: async () => sql.exec("SELECT k FROM revoked").toArray().length > 0,
      floor: async () => (sql.exec("SELECT cert_at FROM floor").toArray()[0] as { cert_at: number } | undefined)?.cert_at ?? 0,
      bind: async (mpk, b) => {
        sql.exec("INSERT OR REPLACE INTO binding (k, person, mxpk, label, cert_at, seen_at) VALUES (1, ?, ?, ?, ?, ?)", b.person, b.mxpk, b.label, b.certAt, b.seenAt);
        sql.exec("INSERT INTO floor (k, cert_at) VALUES (1, ?) ON CONFLICT (k) DO UPDATE SET cert_at = MAX(cert_at, excluded.cert_at)", b.certAt);
        await this.schedule();
        await this.env.PERSON_MACHINES.get(this.env.PERSON_MACHINES.idFromName(b.person)).add(mpk);
      },
      seen: async (_mpk, at) => {
        sql.exec("UPDATE binding SET seen_at = ?", at);
        await this.schedule();
      },
      unbind: async () => {
        sql.exec("DELETE FROM binding");
        sql.exec("DELETE FROM boxes");
        sql.exec("DELETE FROM links");
        await this.schedule();
      },
      links: async () => {
        const row = sql.exec("SELECT links FROM links").toArray()[0] as { links: string } | undefined;
        return row ? (JSON.parse(row.links) as unknown[]) : null;
      },
      keepLinks: async (_mpk, links) => {
        if (links) sql.exec("INSERT OR REPLACE INTO links (k, links) VALUES (1, ?)", JSON.stringify(links));
        else sql.exec("DELETE FROM links");
      },
      pending: async (_mpk, since) => (sql.exec("SELECT COUNT(*) AS n FROM boxes WHERE at >= ?", since).toArray()[0] as { n: number }).n,
      boxes: async (_mpk, since) => sql.exec("SELECT id, box, at FROM boxes WHERE at >= ? ORDER BY at", since).toArray() as unknown as MachineBox[],
      addBox: async (_mpk, b) => {
        sql.exec("INSERT INTO boxes (id, box, at) VALUES (?, ?, ?)", b.id, b.box, b.at);
        await this.schedule();
      },
      dropBox: async (_mpk, id) => void sql.exec("DELETE FROM boxes WHERE id = ?", id),
      online: () => {
        const since = this.live().map((ws) => (ws.deserializeAttachment() as { since?: number } | null)?.since ?? 0);
        return since.length ? Math.max(...since) : null;
      },
      push: (_mpk, b) => {
        for (const ws of this.live()) send(ws, JSON.stringify({ box: b }));
      },
      close: () => {
        for (const ws of this.live()) close(ws, 4000, "unpaired");
      },
    };
  }

  async revoke(): Promise<void> {
    const sql = this.ctx.storage.sql;
    sql.exec("INSERT OR IGNORE INTO revoked (k) VALUES (1)");
    sql.exec("DELETE FROM binding");
    sql.exec("DELETE FROM boxes");
    sql.exec("DELETE FROM links");
    for (const ws of this.live()) close(ws, 4000, "unpaired");
    await this.schedule();
  }

  async listed(mpk: string): Promise<{ person: string; machine: PersonMachine; links: DeviceLink[] | null } | null> {
    const store = this.store();
    const b = await store.binding(mpk);
    return b ? { person: b.person, machine: personMachine(mpk, b, store.online(mpk)), links: (await store.links(mpk)) as DeviceLink[] | null } : null;
  }

  async takeList(mpk: string, links: DeviceLink[]): Promise<void> {
    await takeNewerList(this.store(), mpk, links, Date.now());
  }

  override async fetch(req: Request): Promise<Response> {
    const store = this.store();
    try {
      const out = await onMachineHttp(req, store, { perMachine: (key) => allowPerMinute(key, MACHINE_ASKS_PER_MINUTE) });
      if (out instanceof Response) return out;
      if (!out) return withCors(errorResponse(new NotFound({ message: "not found" })));
      for (const old of this.live()) close(old, 4001, "replaced by a newer connection");
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server, ["machine"]);
      server.serializeAttachment({ since: Date.now() });
      for (const b of await store.boxes(out.upgrade, Date.now() - MACHINE_BOX_TTL_MS)) send(server, JSON.stringify({ box: b }));
      return new Response(null, { status: 101, webSocket: client, headers: wsHeaders(req) });
    } catch (err) {
      return withCors(errorResponse(err));
    }
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    close(ws, code === 1005 ? 1000 : code, "");
    if (this.live().some((x) => x !== ws)) return;
    this.ctx.storage.sql.exec("UPDATE binding SET seen_at = ?", Date.now());
    await this.schedule();
  }

  override async alarm(): Promise<void> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    sql.exec("DELETE FROM boxes WHERE at < ?", now - MACHINE_BOX_TTL_MS);
    if (!this.live().length && sql.exec("DELETE FROM binding WHERE seen_at < ?", now - MACHINE_UNSEEN_MS).rowsWritten) sql.exec("DELETE FROM links");
    await this.schedule();
  }
}

export class PersonMachines extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS machines (mpk TEXT PRIMARY KEY)");
  }

  async add(mpk: string): Promise<void> {
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO machines (mpk) VALUES (?)", mpk);
  }

  private async listed(person: string): Promise<{ machine: PersonMachine; links: DeviceLink[] | null }[]> {
    const sql = this.ctx.storage.sql;
    const keys = sql
      .exec("SELECT mpk FROM machines")
      .toArray()
      .map((r) => String(r.mpk));
    const listed = await Promise.all(keys.map(async (mpk) => ({ mpk, got: await this.env.MACHINES.get(this.env.MACHINES.idFromName(mpk)).listed(mpk) })));
    for (const { mpk, got } of listed) if (got?.person !== person) sql.exec("DELETE FROM machines WHERE mpk = ?", mpk);
    return listed.flatMap(({ got }) => (got?.person === person ? [{ machine: got.machine, links: got.links }] : []));
  }

  override async fetch(req: Request): Promise<Response> {
    try {
      const store = {
        machines: async (person: string) => (await this.listed(person)).map((l) => l.machine),
        lists: async (person: string) => (await this.listed(person)).flatMap((l) => (l.links ? [l.links] : [])),
      };
      return (await onPersonHttp(req, store)) ?? withCors(errorResponse(new NotFound({ message: "not found" })));
    } catch (err) {
      return withCors(errorResponse(err));
    }
  }
}

export class Account extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS links (seq INTEGER PRIMARY KEY, link TEXT NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS ask (k INTEGER PRIMARY KEY CHECK (k = 1), rec TEXT NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS recovery (n INTEGER PRIMARY KEY, link TEXT NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS vault (k INTEGER PRIMARY KEY CHECK (k = 1), version INTEGER NOT NULL, rec TEXT NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS move (k INTEGER PRIMARY KEY CHECK (k = 1), to_user TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, done INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS adoptions (from_user TEXT PRIMARY KEY, id TEXT NOT NULL, state TEXT NOT NULL)");
  }

  private tables(): string[] {
    return (this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray() as { name: string }[])
      .map((r) => r.name)
      .filter((n) => !n.startsWith("_cf_") && !n.startsWith("sqlite_") && !["ask", "move", "adoptions"].includes(n));
  }

  private holds(): boolean {
    const sql = this.ctx.storage.sql;
    return sql.exec("SELECT 1 FROM adoptions WHERE state = 'adopted'").toArray().length > 0 || this.tables().some((t) => sql.exec(`SELECT 1 FROM ${t} LIMIT 1`).toArray().length > 0);
  }

  private adoption(from: string): { id: string; state: string } | undefined {
    return this.ctx.storage.sql.exec("SELECT id, state FROM adoptions WHERE from_user = ?", from).toArray()[0] as { id: string; state: string } | undefined;
  }

  async rows(): Promise<Rows> {
    return Object.fromEntries(this.tables().map((t) => [t, this.ctx.storage.sql.exec(`SELECT * FROM ${t}`).toArray() as Row[]]));
  }

  async movedTo(): Promise<string | null> {
    return (this.ctx.storage.sql.exec("SELECT to_user FROM move WHERE done = 1").toArray()[0] as { to_user: string } | undefined)?.to_user ?? null;
  }

  async taken(): Promise<boolean> {
    return this.holds();
  }

  async adopt(from: string, id: string, rows: Rows): Promise<Adoption> {
    const sql = this.ctx.storage.sql;
    return this.ctx.storage.transactionSync(() => {
      const had = this.adoption(from);
      if (had?.state === "adopted") return "adopted";
      if (had?.id === id) return "abandoned";
      if (this.holds()) return "taken";
      for (const [t, list] of Object.entries(rows)) {
        for (const row of list) {
          const cols = Object.keys(row);
          sql.exec(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...Object.values(row));
        }
      }
      sql.exec("INSERT OR REPLACE INTO adoptions (from_user, id, state) VALUES (?, ?, 'adopted')", from, id);
      return "adopted";
    });
  }

  async abandon(from: string, id: string): Promise<Exclude<Adoption, "taken">> {
    return this.ctx.storage.transactionSync(() => {
      if (this.adoption(from)?.state === "adopted") return "adopted";
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO adoptions (from_user, id, state) VALUES (?, ?, 'abandoned')", from, id);
      return "abandoned";
    });
  }

  private moves(): MoveStore {
    const sql = this.ctx.storage.sql;
    const at = (user: string) => this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName(user));
    return {
      state: async () => {
        const row = sql.exec("SELECT to_user, id, at, done FROM move").toArray()[0] as { to_user: string; id: string; at: number; done: number } | undefined;
        if (!row) return null;
        return row.done ? { moved: row.to_user } : { frozen: { to: row.to_user, id: row.id, at: row.at } };
      },
      freeze: async (_from, f) => {
        if (sql.exec("SELECT 1 FROM move").toArray().length) return false;
        sql.exec("INSERT INTO move (k, to_user, id, at, done) VALUES (1, ?, ?, ?, 0)", f.to, f.id, f.at);
        return true;
      },
      thaw: async (_from, id) => void sql.exec("DELETE FROM move WHERE id = ? AND done = 0", id),
      settle: async (_from, to, id) => void sql.exec("UPDATE move SET done = 1 WHERE to_user = ? AND id = ?", to, id),
      rows: () => this.rows(),
      busy: async (_from, now) => {
        const ask = this.enrollment();
        return ask && ask.at + ENROLL_TTL_MS > now ? "asking" : null;
      },
      holds: (to) => at(to).taken(),
      adopt: (to, from, id, rows) => at(to).adopt(from, id, rows),
      abandon: (to, from, id) => at(to).abandon(from, id),
      rooms: async (from) =>
        ((await (await this.env.OWNERS.get(this.env.OWNERS.idFromName(from)).fetch("https://owners/")).json()) as DirectoryEntry[]).filter((e) => e.owner && e.code !== "").map((e) => e.room),
      reown: (room, from, to) => this.env.CHANNELS.get(this.env.CHANNELS.idFromName(room)).reown(room, from, to),
    };
  }

  async move(from: string, to: string, req: Request): Promise<Response> {
    try {
      return await onMoveHttp(req, this.moves(), this.store(), from, to, Date.now());
    } catch (err) {
      return withCors(errorResponse(err));
    }
  }

  private enrollment(): Enrollment | null {
    const row = this.ctx.storage.sql.exec("SELECT rec FROM ask").toArray()[0] as { rec: string } | undefined;
    return row ? (JSON.parse(row.rec) as Enrollment) : null;
  }

  private store(): AccountStore {
    const sql = this.ctx.storage.sql;
    return {
      links: async () => (sql.exec("SELECT link FROM links ORDER BY seq").toArray() as { link: string }[]).map((r) => JSON.parse(r.link) as unknown),
      extend: async (_user, from, links) => {
        if ((sql.exec("SELECT COUNT(*) AS n FROM links").toArray()[0] as { n: number }).n !== from) return false;
        links.forEach((l, i) => sql.exec("INSERT INTO links (seq, link) VALUES (?, ?)", from + i + 1, JSON.stringify(l)));
        return true;
      },
      enrollment: async () => this.enrollment(),
      setEnrollment: async (_user, next, prev) => {
        if (!sameEnrollment(this.enrollment(), prev)) return false;
        if (next) {
          sql.exec("INSERT OR REPLACE INTO ask (k, rec) VALUES (1, ?)", JSON.stringify(next));
          await this.ctx.storage.setAlarm(next.at + ENROLL_TTL_MS);
        } else {
          sql.exec("DELETE FROM ask");
          await this.ctx.storage.deleteAlarm();
        }
        return true;
      },
      revoke: async (keys) => {
        await Promise.all(keys.map((pk) => this.env.MACHINES.get(this.env.MACHINES.idFromName(pk)).revoke()));
      },
      tellComputers: async (keys, links) => {
        await Promise.all(keys.map((pk) => this.env.MACHINES.get(this.env.MACHINES.idFromName(pk)).takeList(pk, links as DeviceLink[])));
      },
      recovery: async () => (sql.exec("SELECT link FROM recovery ORDER BY n").toArray() as { link: string }[]).map((r) => JSON.parse(r.link) as unknown),
      extendRecovery: async (_user, from, links) => {
        if ((sql.exec("SELECT COUNT(*) AS n FROM recovery").toArray()[0] as { n: number }).n !== from) return false;
        links.forEach((l, i) => sql.exec("INSERT INTO recovery (n, link) VALUES (?, ?)", from + i + 1, JSON.stringify(l)));
        return true;
      },
      vault: async () => {
        const row = sql.exec("SELECT rec FROM vault").toArray()[0] as { rec: string } | undefined;
        return row ? (JSON.parse(row.rec) as Vault) : null;
      },
      setVault: async (_user, next, prev) => {
        const row = sql.exec("SELECT version FROM vault").toArray()[0] as { version: number } | undefined;
        if ((row?.version ?? 0) !== prev) return false;
        sql.exec("INSERT OR REPLACE INTO vault (k, version, rec) VALUES (1, ?, ?)", next.version, JSON.stringify(next));
        return true;
      },
    };
  }

  async serve(user: string, req: Request, formerly?: string): Promise<Response> {
    try {
      if (!formerly) {
        const home = await accountHome(this.moves(), user, Date.now());
        if (home.user !== user) return await this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName(home.user)).serve(home.user, req, user);
        const frozen = home.frozen ? frozenWrite(req) : null;
        if (frozen) return frozen;
      }
      const out = await onAccountHttp(req, this.store(), user, { perAccount: (key) => allowPerMinute(key, ACCOUNT_ASKS_PER_MINUTE), ...(formerly ? { formerly } : {}) });
      return out ?? withCors(errorResponse(new NotFound({ message: "not found" })));
    } catch (err) {
      return withCors(errorResponse(err));
    }
  }

  override async alarm(): Promise<void> {
    const rec = this.enrollment();
    if (rec && rec.at + ENROLL_TTL_MS <= Date.now()) this.ctx.storage.sql.exec("DELETE FROM ask");
  }
}

/** One pairing mailbox: two sealed slots, gone ten minutes after the first write. */
export class MailboxBox extends DurableObject<Env> {
  override async fetch(req: Request): Promise<Response> {
    const storage = this.ctx.storage;
    const sql: Sql = {
      run: (q, ...p) => void storage.sql.exec(q, ...p),
      all: <T>(q: string, ...p: SqlParam[]) => storage.sql.exec(q, ...p).toArray() as T[],
    };
    const store = sqlMailboxStore(sql, {
      expireAt: (at) => storage.setAlarm(at),
      wipe: async () => {
        await storage.deleteAlarm();
        await storage.deleteAll();
      },
    });
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

function isWatch(ws: WebSocket): boolean {
  return (ws.deserializeAttachment() as { watch?: boolean } | null)?.watch === true;
}

function send(ws: WebSocket, f: string): void {
  try {
    ws.send(f);
  } catch {
    // A socket that is closing: one dead peer must not stop the broadcast to the rest.
  }
}

function close(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed: the other sockets still get theirs.
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/v1/config") return withCors(relayConfig(human(env), env.GITHUB_APP_CLIENT_ID));
    // The desktop app's renderer isn't served by the relay: /v1/* answers any origin.
    if (req.method === "OPTIONS" && url.pathname.startsWith("/v1/")) return corsPreflight();
    if (url.pathname.startsWith("/v1/mailbox")) {
      // One object per mailbox id; a path without one is a 404, never a wake-up.
      const id = /^\/v1\/mailbox\/([A-Za-z0-9_-]{43})(?:\/(?:a|b))?$/.exec(url.pathname)?.[1];
      if (!id) return withCors(errorResponse(new NotFound({ message: "not found" })));
      const reader = req.headers.get("cf-connecting-ip");
      if (req.method === "GET" && reader && !(await env.MAILBOX_READS.limit({ key: reader })).success) {
        return withCors(errorResponse(new TooMany({ message: "too many pairing reads from this address; try again in a minute" })));
      }
      return env.MAILBOX.get(env.MAILBOX.idFromName(id)).fetch(req);
    }
    if (url.pathname.startsWith("/v1/machine/")) {
      const writing = req.method === "PUT" || req.method === "POST";
      const ip = req.headers.get("cf-connecting-ip");
      if (writing && ip && !(await env.MACHINE_WRITES.limit({ key: ip })).success) {
        return withCors(errorResponse(new TooMany({ message: "too many machine requests from this address; try again in a few minutes" })));
      }
      const copy = writing ? req.clone() : req;
      const signed = await signedMachineRequest(copy, Date.now());
      if (!signed) return withCors(errorResponse(new NotFound({ message: "not found" })));
      if (signed instanceof Response) return signed;
      return env.MACHINES.get(env.MACHINES.idFromName(signed.mpk)).fetch(req);
    }
    if (url.pathname === MOVE_PATH) {
      const ip = req.headers.get("cf-connecting-ip");
      if (ip && !(await env.MACHINE_WRITES.limit({ key: `account:${ip}` })).success) {
        return withCors(errorResponse(new TooMany({ message: "too many account requests from this address; try again in a few minutes" })));
      }
      const from = await accountUser(req, human(env));
      if (from instanceof Response) return from;
      const to = await moveUsers(req, human(env), from);
      if (to instanceof Response) return to;
      return env.ACCOUNTS.get(env.ACCOUNTS.idFromName(from)).move(from, to, req);
    }
    if (isAccountPath(url.pathname)) {
      const ip = req.headers.get("cf-connecting-ip");
      if ((req.method === "PUT" || req.method === "POST") && ip && !(await env.MACHINE_WRITES.limit({ key: `account:${ip}` })).success) {
        return withCors(errorResponse(new TooMany({ message: "too many account requests from this address; try again in a few minutes" })));
      }
      const user = await accountUser(req, human(env));
      if (user instanceof Response) return user;
      return env.ACCOUNTS.get(env.ACCOUNTS.idFromName(user)).serve(user, req);
    }
    if (url.pathname.startsWith("/v1/person/")) {
      const signed = await signedPersonRequest(req, Date.now());
      if (signed === null) return withCors(errorResponse(new NotFound({ message: "not found" })));
      if (signed instanceof Response) return signed;
      return env.PERSON_MACHINES.get(env.PERSON_MACHINES.idFromName(signed.pk)).fetch(req);
    }
    const github = await onGithubHttp(req, env.GITHUB_WEBHOOK_SECRET, githubRoutes(env));
    if (github) return github;
    const route = parseRoomPath(url.pathname);
    if (!route) return withCors(errorResponse(new NotFound({ message: "not found" })));
    // No fingerprint: 426 before the room's object is woken.
    const early = missingFingerprint(req.method, route.rest, url);
    if (early) return withCors(errorResponse(early));
    const gate = await gateRoom(req, route.roomId, route.rest);
    if (gate instanceof Response) return withCors(gate);
    const ip = req.headers.get("cf-connecting-ip");
    if (gate.open && ip && !(await env.ROOM_JOINS.limit({ key: ip })).success) {
      return withCors(errorResponse(new TooMany({ message: "too many join requests from this address; try again in a minute" })));
    }
    if (req.method === "POST" && route.rest === "/create" && ip && !(await env.ROOM_CREATES.limit({ key: ip })).success) {
      return withCors(errorResponse(new TooMany({ message: "too many channels made from this address; try again in a few minutes" })));
    }
    if (PAGE_PATH.test(route.rest)) return withCors(await edgePage(req, route.roomId, route.rest, pageSecret(env.KIWI_PAGE_KEY), edgeCache, () => toRoom(env, route.roomId, req), Date.now()));
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
    const busy = read
      ? new Refused({ status: 503, message: "the channel is busy or restarting; try again in a moment", tag: "Internal" })
      : new Refused({ status: 503, message: "the channel is busy or restarting, and this may have gone through: look before you send it again", tag: "Internal" });
    return withCors(errorResponse(busy));
  }
}
