// Self-hosted relay on Bun: same protocol as the Cloudflare relay, one SQLite
// file per room, created only when the room is and deleted when it closes.
// It can also serve the web dashboard (web/dist), as the Worker does.
// Usage: bun src/relay/bun.ts --help

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import type { ServerWebSocket } from "bun";
import * as Layer from "effect/Layer";
import { CLOSE_CLOSED, CLOSE_REMOVED, PING, PONG } from "../protocol.ts";
import { ChannelGone, NotFound, UpdateRequired } from "./failures.ts";
import { clockLayer } from "./http.ts";
import { authkitDomains, devHostOk, devHumanAuth, devRequestOk, Human, HUMAN_HEADER, workosFromSettings, type HumanAuth } from "./human.ts";
import { MAILBOX_TTL_MS } from "../mailbox.ts";
import { corsPreflight, onMailboxHttp, withCors, type MailboxStore } from "./mailbox.ts";
import { clientAddress, parseTrustProxy, trustProxyFromArgs, writeAllowed, type TrustProxy } from "./address.ts";
import { Policy, policyFrom, type RelayPolicy } from "./policy.ts";
import {
  Directory,
  RoomDb,
  relayConfig,
  authenticateSocket,
  errorResponse,
  expire,
  idleExpired,
  missingFingerprint,
  onClientFrame,
  parseRoomPath,
  touch,
  welcomeFrames,
  wsHeaders,
  type DirectoryEntry,
  type Sql,
  type Effects,
} from "./room.ts";
import { makeRelay, onHttp, runRoom, runRoomSync } from "./route.ts";

interface SocketData {
  roomId: string;
  pk: string;
  since: number;
}

/** The dashboard's files, and the sign-in origins its page may call besides this relay. */
export interface WebApp {
  dir: string;
  connect?: string[];
}

