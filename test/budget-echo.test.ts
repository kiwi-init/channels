import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type { ChannelIdentityView, FollowEvent } from "../desktop/src/bridge.ts";
import { Keyring, type KeyHost } from "../desktop/src/keyring.ts";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel, eachLive, fetchRelay, Relay } from "@kiwi/core/client.ts";
import type { ChannelAccess } from "@kiwi/core/crypto.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { WS_PROTOCOL, type Message, type ServerFrame } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import * as Layer from "effect/Layer";
import { Human } from "../src/relay/human.ts";
import { GithubApp, GithubPush, githubPushFrom } from "../src/relay/github-app.ts";
import { OPEN_POLICY, Policy } from "../src/relay/policy.ts";
import { Directory, onClientFrame, RoomDb, type Effects, type Sql } from "../src/relay/room.ts";
import { makeRelay, runRoomSync } from "../src/relay/route.ts";
import { memoryBudget } from "./check.ts";
import { sum, trafficProxy, type Traffic } from "./traffic.ts";

setDefaultTimeout(60_000);

const K = 5;
const BODY = "QUFB".repeat(25_000);
const IMAGE = Buffer.from(new Uint8Array(75_000).map((_, i) => (i * 31) % 251)).toString("base64");

const BUDGET = {
  socket: { echo: { msgDown: K }, noEcho: { msgDown: 0, bytesDown: 2_000 } },
  app: { http: 1, msgDown: 0, bytesDown: 4_000 },
} as const;

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-budget-echo-"));
let server: ReturnType<typeof startRelay> | undefined;
let proxy: ReturnType<typeof trafficProxy> | undefined;
let legacy: ReturnType<typeof legacyRelay> | undefined;
let roomId = "";
let code = "";
let access: ChannelAccess;
let human: Identity;
let mac: Identity;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
  legacy = legacyRelay(server.url.origin);
  human = await generateIdentity("human");
  mac = await generateIdentity("mac");
  const created = await Channel.create(server.url.origin, human, { name: "human" }, [{ ...mac, info: { name: "mac" } }]);
  roomId = created.access.roomId;
  code = created.code;
  access = created.access;
});

