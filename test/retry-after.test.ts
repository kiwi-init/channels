import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { runAgent } from "../src/agent.ts";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { WS_PROTOCOL } from "@kiwi/core/protocol.ts";
import { MESSAGES_PER_MINUTE, take } from "../src/relay/room.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-retry-after-"));
const relay = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
afterAll(() => {
  relay.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

test("a full window says how many seconds until it opens, and a refunded attempt gives its place back", () => {
  const t0 = 1_700_000_200_000;
  const first = take("t695-window", 2, t0);
  expect("refund" in first).toBe(true);
  expect("refund" in take("t695-window", 2, t0 + 1_000)).toBe(true);
  expect(take("t695-window", 2, t0 + 15_500)).toEqual({ retryAfter: 45 });
  if ("refund" in first) first.refund();
  expect("refund" in take("t695-window", 2, t0 + 16_000)).toBe(true);
  expect(take("t695-window", 2, t0 + 59_999)).toEqual({ retryAfter: 1 });
});

test("the relay's 429 carries Retry-After, and a refused attempt isn't counted", async () => {
  const owner = await generateIdentity("human");
  const { access } = await Channel.create(relay.url.origin, owner, { name: "human" });
  const ch = new Channel(access, relay.url.origin, owner);
  const post = async (b: object) => {
    const body = JSON.stringify(b);
    const auth = await signRequest(owner, access.roomId, "POST", "/messages", body);
    const res = await fetch(new URL(`/v1/rooms/${access.roomId}/messages`, relay.url.origin), {
      method: "POST",
      body,
      headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
    });
    const json = (await res.json()) as { retryAfter?: number };
    return { status: res.status, header: res.headers.get("retry-after"), retryAfter: json.retryAfter };
  };
  for (let i = 0; i < 5; i++) expect(await post({ iv: "x", ct: "y", slot: "not a slot" })).toMatchObject({ status: 400 });
  for (let i = 0; i < MESSAGES_PER_MINUTE; i++) await ch.send(`n${i}`);
  const refused = await post({ iv: "x", ct: "y" });
  expect(refused.status).toBe(429);
  expect(refused.header).toBe(String(refused.retryAfter));
  expect(refused.retryAfter).toBeGreaterThan(0);
  expect(refused.retryAfter).toBeLessThanOrEqual(60);
});

function fakeRelay(socketRefusals: number, httpRefusals: number) {
  let sockets = socketRefusals;
  let posts = httpRefusals;
  const seen = { socketSends: 0, posts: 0 };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, srv) {
      const url = new URL(req.url);
      if (req.headers.get("upgrade") === "websocket") return srv.upgrade(req, { headers: { "sec-websocket-protocol": WS_PROTOCOL } }) ? undefined : new Response("no", { status: 400 });
      if (url.pathname.endsWith("/messages") && req.method === "POST") {
        seen.posts++;
        if (posts-- > 0) return Response.json({ error: "too many messages; wait a minute", tag: "TooMany", retryAfter: 1 }, { status: 429, headers: { "retry-after": "1" } });
        return Response.json({ seq: 7, ts: Date.now() });
      }
      return Response.json({ error: "no" }, { status: 503 });
    },
    websocket: {
      open: (ws) => void ws.send(JSON.stringify({ t: "ready", head: 0, more: false })),
      message: (ws, raw) => {
        const f = JSON.parse(String(raw)) as { t: string; id?: string };
        if (f.t !== "send") return;
        seen.socketSends++;
        if (sockets-- > 0) return void ws.send(JSON.stringify({ t: "err", error: "too many messages; wait a minute", id: f.id, tag: "TooMany", retryAfter: 1 }));
        ws.send(JSON.stringify({ t: "ack", id: f.id, seq: 9, ts: Date.now() }));
      },
    },
  });
  return { server, seen };
}

async function seat(url: string): Promise<Channel> {
  const owner = await generateIdentity("human");
  return new Channel({ roomId: "d".repeat(32), ownerPk: owner.pk, ownerXpk: owner.xpk ?? "", epoch: 0, keys: { "0": "A".repeat(43) } }, url, owner);
}

test("a send the relay rate-limits over HTTP waits Retry-After and goes in, instead of failing", async () => {
  const { server, seen } = fakeRelay(0, 1);
  try {
    const ch = await seat(server.url.origin);
    const started = Date.now();
    expect(await ch.send("after the wait")).toBe(7);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(seen.posts).toBe(2);
  } finally {
    server.stop(true);
  }
});

test("a send refused on the socket waits and goes in over the socket, without a second try over HTTP right away", async () => {
  const { server, seen } = fakeRelay(1, 0);
  try {
    const ch = await seat(server.url.origin);
    let ready = false;
    const fiber = Effect.runFork(
      Stream.runForEach(ch.fx.live(0, { presence: false, send: true }), (ev) => Effect.sync(() => void (ev._tag === "Ready" && (ready = true)))) as Effect.Effect<void, unknown, never>,
    );
    const end = Date.now() + 5_000;
    while (!ready && Date.now() < end) await Bun.sleep(10);
    const started = Date.now();
    expect(await ch.send("after the wait")).toBe(9);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(seen).toEqual({ socketSends: 2, posts: 0 });
    await runAgent(Fiber.interrupt(fiber));
  } finally {
    server.stop(true);
  }
});