export function startRelay(
  opts: { port?: number; hostname?: string; dataDir?: string; human?: HumanAuth | null; policy?: RelayPolicy; web?: WebApp | null; now?: () => number; trustProxy?: TrustProxy } = {},
) {
  const human = opts.human ?? null;
  // Settings come from the caller, or else from the environment, the same keys the Worker reads.
  const policy = opts.policy ?? policyFrom(process.env);
  const trustProxy: TrustProxy = Array.isArray(opts.trustProxy) ? parseTrustProxy(opts.trustProxy) : opts.trustProxy === true;
  const web = opts.web ? webApp(opts.web) : null;
  const dataDir = opts.dataDir ?? ".relay-data";
  // Rooms hold ciphertext, member keys and join codes: only the relay's own user reads them.
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const dbs = new Map<string, Database>();
  const sockets = new Map<string, Set<ServerWebSocket<SocketData>>>();
  const file = (roomId: string) => join(dataDir, `${roomId}.sqlite`);
  // Signed-in people's owned channels (room ids and join codes only): the quota on POST /create.
  const people = new Database(join(dataDir, "people.sqlite"), { create: true });
  people.run("CREATE TABLE IF NOT EXISTS owned (user TEXT NOT NULL, room TEXT NOT NULL, entry TEXT NOT NULL, PRIMARY KEY (user, room))");
  // One-time pairing mailboxes (src/relay/mailbox.ts): id-hashed, sealed
  // boxes the relay can't read. Expired rows are deleted on read and below.
  people.run("CREATE TABLE IF NOT EXISTS mailboxes (id TEXT PRIMARY KEY, rec TEXT NOT NULL)");
  const mailboxes: MailboxStore = {
    load: async (id) => {
      const row = people.query("SELECT rec FROM mailboxes WHERE id = ?").get(id) as { rec: string } | null;
      return row ? (JSON.parse(row.rec) as { a: string | null; b: string | null; firstAt: number }) : null;
    },
    save: async (id, rec) => void people.query("INSERT OR REPLACE INTO mailboxes (id, rec) VALUES (?, ?)").run(id, JSON.stringify(rec)),
    drop: async (id) => void people.query("DELETE FROM mailboxes WHERE id = ?").run(id),
  };
  // Expired pairing mailboxes go on startup and hourly (reads expire them lazily too).
  const sweepMailboxes = () => {
    const now = Date.now();
    for (const r of people.query("SELECT id, rec FROM mailboxes").all() as { id: string; rec: string }[]) {
      try {
        if (now - (JSON.parse(r.rec) as { firstAt: number }).firstAt > MAILBOX_TTL_MS) people.query("DELETE FROM mailboxes WHERE id = ?").run(r.id);
      } catch {
        people.query("DELETE FROM mailboxes WHERE id = ?").run(r.id);
      }
    }
  };
  sweepMailboxes();
  const mailboxSweep = setInterval(sweepMailboxes, 3_600_000);
  mailboxSweep.unref?.();

  /** A store for the room; rooms that don't exist get a throwaway in-memory DB (so no file appears). */
  const sqlFor = (roomId: string, creating: boolean): Sql => {
    let db = dbs.get(roomId);
    if (!db) {
      if (!creating && !existsSync(file(roomId))) db = new Database(":memory:");
      else {
        db = new Database(file(roomId), { create: true });
        db.run("PRAGMA journal_mode = WAL");
        dbs.set(roomId, db);
      }
    }
    const d = db;
    return {
      run: (q, ...p) => void d.query(q).run(...p),
      all: <T>(q: string, ...p: (string | number | null)[]) => d.query(q).all(...p) as T[],
    };
  };
  const storeFor = (roomId: string, creating: boolean): RoomDb => new RoomDb(sqlFor(roomId, creating), roomId);
  const listOf = (user: string) => (people.query("SELECT entry FROM owned WHERE user = ?").all(user) as { entry: string }[]).map((r) => JSON.parse(r.entry) as DirectoryEntry);

  // What every room runs with. `now` (tests) is the clock the room reads.
  const services = Layer.mergeAll(
    Layer.succeed(Human, human),
    Layer.succeed(Policy, policy),
    Layer.succeed(Directory, { list: async (user: string) => listOf(user) }),
    clockLayer(opts.now),
  );
  const relay = makeRelay(services);

  const apply = (roomId: string, fx: Effects, sender?: ServerWebSocket<SocketData>) => {
    const room = sockets.get(roomId) ?? new Set();
    for (const f of fx.broadcast ?? []) for (const ws of room) ws.send(f);
    if (fx.others) for (const ws of room) if (ws !== sender) ws.send(fx.others);
    if (fx.disconnect) for (const ws of room) if (ws.data.pk === fx.disconnect) ws.close(CLOSE_REMOVED, "removed from channel");
    for (const u of fx.directory ?? []) {
      if (u.entry) people.query("INSERT OR REPLACE INTO owned (user, room, entry) VALUES (?, ?, ?)").run(u.user, u.room, JSON.stringify(u.entry));
      else people.query("DELETE FROM owned WHERE user = ? AND room = ?").run(u.user, u.room);
    }
    if (fx.wipe) {
      dbs.get(roomId)?.close();
      dbs.delete(roomId);
      for (const suffix of ["", "-wal", "-shm"]) rmSync(file(roomId) + suffix, { force: true });
      for (const ws of room) ws.close(CLOSE_CLOSED, "channel closed");
      sockets.delete(roomId);
    }
  };

  /**
   * Expire idle rooms: the Bun relay's version of the Worker's alarm. Runs hourly when the relay
   * expires idle rooms at all; returns how many it expired (tests call it directly).
   */
  const sweep = (): number => {
    if (!policy.expireAfterDays) return 0;
    let expired = 0;
    for (const f of readdirSync(dataDir)) {
      const m = /^([0-9a-f]{32})\.sqlite$/.exec(f);
      if (!m || sockets.get(m[1]!)?.size) continue;
      const db = storeFor(m[1]!, false);
      if (!runRoomSync(relay, db, idleExpired)) continue;
      apply(m[1]!, runRoomSync(relay, db, expire));
      expired++;
    }
    return expired;
  };
  const sweeper = policy.expireAfterDays ? setInterval(sweep, 3_600_000) : undefined;
  sweeper?.unref?.();

  const server = Bun.serve<SocketData>({
    port: opts.port ?? 8787,
    hostname: opts.hostname ?? "0.0.0.0",
    idleTimeout: 0,
    async fetch(req, server) {
      try {
        const url = new URL(req.url);
        // Dev sign-in answers only this machine, directly: never a request a proxy passed on.
        if (human?.dev && req.headers.has(HUMAN_HEADER) && !devRequestOk(req, server.requestIP(req)?.address)) {
          return Response.json({ error: "dev sign-in only takes requests made on this machine, not through a proxy" }, { status: 403 });
        }
        if (web && !url.pathname.startsWith("/v1/") && (req.method === "GET" || req.method === "HEAD")) return web(url.pathname);
        if (url.pathname === "/") return new Response("Kiwi Channels relay (bun)\n");
        // The desktop app's renderer isn't served by the relay: /v1/* answers any origin.
        if (req.method === "OPTIONS" && url.pathname.startsWith("/v1/")) return corsPreflight();
        if (url.pathname === "/v1/config") return withCors(await relayConfig(human));
        const ip = clientAddress(server.requestIP(req)?.address ?? null, req.headers.get("x-forwarded-for"), trustProxy);
        const mailbox = await onMailboxHttp(req, mailboxes, ip ? { ip, allow: writeAllowed } : {});
        if (mailbox) return mailbox;
        const route = parseRoomPath(url.pathname);
        if (!route) return withCors(errorResponse(new NotFound({ message: "not found" })));
        // No fingerprint: 426 before the room file is opened.
        const early = missingFingerprint(req.method, route.rest, url);
        if (early) return withCors(errorResponse(early));
        const db = storeFor(route.roomId, route.rest === "/create");
        if (route.rest === "/ws") {
          if (db.isLegacy()) {
            apply(route.roomId, { wipe: true });
            return withCors(errorResponse(new ChannelGone({ message: "no such channel" })));
          }
          const pk = await runRoom(relay, db, authenticateSocket(req));
          const since = Number(url.searchParams.get("since") ?? 0) || 0;
          if (server.upgrade(req, { data: { roomId: route.roomId, pk, since }, headers: wsHeaders(req) })) return undefined;
          return withCors(errorResponse(new UpdateRequired({ message: "expected websocket" })));
        }
        let result: Awaited<ReturnType<typeof onHttp>>;
        try {
          result = await onHttp(relay, db, req, route.rest);
        } catch (err) {
          // A create that failed leaves no file behind.
          if (route.rest === "/create" && !db.exists()) {
            dbs.get(route.roomId)?.close();
            dbs.delete(route.roomId);
            for (const suffix of ["", "-wal", "-shm"]) rmSync(file(route.roomId) + suffix, { force: true });
          }
          throw err;
        }
        if (result.fx) apply(route.roomId, result.fx);
        return withCors(result.res);
      } catch (err) {
        return withCors(errorResponse(err));
      }
    },
    websocket: {
      idleTimeout: 120,
      open(ws) {
        let set = sockets.get(ws.data.roomId);
        if (!set) sockets.set(ws.data.roomId, (set = new Set()));
        set.add(ws);
        const db = storeFor(ws.data.roomId, false);
        for (const f of runRoomSync(relay, db, welcomeFrames(ws.data.since))) ws.send(f);
        // A connection counts as activity for idle expiry.
        runRoomSync(relay, db, touch);
      },
      message(ws, data) {
        const raw = typeof data === "string" ? data : new TextDecoder().decode(data);
        if (raw === PING) return void ws.send(PONG);
        const fx = runRoomSync(relay, storeFor(ws.data.roomId, false), onClientFrame(raw, ws.data.pk));
        if (fx.reply) ws.send(fx.reply);
        apply(ws.data.roomId, fx, ws);
      },
      close(ws) {
        sockets.get(ws.data.roomId)?.delete(ws);
      },
    },
  });
  return Object.assign(server, { sweep });
}