afterAll(() => {
  legacy?.stop();
  proxy?.stop();
  server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

type Pipe = { up: WebSocket; early: string[]; client: ServerWebSocket<Pipe> | null };

const asOldRelay = (data: string): string => {
  const f = JSON.parse(data) as ServerFrame;
  return f.t === "ack" ? JSON.stringify({ t: "ack", id: f.id, seq: f.seq }) : data;
};

function upstream(url: string, protocols: string[]): Promise<Pipe | null> {
  return new Promise((resolve) => {
    const up = new WebSocket(url, protocols);
    const pipe: Pipe = { up, early: [], client: null };
    up.onopen = () => resolve(pipe);
    up.onerror = () => resolve(null);
    up.onmessage = (ev: MessageEvent<string>) => {
      const out = asOldRelay(String(ev.data));
      if (pipe.client) pipe.client.send(out);
      else pipe.early.push(out);
    };
    up.onclose = (ev) => {
      resolve(null);
      try {
        pipe.client?.close(ev.code === 1005 || ev.code === 1006 ? 1000 : ev.code, ev.reason);
      } catch {
        // The client already hung up: nothing to pass the close on to.
      }
    };
  });
}

function legacyRelay(target: string): { url: string; refused: () => number; stop: () => void } {
  let refused = 0;
  const srv = Bun.serve<Pipe>({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req, s) {
      const url = new URL(req.url);
      if (req.headers.get("upgrade") === "websocket") {
        url.searchParams.delete("echo");
        const protocols = (req.headers.get("sec-websocket-protocol") ?? "")
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        const pipe = await upstream(target.replace(/^http/, "ws") + url.pathname + url.search, protocols);
        if (!pipe) {
          refused++;
          return new Response(null, { status: 401 });
        }
        if (s.upgrade(req, { data: pipe, headers: { "sec-websocket-protocol": WS_PROTOCOL } })) return undefined;
        pipe.up.close(1000);
        return new Response(null, { status: 400 });
      }
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : new Uint8Array(await req.arrayBuffer());
      const res = await fetch(target + url.pathname + url.search, { method: req.method, headers: req.headers, body });
      const headers = new Headers(res.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(res.status === 204 ? null : new Uint8Array(await res.arrayBuffer()), { status: res.status, headers });
    },
    websocket: {
      open(ws) {
        ws.data.client = ws;
        for (const out of ws.data.early) ws.send(out);
        ws.data.early = [];
      },
      message(ws, data) {
        ws.data.up.send(String(data));
      },
      close(ws) {
        try {
          ws.data.up.close(1000);
        } catch {
          // The upstream is already closed: nothing to pass the close on to.
        }
      },
    },
  });
  return { url: srv.url.origin, refused: () => refused, stop: () => srv.stop(true) };
}

interface Sock {
  ws: WebSocket;
  frames: ServerFrame[];
  wait: (pred: (fs: ServerFrame[]) => boolean, label: string) => Promise<void>;
}

async function until(pred: () => boolean, label: string, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(20);
  }
}

async function open(origin: string, query: string): Promise<Sock> {
  const u = new URL(`/v1/rooms/${roomId}/ws?${query}`, origin);
  u.protocol = "ws:";
  const ws = new WebSocket(u, [WS_PROTOCOL, await signRequest(mac, roomId, "GET", "/ws")]);
  const frames: ServerFrame[] = [];
  ws.onmessage = (ev: MessageEvent<string>) => void frames.push(JSON.parse(String(ev.data)) as ServerFrame);
  const wait = (pred: (fs: ServerFrame[]) => boolean, label: string) => until(() => pred(frames), label);
  await wait((fs) => fs.some((f) => f.t === "ready"), "ready");
  return { ws, frames, wait };
}

const count = (fs: ServerFrame[], t: ServerFrame["t"]) => fs.filter((f) => f.t === t).length;

async function sendK(query: string): Promise<{ traffic: Traffic; acks: Extract<ServerFrame, { t: "ack" }>[]; sender: Sock; other: Sock }> {
  const other = await open(server!.url.origin, "since=1000000");
  const sender = await open(proxy!.url, `since=1000000${query}`);
  await Bun.sleep(100);
  proxy!.reset();
  for (let i = 0; i < K; i++) sender.ws.send(JSON.stringify({ t: "send", id: `m${i}`, iv: "aXZpdml2aXZpdml2", ct: BODY, e: 0 }));
  await sender.wait((fs) => count(fs, "ack") === K, "acks");
  await other.wait((fs) => count(fs, "msg") === K, "the other socket's msgs");
  await Bun.sleep(200);
  const traffic = proxy!.reset();
  sender.ws.close();
  other.ws.close();
  const acks = sender.frames.filter((f): f is Extract<ServerFrame, { t: "ack" }> => f.t === "ack");
  return { traffic, acks, sender, other };
}

describe("relay: a socket's own sends", () => {
  test("echo (default): the sender downloads its own ciphertext back", async () => {
    const { traffic, sender } = await sendK("");
    console.log(`[socket, echo] sender: frames down ${JSON.stringify(traffic.framesDown)}, bytes down ${traffic.bytesDown}`);
    expect(traffic.framesDown.msg ?? 0).toBe(BUDGET.socket.echo.msgDown);
    expect(count(sender.frames, "msg")).toBe(K);
  });

  test("echo=0: the ack carries seq and ts, no msg comes back, other sockets of the same key still get it", async () => {
    const { traffic, acks, sender, other } = await sendK("&echo=0");
    console.log(`[socket, echo=0] sender: frames down ${JSON.stringify(traffic.framesDown)}, bytes down ${traffic.bytesDown}`);
    expect(traffic.framesDown.msg ?? 0).toBe(BUDGET.socket.noEcho.msgDown);
    expect(traffic.bytesDown).toBeLessThanOrEqual(BUDGET.socket.noEcho.bytesDown);
    expect(sum(traffic.framesDown)).toBe(K);
    expect(count(sender.frames, "msg")).toBe(0);
    const msgs = other.frames.filter((f): f is Extract<ServerFrame, { t: "msg" }> => f.t === "msg");
    expect(acks.map((a) => ({ seq: a.seq, ts: a.ts }))).toEqual(msgs.map((m) => ({ seq: m.seq, ts: m.ts })));
    expect(msgs.every((m) => m.ct === BODY)).toBe(true);
  });
});

const seat = (): ChannelIdentityView => ({
  label: "budget",
  idName: "mac",
  pk: mac.pk,
  sk: mac.sk,
  ...(mac.xpk ? { xpk: mac.xpk } : {}),
  ...(mac.xsk ? { xsk: mac.xsk } : {}),
  roomId,
  code,
  access,
  at: Date.now(),
});

function app(relay: string): Keyring {
  const seats = [seat()];
  const host: KeyHost = {
    relay: () => relay,
    seats: () => seats,
    save: async () => {},
    access: async () => {},
    forget: async () => {},
    prove: async () => null,
    githubToken: async () => null,
    person: () => null,
    mine: () => null,
    budget: memoryBudget(),
  };
  return new Keyring(host);
}

interface Seen {
  messages: Message[];
  stop: () => void;
}

async function follow(k: Keyring, since: number): Promise<Seen> {
  const messages: Message[] = [];
  let opened = false;
  const stop = k.follow(code, since, (e: FollowEvent) => {
    if (e._tag === "Open") opened = true;
    if (e._tag === "Message") messages.push(e.message);
  });
  await until(() => opened, "open");
  await Bun.sleep(150);
  return { messages, stop };
}

const opts = (i: number) => (i === 0 ? { imgs: [{ name: "shot.png", mime: "image/png", data: IMAGE }] } : {});

async function appSends(k: Keyring, label: string): Promise<{ traffic: Traffic; seqs: number[]; seen: Message[] }> {
  const head = await new Channel(access, server!.url.origin, mac).head();
  const seen = await follow(k, head);
  proxy!.reset();
  const seqs: number[] = [];
  for (let i = 0; i < K; i++) seqs.push(await k.call(code, "send", `${label} ${i}`, opts(i)));
  await until(() => seen.messages.length >= K, "own messages in the stream");
  await Bun.sleep(200);
  const traffic = proxy!.reset();
  seen.stop();
  return { traffic, seqs, seen: seen.messages };
}

function expectOwn(seen: Message[], seqs: number[], label: string): void {
  expect(seen.map((m) => m.seq)).toEqual(seqs);
  expect(seen.map((m) => m.body)).toEqual(seqs.map((_, i) => `${label} ${i}`));
  expect(seen.every((m) => m.from === "mac" && m.pk === mac.pk && m.sigOk && typeof m.rts === "number")).toBe(true);
  expect(seen[0]!.imgs?.[0]?.data).toBe(IMAGE);
}

describe("app: the open conversation's sends", () => {
  test("before: a channel on echo posts each message and downloads it back", async () => {
    const ch = new Channel(access, proxy!.url, mac);
    const head = await ch.head();
    const seen: Message[] = [];
    const fiber = Effect.runFork(
      Effect.provideService(
        eachLive(
          ch.fx.live(head, { presence: false }),
          (ev) => Effect.sync(() => void (ev._tag === "Message" && seen.push(ev.message))),
          () => Effect.void,
        ),
        Relay,
        fetchRelay,
      ),
    );
    await Bun.sleep(300);
    proxy!.reset();
    const seqs: number[] = [];
    for (let i = 0; i < K; i++) seqs.push(await ch.send(`echo ${i}`, opts(i)));
    await until(() => seen.length >= K, "echoes");
    await Bun.sleep(200);
    const traffic = proxy!.reset();
    await Effect.runPromise(Fiber.interrupt(fiber));
    console.log(`[app, echo] http ${traffic.http} ${JSON.stringify(traffic.routes)}, frames down ${JSON.stringify(traffic.framesDown)}, bytes down ${traffic.bytesDown}`);
    expect(traffic.routes["POST /messages"]).toBe(K);
    expect(traffic.framesDown.msg).toBe(K);
    expectOwn(seen, seqs, "echo");
  });

  test("after: the app sends on its live socket and builds each message from the ack", async () => {
    const { traffic, seqs, seen } = await appSends(app(proxy!.url), "app");
    console.log(
      `[app, socket] http ${traffic.http} ${JSON.stringify(traffic.routes)}, frames up ${JSON.stringify(traffic.framesUp)}, frames down ${JSON.stringify(traffic.framesDown)}, bytes down ${traffic.bytesDown}`,
    );
    expect(traffic.http).toBe(BUDGET.app.http);
    expect(traffic.framesDown.msg ?? 0).toBe(BUDGET.app.msgDown);
    expect(traffic.bytesDown).toBeLessThanOrEqual(BUDGET.app.bytesDown);
    expect(traffic.framesUp.send).toBe(K);
    expectOwn(seen, seqs, "app");
    const { messages } = await new Channel(access, server!.url.origin, mac).history(seqs[0]! - 1);
    expect(messages.map((m) => [m.seq, m.rts, m.body])).toEqual(seen.map((m) => [m.seq, m.rts, m.body]));
  });

  test("an old relay that still echoes: each message shows once", async () => {
    const k = app(legacy!.url);
    const head = await new Channel(access, server!.url.origin, mac).head();
    const seen = await follow(k, head);
    const seqs: number[] = [];
    for (let i = 0; i < K; i++) seqs.push(await k.call(code, "send", `old ${i}`, opts(i)));
    await until(() => seen.messages.length >= K, "echoes");
    await Bun.sleep(300);
    seen.stop();
    expectOwn(seen.messages, seqs, "old");
    expect(legacy!.refused()).toBeGreaterThan(0);
  });

  test("interleaved with someone else's posts: the stream stays in seq order with no gaps or repeats", async () => {
    const k = app(proxy!.url);
    const owner = new Channel(access, server!.url.origin, human);
    const head = await owner.head();
    const seen = await follow(k, head);
    const sent = await Promise.all([...Array.from({ length: K }, (_, i) => k.call(code, "send", `mine ${i}`)), ...Array.from({ length: K }, (_, i) => owner.send(`theirs ${i}`))]);
    await until(() => seen.messages.length >= 2 * K, "every message");
    await Bun.sleep(200);
    seen.stop();
    expect(seen.messages.map((m) => m.seq)).toEqual(Array.from({ length: 2 * K }, (_, i) => head + 1 + i));
    expect(new Set(sent).size).toBe(2 * K);
  });

  test("a refusal on the socket falls back to the HTTP answer", async () => {
    const owner = new Channel(access, server!.url.origin, human);
    const k = app(proxy!.url);
    const seen = await follow(k, await owner.head());
    await owner.setCanPost(mac.pk, false);
    const viaHttp = await new Channel(access, server!.url.origin, mac).send("nope").then(
      () => "sent",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    proxy!.reset();
    const viaApp = await k.call(code, "send", "nope").then(
      () => "sent",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    const traffic = proxy!.reset();
    await owner.setCanPost(mac.pk, true);
    seen.stop();
    expect(viaHttp).not.toBe("sent");
    expect(viaApp).toBe(viaHttp);
    expect(traffic.framesUp.send).toBe(1);
    expect(traffic.routes["POST /messages"]).toBe(1);
  });
});

describe("a socket send the relay stored", () => {
  test("is acked even when the idle-expiry write after it fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-echo-touch-"));
    const relay = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir });
    const owner = await generateIdentity("boss");
    const { access } = await Channel.create(relay.url.origin, owner, { name: "boss" });
    relay.stop(true);
    const file = new Database(join(dir, `${access.roomId}.sqlite`));
    try {
      const sql: Sql = {
        run: (q, ...p) => {
          if (p.includes("active")) throw new Error("storage failed");
          file.query(q).run(...p);
        },
        all: <T>(q: string, ...p: (string | number | null)[]) => file.query(q).all(...p) as T[],
      };
      const ctx = makeRelay(
        Layer.mergeAll(
          Layer.succeed(Human, null),
          Layer.succeed(GithubApp, null),
          Layer.succeed(GithubPush, githubPushFrom()),
          Layer.succeed(Policy, { ...OPEN_POLICY, expireAfterDays: 30 }),
          Layer.succeed(Directory, { list: async () => [], reserve: async () => true, release: async () => {} }),
        ),
      );
      const before = (file.query("SELECT COUNT(*) AS n FROM msgs").get() as { n: number }).n;
      const logged: unknown[] = [];
      const log = console.error;
      console.error = (...args: unknown[]) => void logged.push(...args);
      let fx: Effects;
      try {
        fx = runRoomSync(ctx, new RoomDb(sql, access.roomId), onClientFrame(JSON.stringify({ t: "send", id: "kept", iv: "aXZpdml2aXZpdml2", ct: "Y3Z2", e: 0 }), owner.pk));
      } finally {
        console.error = log;
      }
      expect(logged).toContain("storage failed");
      expect((file.query("SELECT COUNT(*) AS n FROM msgs").get() as { n: number }).n).toBe(before + 1);
      expect(fx.reply).toContain('"t":"ack"');
      expect(fx.reply).not.toContain('"t":"err"');
    } finally {
      file.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
