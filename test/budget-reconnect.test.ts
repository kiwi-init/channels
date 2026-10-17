import type { ServerWebSocket } from "bun";
import { Database } from "bun:sqlite";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { AgentLive } from "../src/agent.ts";
import { Channel, type Live } from "../src/client.ts";
import { generateIdentity } from "../src/identity.ts";
import * as Layer from "effect/Layer";
import { MORE_REFUSED, WS_PROTOCOL } from "../src/protocol.ts";
import { Human } from "../src/relay/human.ts";
import { OPEN_POLICY, Policy } from "../src/relay/policy.ts";
import { Directory, MORE_PER_MINUTE, onClientFrame, RoomDb, type Sql } from "../src/relay/room.ts";
import { makeRelay, runRoomSync } from "../src/relay/route.ts";
import { startRelay } from "../src/relay/bun.ts";
import { checked } from "./check.ts";
import { trafficProxy } from "./traffic.ts";

setDefaultTimeout(120_000);

const BUDGET = {
  catchUp: { sockets: 1, opens: 1, rosterFetches: 1 },
  outage: { retries: 12, headChecks: 4 },
} as const;

const BACKLOG = 2_500;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-budget-${tag}-`));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

async function until(pred: () => boolean, label: string, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(20);
  }
}

async function seeded(): Promise<{ dataDir: string; access: Channel["access"]; owner: Awaited<ReturnType<typeof generateIdentity>>; head: number }> {
  const dataDir = scratch("backlog");
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const owner = await generateIdentity("human");
  const { access } = await Channel.create(server.url.origin, owner, { name: "human" });
  await new Channel(access, server.url.origin, owner).send("one of many");
  server.stop(true);
  const file = new Database(join(dataDir, `${access.roomId}.sqlite`));
  const seed = file.query("SELECT seq, ts, iv, ct, e FROM msgs ORDER BY seq DESC LIMIT 1").get() as { seq: number; ts: number; iv: string; ct: string; e: number };
  const insert = file.prepare("INSERT INTO msgs (seq, ts, iv, ct, e) VALUES (?, ?, ?, ?, ?)");
  file.transaction(() => {
    for (let seq = seed.seq + 1; seq < seed.seq + BACKLOG; seq++) insert.run(seq, seed.ts, seed.iv, seed.ct, seed.e);
  })();
  file.close();
  return { dataDir, access, owner, head: seed.seq + BACKLOG - 1 };
}

async function catchUp(via: string, relay: string, seed: Awaited<ReturnType<typeof seeded>>): Promise<{ kinds: string[]; seqs: number[]; rosters: number; requests: number }> {
  const ch = new Channel(seed.access, via, seed.owner);
  const poster = new Channel(seed.access, relay, seed.owner);
  const kinds: string[] = [];
  const seqs: number[] = [];
  let rosters = 0;
  let requests = 0;
  let posted = false;
  const handle = (ev: Live) => {
    switch (ev._tag) {
      case "Open":
        kinds.push(String(ev.kind));
        return ev.kind === "page" ? Effect.void : Effect.asVoid(Effect.ignoreCause(ch.fx.members()));
      case "Message":
        return Effect.sync(() => void seqs.push(ev.message.seq));
      case "Roster":
        return Effect.sync(() => void rosters++);
      case "Request":
        return Effect.sync(() => void requests++);
      case "Ready":
        if (posted) return Effect.void;
        posted = true;
        return Effect.asVoid(Effect.promise(() => poster.send("said while the backlog streams")));
      default:
        return Effect.void;
    }
  };
  const fiber = Effect.runFork(Stream.runForEach(ch.fx.live(0, { presence: false }), handle).pipe(Effect.provide(AgentLive)) as Effect.Effect<void>);
  await until(() => seqs.includes(seed.head + 1), "the whole backlog and the message said meanwhile");
  await Bun.sleep(200);
  await Effect.runPromise(Fiber.interrupt(fiber));
  return { kinds, seqs, rosters, requests };
}

const inOrder = (seqs: number[]) => seqs.every((s, i) => i === 0 || s === seqs[i - 1]! + 1);

test("a fresh listener catches up on a long backlog with one socket and one roster fetch", async () => {
  const seed = await seeded();
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: seed.dataDir });
  const proxy = trafficProxy(server.url.origin);
  try {
    const { kinds, seqs } = await catchUp(proxy.url, server.url.origin, seed);
    const t = proxy.stats;
    const rosterFetches = t.routes["GET /members"] ?? 0;
    console.log(`catch-up of ${seqs.length} messages: ${t.sockets} sockets, ${kinds.length} opens (${kinds.join(", ")}), ${rosterFetches} roster fetches, ${t.framesUp.more ?? 0} more frames`);
    expect(seqs.length).toBe(BACKLOG + 1);
    expect(inOrder(seqs)).toBe(true);
    expect(t.sockets).toBeLessThanOrEqual(BUDGET.catchUp.sockets);
    expect(kinds.length).toBeLessThanOrEqual(BUDGET.catchUp.opens);
    expect(rosterFetches).toBeLessThanOrEqual(BUDGET.catchUp.rosterFetches);
  } finally {
    proxy.stop();
    server.stop(true);
  }
});

function oldRelay(target: string, refusal = "unknown frame"): { url: string; sockets: () => number; stop: () => void } {
  let sockets = 0;
  const ups = new WeakMap<ServerWebSocket<{ path: string; protocols: string[] }>, WebSocket>();
  const server = Bun.serve<{ path: string; protocols: string[] }>({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, srv) {
      const url = new URL(req.url);
      if (req.headers.get("upgrade") === "websocket") {
        sockets++;
        const protocols = (req.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
        if (srv.upgrade(req, { data: { path: url.pathname + url.search, protocols }, headers: { "sec-websocket-protocol": WS_PROTOCOL } })) return undefined;
      }
      return fetch(target + url.pathname + url.search, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : req.body });
    },
    websocket: {
      open(ws) {
        const up = new WebSocket(target.replace(/^http/, "ws") + ws.data.path, ws.data.protocols);
        ups.set(ws, up);
        up.onmessage = (ev: MessageEvent<string>) => ws.send(ev.data);
        up.onclose = (ev) => {
          try {
            ws.close(ev.code === 1005 || ev.code === 1006 ? 1000 : ev.code, ev.reason);
          } catch {
            // The client already hung up: nothing to pass the close on to.
          }
        };
      },
      message(ws, data) {
        if (typeof data === "string" && (JSON.parse(data) as { t?: unknown }).t === "more") return void ws.send(JSON.stringify({ t: "err", error: refusal }));
        const up = ups.get(ws);
        if (up?.readyState === WebSocket.OPEN) up.send(data);
      },
      close(ws, code, reason) {
        try {
          ups.get(ws)?.close(code === 1005 || code === 1006 ? 1000 : code, reason);
        } catch {
          // The upstream is already closed: nothing to pass the close on to.
        }
      },
    },
  });
  return { url: server.url.origin, sockets: () => sockets, stop: () => server.stop(true) };
}

test("against a relay that doesn't know more frames, the listener pages by reconnecting and refetches only once", async () => {
  const seed = await seeded();
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: seed.dataDir });
  const old = oldRelay(server.url.origin);
  try {
    const { kinds, seqs, rosters, requests } = await catchUp(old.url, server.url.origin, seed);
    console.log(`catch-up from an old relay: ${old.sockets()} sockets, opens ${kinds.join(", ")}`);
    expect(seqs.length).toBe(BACKLOG + 1);
    expect(inOrder(seqs)).toBe(true);
    expect(kinds.filter((k) => k !== "page")).toEqual(["first"]);
    expect(kinds).toContain("page");
    expect(rosters).toBe(1);
    expect(requests).toBe(1);
  } finally {
    old.stop();
    server.stop(true);
  }
});

test("a relay that refuses a page ask is paged by reconnecting, and nothing is lost", async () => {
  const seed = await seeded();
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: seed.dataDir });
  const busy = oldRelay(server.url.origin, MORE_REFUSED);
  try {
    const { kinds, seqs, rosters } = await catchUp(busy.url, server.url.origin, seed);
    expect(seqs.length).toBe(BACKLOG + 1);
    expect(inOrder(seqs)).toBe(true);
    expect(kinds).toContain("page");
    expect(rosters).toBe(1);
  } finally {
    busy.stop();
    server.stop(true);
  }
});

test("the relay answers a member's page asks only so often", async () => {
  const seed = await seeded();
  const file = new Database(join(seed.dataDir, `${seed.access.roomId}.sqlite`));
  try {
    const sql: Sql = {
      run: (q, ...p) => void file.query(q).run(...p),
      all: <T>(q: string, ...p: (string | number | null)[]) => file.query(q).all(...p) as T[],
    };
    const ctx = makeRelay(
      Layer.mergeAll(
        Layer.succeed(Human, null),
        Layer.succeed(Policy, OPEN_POLICY),
        Layer.succeed(Directory, { list: async () => [], reserve: async () => true, release: async () => {} }),
      ),
    );
    const ask = () => runRoomSync(ctx, new RoomDb(sql, seed.access.roomId), onClientFrame(JSON.stringify({ t: "more", since: seed.head - 1 }), seed.owner.pk)).reply;
    for (let i = 0; i < MORE_PER_MINUTE; i++) expect(String(ask())).toContain('"t":"page"');
    expect(String(ask())).toContain(MORE_REFUSED);
  } finally {
    file.close();
  }
});

test("an outage checks membership now and then, not before every retry, and still comes back", async () => {
  const dataDir = scratch("outage");
  let server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const port = server.port;
  const relay = server.url.origin;
  const owner = await generateIdentity("human");
  const { access } = await Channel.create(relay, owner, { name: "human" });
  const ch = new Channel(access, relay, owner);

  let ahead = 0;
  const now = () => Date.now() + ahead;
  const got: string[] = [];
  const ac = new AbortController();
  let ready!: () => void;
  const opened = new Promise<void>((r) => (ready = r));
  const listening = ch.stream(await ch.head(), (m) => void got.push(m.body), { signal: ac.signal, quietMs: 600_000, now, onReady: () => ready() });
  await opened;

  server.stop(true);
  const seen = { upgrades: 0, heads: 0 };
  const down = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path.endsWith("/ws")) seen.upgrades++;
      else if (req.method === "GET" && path.replace(/\/$/, "") === `/v1/rooms/${access.roomId}`) seen.heads++;
      return new Response(JSON.stringify({ error: "relay is restarting" }), { status: 503, headers: { "content-type": "application/json" } });
    },
  });
  const jump = setInterval(() => void (ahead += 1_000), 20);
  let counted = { upgrades: 0, heads: 0 };
  try {
    await until(() => seen.upgrades > BUDGET.outage.retries, "retries during the outage", 60_000);
    counted = { ...seen };
  } catch (err) {
    ac.abort();
    await listening;
    throw err;
  } finally {
    clearInterval(jump);
    down.stop(true);
  }
  console.log(`outage: ${counted.upgrades - 1} retries after the first, ${counted.heads} membership checks (GET /)`);

  server = startRelay({ port, hostname: "127.0.0.1", dataDir });
  try {
    await ch.send("after the outage");
    const end = Date.now() + 60_000;
    while (!got.includes("after the outage")) {
      if (Date.now() > end) throw new Error("timed out waiting for the message after the outage");
      ahead += 1_000;
      await Bun.sleep(20);
    }
    expect(counted.heads).toBeLessThanOrEqual(BUDGET.outage.headChecks);
    expect(counted.heads).toBeGreaterThanOrEqual(1);
  } finally {
    ac.abort();
    await listening;
    server.stop(true);
  }
});

test("a member removed while away still hears it on the first failed retry", async () => {
  const dataDir = scratch("removed");
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const relay = server.url.origin;
  try {
    const owner = await generateIdentity("human");
    const { code, access } = await Channel.create(relay, owner, { name: "human" });
    const ownerCh = new Channel(access, relay, owner);
    const id = await generateIdentity("temp");
    const req = await Channel.requestJoin(relay, code, id, { name: id.name });
    await ownerCh.approve((await checked(ownerCh, relay, code, [{ id, requestId: req.requestId }])).find((r) => r.id === req.requestId)!);
    const st = await Channel.joinStatus(relay, code, id, req.requestId);
    if (st.status !== "approved") throw new Error(`not approved: ${st.status}`);
    const member = new Channel(st.access, relay, id);
    await ownerCh.remove(id.pk);
    const started = Date.now();
    const outcome = await member.stream(0, () => {}, { quietMs: 600_000 }).catch((e: unknown) => e);
    expect(outcome).toMatchObject({ why: "removed" });
    expect(Date.now() - started).toBeLessThan(5_000);
  } finally {
    server.stop(true);
  }
});