/**
 * Serves the dashboard the way the Worker's static assets do: real files as
 * they are, any other page address gets index.html (so /auth/callback loads
 * the app), and the same security headers as web/public/_headers. The CSP is
 * built here because its sign-in origins depend on this relay's settings.
 */
function webApp(app: WebApp): (pathname: string) => Response {
  const root = resolve(app.dir);
  if (!existsSync(join(root, "index.html"))) throw new Error(`no index.html in ${root} (build it with: bun run web:build)`);
  const connect = ["'self'", ...(app.connect ?? [])].join(" ");
  const security = {
    "content-security-policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ${connect}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

  return (pathname) => {
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return new Response("bad path\n", { status: 400 });
    }
    const path = resolve(root, "." + rel);
    // Never outside the dashboard folder, and never Cloudflare's own config files.
    const inside = path.startsWith(root + sep) && !["_headers", "_redirects"].includes(basename(path));
    if (inside && isFile(path)) {
      const headers: Record<string, string> = { ...security };
      // Vite fingerprints everything under /assets; the rest must be rechecked each time.
      headers["cache-control"] = rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
      // The installers are fetched with curl | sh and must read as text.
      if (/^\/install(\.sh|\.ps1)?$/.test(rel)) headers["content-type"] = "text/plain; charset=utf-8";
      return new Response(Bun.file(path), { headers });
    }
    // A missing file (it has an extension) is a 404, not the app: a stale script must fail loudly.
    if (/\.[A-Za-z0-9]+$/.test(basename(rel))) return new Response("not found\n", { status: 404, headers: security });
    return new Response(Bun.file(join(root, "index.html")), { headers: { ...security, "cache-control": "no-cache" } });
  };
}

