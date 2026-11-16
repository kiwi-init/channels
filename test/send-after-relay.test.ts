import { Database } from "bun:sqlite";
import { afterAll, afterEach, describe, expect, mock, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel, RelayError } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { AFTER_SKEW_MS } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { OPEN_POLICY } from "../src/relay/policy.ts";

setDefaultTimeout(30_000);

class DurableObjectStandIn {
  constructor(
    public ctx: unknown,
    public env: unknown,
  ) {}
}
mock.module("cloudflare:workers", () => ({ DurableObject: DurableObjectStandIn }));
Object.assign(globalThis, { WebSocketRequestResponsePair: class {} });

const policy = { ...OPEN_POLICY, noRateLimits: true };
const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
afterEach(() => setSystemTime());
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "kiwi-send-after-"));
  made.push(d);
  return d;
};

const refusal = async (p: Promise<unknown>): Promise<{ status: number; tag: string } | "sent"> =>
  p.then(
    () => "sent" as const,
    (err: unknown) => (err instanceof RelayError ? { status: err.status, tag: err.tag } : { status: 0, tag: String(err) }),
  );

const MOVED = { status: 412, tag: "MovedOn" };
const OFF = { status: 412, tag: "OffClock" };
const T = Date.parse("2026-11-16T21:00:00Z");

async function room(origin: string, owner: Identity): Promise<Channel> {
  const { access } = await Channel.create(origin, owner, { name: "after", kind: "human" }, []);
  return new Channel(access, origin, owner);
}

async function headHolds(ch: Channel): Promise<void> {
  setSystemTime(T);
  const on = (head: number, at = T) => ({ head, at });
  await ch.send("first");
  const head = await ch.head();
  expect(await ch.send("on the head", { after: on(head) })).toBe(head + 1);
  expect(await refusal(ch.send("on a stale head", { after: on(head) }))).toEqual(MOVED);
  expect(await refusal(ch.send("judged just past the window ahead", { after: on(head + 1, T - AFTER_SKEW_MS - 1) }))).toEqual(OFF);
  expect(await refusal(ch.send("judged just past the window behind", { after: on(head + 1, T + AFTER_SKEW_MS + 1) }))).toEqual(OFF);
  expect(await refusal(ch.send("stale head and off the clock", { after: on(head, T + 60_000) }))).toEqual(MOVED);
  expect(await ch.head()).toBe(head + 1);
  expect(await ch.send("at the window's early edge", { after: on(head + 1, T - AFTER_SKEW_MS) })).toBe(head + 2);
  expect(await ch.send("at the window's late edge", { after: on(head + 2, T + AFTER_SKEW_MS) })).toBe(head + 3);
  const [a, b] = await Promise.all([refusal(ch.send("one", { after: on(head + 3) })), refusal(ch.send("two", { after: on(head + 3) }))]);
  expect([a, b].filter((r) => r === "sent")).toHaveLength(1);
  expect([a, b].filter((r) => r !== "sent")).toEqual([MOVED]);
  expect(await ch.head()).toBe(head + 4);
  const cid = "retry-of-one-send-0001";
  const kept = await ch.send("kept", { after: on(head + 4), cid });
  expect(await ch.send("kept", { after: on(head + 4), cid })).toBe(kept);
  expect(await refusal(ch.send("no occurrence on a head", { after: on(kept), occurrence: "2026-11-16T18:00" }))).toEqual({ status: 400, tag: "BadRequest" });
  expect(await ch.head()).toBe(kept);
  const stored = (await ch.history(head)).messages.map((m) => m.rts);
  expect(stored).toEqual(stored.map(() => T));
}

describe("a send on a known head: the relay appends it only while that head is still its last message (#2491)", () => {
  test("on the Bun relay", async () => {
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch(), policy });
    try {
      await headHolds(await room(r.url.origin, await generateIdentity("bun")));
    } finally {
      r.stop(true);
    }
  });

  test("on the worker's Durable Object", async () => {
    const dir = scratch();
    const owner = await generateIdentity("worker");
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, policy });
    let ch: Channel;
    try {
      ch = await room(r.url.origin, owner);
    } finally {
      r.stop(true);
    }
    const file = new Database(join(dir, `${ch.roomId}.sqlite`));
    const ctx = {
      storage: {
        sql: { exec: (q: string, ...p: (string | number | null)[]) => ({ toArray: () => file.query(q).all(...p) }) },
        transactionSync: <T>(work: () => T): T => file.transaction(work)(),
        setAlarm: async () => {},
        deleteAlarm: async () => {},
        deleteAll: async () => {},
      },
      getWebSockets: () => [],
      setWebSocketAutoResponse: () => {},
      waitUntil: () => {},
    };
    const worker = "../src/relay/worker.ts";
    const { Channel: Room } = (await import(worker)) as { Channel: new (ctx: unknown, env: Record<string, string>) => { fetch(req: Request): Promise<Response> } };
    const object = new Room(ctx, {});
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => object.fetch(req) });
    try {
      await headHolds(new Channel(ch.access, server.url.origin, owner));
    } finally {
      server.stop(true);
      file.close();
    }
  });

  test("a relay without the route answers 404 and appends nothing, while a plain send still reaches it", async () => {
    const appended: string[] = [];
    const old = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) => {
        const path = new URL(req.url).pathname;
        if (req.method === "POST" && path.endsWith("/messages")) {
          appended.push(path);
          return Response.json({ seq: appended.length, ts: Date.now() });
        }
        return Response.json({ error: "not found", tag: "NotFound" }, { status: 404 });
      },
    });
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch(), policy });
    try {
      const owner = await generateIdentity("old");
      const real = await room(r.url.origin, owner);
      const ch = new Channel(real.access, old.url.origin, owner);
      expect(await refusal(ch.send("a clock mark", { after: { head: 0, at: Date.now() } }))).toEqual({ status: 404, tag: "NotFound" });
      expect(appended).toEqual([]);
      expect(await ch.send("plain")).toBe(1);
      expect(appended).toHaveLength(1);
    } finally {
      r.stop(true);
      old.stop(true);
    }
  });
});