const usage = (cmd: string) => `Kiwi Channels relay (Bun)

Usage: ${cmd} [options]

  --port <n>                    port to listen on (default 8787; env PORT)
  --hostname <addr>             address to bind (default 0.0.0.0; 127.0.0.1 behind a reverse proxy; env KIWI_HOSTNAME)
  --data <dir>                  where rooms are stored (default .relay-data; env KIWI_DATA)
  --web <dir>                   serve the dashboard from here (default web/dist when built; env KIWI_WEB)
  --no-web                      don't serve the dashboard
  --workos-client-id <id>       turn on sign-in with your WorkOS AuthKit app (env WORKOS_CLIENT_ID)
  --workos-authkit-domain <url> your AuthKit domain, https://….authkit.app or your custom one; comma-separate
                                both while moving to a custom domain (env WORKOS_AUTHKIT_DOMAIN)
  --dev-sign-in                 testing only: the token "dev:<name>" signs in as <name>, no password.
                                Needs --hostname 127.0.0.1 (or localhost); refused on any other address.
  --trust-proxy [addr,cidr]     a reverse proxy sits in front (env KIWI_TRUST_PROXY=1, or a list).
                                Bare, or =1: trust a loopback peer. An address or CIDR (repeat
                                the flag, or comma-separate) trusts that peer too, for example
                                --trust-proxy 172.17.0.1 for Docker's bridge. A trusted peer's
                                last X-Forwarded-For address is the client. Any other peer
                                ignores the header. A prefix of /0 is refused.

  WORKOS_API_KEY (env only, it's a secret) lets the beta list match people by email.
  Without a WorkOS client id the relay has no sign-in: anyone can create channels.
  Beta and quota settings are read from the environment: the same KIWI_* keys the
  Worker reads from wrangler.jsonc (see src/relay/policy.ts). Unset: no gate, no quotas.
`;

/** The relay from the command line: `bun src/relay/bun.ts …` from a checkout, or `kiwi relay …` from the binary. */
export function runRelay(argv: string[], cmd = "bun src/relay/bun.ts"): void {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage(cmd));
    process.exit(0);
  }
  const arg = (name: string, env: string) => {
    const i = argv.indexOf(name);
    return (i >= 0 ? argv[i + 1] : undefined) ?? (process.env[env] || undefined);
  };
  const authkitDomain = arg("--workos-authkit-domain", "WORKOS_AUTHKIT_DOMAIN");
  const hostname = arg("--hostname", "KIWI_HOSTNAME");
  const dev = argv.includes("--dev-sign-in");
  if (dev && !devHostOk(hostname)) {
    process.stderr.write("--dev-sign-in lets anyone sign in as anyone: it needs --hostname 127.0.0.1 (or localhost).\n");
    process.exit(2);
  }
  let trustProxy: TrustProxy;
  try {
    trustProxy = trustProxyFromArgs(argv, process.env.KIWI_TRUST_PROXY);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : "bad --trust-proxy"}\n`);
    process.exit(2);
  }
  const human = dev ? devHumanAuth() : workosFromSettings({ clientId: arg("--workos-client-id", "WORKOS_CLIENT_ID"), authkitDomain, apiKey: process.env.WORKOS_API_KEY || undefined });
  const builtWeb = resolve(import.meta.dir, "../../web/dist");
  const webDir = argv.includes("--no-web") ? undefined : (arg("--web", "KIWI_WEB") ?? (existsSync(join(builtWeb, "index.html")) ? builtWeb : undefined));
  const connect = human ? ["https://api.workos.com", ...authkitDomains(authkitDomain)] : [];
  const server = startRelay({
    port: Number(arg("--port", "PORT") ?? 8787),
    hostname,
    dataDir: arg("--data", "KIWI_DATA"),
    human,
    web: webDir ? { dir: webDir, connect } : null,
    trustProxy,
  });
  console.log(`Kiwi Channels relay listening on ${server.url}`);
  console.log(`  sign-in: ${human?.dev ? 'DEV: the token "dev:<name>" is <name>, no password (this machine only)' : human ? `WorkOS ${human.clientId}${human.profile ? " (with emails, for the beta list)" : ""}` : "off"}`);
  console.log(`  dashboard: ${webDir ? resolve(webDir) : "not served"}`);
}

if (import.meta.main) runRelay(process.argv.slice(2));
