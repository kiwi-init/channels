// The one-time mailbox at the relay (src/relay/mailbox.ts, wired in
// src/relay/bun.ts and worker.ts): write-once sealed slots the relay can't
// read, gone ten minutes after the first write, open to any origin.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { mailboxId, newSecret, openMailbox } from "@kiwi/core/mailbox.ts";
import { MAILBOX_MAX_BYTES } from "@kiwi/core/mailbox.ts";
import { onMailboxHttp, sqlMailboxStore, type MailboxStore } from "../src/relay/mailbox.ts";
import type { Sql, SqlParam } from "../src/relay/room/db.ts";

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-mailbox-relay-"));
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the relay's one-time mailbox", () => {
  test("two sides meet through the real relay, and the relay learns nothing", async () => {
    const machine = await generateIdentity("vps-1");
    const secret = newSecret();
    const there = await openMailbox(relay, secret);
    await there.put("a", { pk: machine.pk });
    const here = await openMailbox(relay, secret);
    expect(await here.get<{ pk: string }>("a")).toEqual({ pk: machine.pk });
    await here.put("b", { ok: true });
    expect(await there.wait<{ ok: boolean }>("b", { timeoutMs: 5_000 })).toEqual({ ok: true });
    await there.drop();
    expect(await here.get("a")).toBeNull();
  });

  test("waiting for the answer rides out the relay's 5xx and dropped connections (issue #714)", async () => {
    const secret = newSecret();
    let reads = 0;
    const flaky: typeof fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET" && String(input).endsWith("/b")) {
          reads++;
          if (reads === 2 || reads === 3) return new Response("worker threw", { status: 500 });
          if (reads === 4) throw new TypeError("connection reset");
        }
        return fetch(input, init);
      },
      { preconnect: fetch.preconnect },
    );
    const there = await openMailbox(relay, secret, flaky);
    const here = await openMailbox(relay, secret);
    setTimeout(() => void here.put("b", { ok: true }), 300);
    expect(await there.wait<{ ok: boolean }>("b", { timeoutMs: 10_000, everyMs: 50 })).toEqual({ ok: true });
    expect(reads).toBeGreaterThan(4);
  });

  test("a wait still ends on what can't heal: a box the code didn't seal, and a relay failing until the time is up", async () => {
    const forged: typeof fetch = Object.assign(async () => Response.json({ box: "not-sealed-by-this-code" }), { preconnect: fetch.preconnect });
    await expect((await openMailbox(relay, newSecret(), forged)).wait("b", { timeoutMs: 2_000, everyMs: 50 })).rejects.toThrow(/didn't seal/);
    const down: typeof fetch = Object.assign(async () => new Response("bad gateway", { status: 502 }), { preconnect: fetch.preconnect });
    await expect((await openMailbox(relay, newSecret(), down)).wait("b", { timeoutMs: 300, everyMs: 50 })).rejects.toThrow(/502/);
  });

  test("slots are written once, empty reads 404, drops clear", async () => {
    const mb = await openMailbox(relay, newSecret());
    expect(await mb.get("a")).toBeNull();
    await mb.put("a", { n: 1 });
    await expect(mb.put("a", { n: 2 })).rejects.toThrow(/already written/);
    expect(await mb.get<{ n: number }>("a")).toEqual({ n: 1 });
    await mb.drop();
    expect(await mb.get("a")).toBeNull();
  });

  test("oversized boxes are refused", async () => {
    const id = await mailboxId(newSecret());
    const res = await fetch(`${relay}/v1/mailbox/${id}/a`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ box: "x".repeat(MAILBOX_MAX_BYTES + 1) }),
    });
    expect(res.status).toBe(413);
  });

  test("a bad mailbox id is a 404, never a wake-up", async () => {
    const res = await fetch(`${relay}/v1/mailbox/not-a-mailbox/a`);
    expect(res.status).toBe(404);
  });

  test("/v1/* answers any origin, including the preflight", async () => {
    const id = await mailboxId(newSecret());
    const put = await fetch(`${relay}/v1/mailbox/${id}/a`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ box: "opaque" }),
    });
    expect(put.headers.get("access-control-allow-origin")).toBe("*");
    const get = await fetch(`${relay}/v1/mailbox/${id}/a`);
    expect(get.headers.get("access-control-allow-origin")).toBe("*");
    const pre = await fetch(`${relay}/v1/mailbox/${id}/a`, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    const config = await fetch(`${relay}/v1/config`);
    expect(config.headers.get("access-control-allow-origin")).toBe("*");
  });
});

const call = (store: MailboxStore, path: string, init?: RequestInit, opts?: Parameters<typeof onMailboxHttp>[2]) => onMailboxHttp(new Request(`http://relay.test${path}`, init), store, opts);

describe("mailbox expiry and write limiting", () => {
  /** In-memory store with a movable clock. */
  const fakeStore = () => {
    let rec: { a: string | null; b: string | null; firstAt: number } | null = null;
    const store: MailboxStore = {
      load: async () => rec,
      save: async (_id, r) => void (rec = r),
      drop: async () => void (rec = null),
    };
    return store;
  };

  test("a mailbox read after ten minutes is empty, and a write starts it over", async () => {
    const store = fakeStore();
    let now = 1_000_000;
    const clock = () => now;
    const id = await mailboxId(newSecret());
    expect((await call(store, `/v1/mailbox/${id}/a`, { method: "PUT", body: JSON.stringify({ box: "one" }) }, { now: clock }))?.status).toBe(204);
    now += 11 * 60_000;
    expect((await call(store, `/v1/mailbox/${id}/a`, {}, { now: clock }))?.status).toBe(404);
    expect((await call(store, `/v1/mailbox/${id}/a`, { method: "PUT", body: JSON.stringify({ box: "two" }) }, { now: clock }))?.status).toBe(204);
    expect(await (await call(store, `/v1/mailbox/${id}/a`, {}, { now: clock }))?.json()).toEqual({ box: "two" });
  });

  test("a refusing limiter answers 429 on writes, never on reads", async () => {
    const store = fakeStore();
    const id = await mailboxId(newSecret());
    const gate = { ip: "10.0.0.7", allow: () => false };
    expect((await call(store, `/v1/mailbox/${id}/a`, { method: "PUT", body: JSON.stringify({ box: "x" }) }, gate))?.status).toBe(429);
    expect((await call(store, `/v1/mailbox/${id}/a`, {}, gate))?.status).toBe(404);
  });
});

describe("the Durable Object's mailbox store", () => {
  const durable = () => {
    const db = new Database(":memory:");
    const sql: Sql = {
      run: (q, ...p) => void db.query(q).run(...p),
      all: <T>(q: string, ...p: SqlParam[]) => db.query(q).all(...p) as T[],
    };
    const tables = () => (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    let alarm: number | null = null;
    const store = sqlMailboxStore(sql, {
      expireAt: async (at) => void (alarm = at),
      wipe: async () => {
        alarm = null;
        for (const name of tables()) db.run(`DROP TABLE ${name}`);
      },
    });
    return { store, tables, alarm: () => alarm };
  };

  test("a read after the mailbox is dropped is a 404, and reads leave no tables behind", async () => {
    const { store, tables, alarm } = durable();
    const id = await mailboxId(newSecret());
    expect((await call(store, `/v1/mailbox/${id}/a`))?.status).toBe(404);
    expect(tables()).toEqual([]);
    expect((await call(store, `/v1/mailbox/${id}/a`, { method: "PUT", body: JSON.stringify({ box: "ask" }) }))?.status).toBe(204);
    expect((await call(store, `/v1/mailbox/${id}/b`, { method: "PUT", body: JSON.stringify({ box: "answer" }) }))?.status).toBe(204);
    expect(await (await call(store, `/v1/mailbox/${id}/b`))?.json()).toEqual({ box: "answer" });
    expect(alarm()).not.toBeNull();
    expect((await call(store, `/v1/mailbox/${id}`, { method: "DELETE" }))?.status).toBe(204);
    expect(tables()).toEqual([]);
    expect(alarm()).toBeNull();
    expect((await call(store, `/v1/mailbox/${id}/b`))?.status).toBe(404);
    expect(tables()).toEqual([]);
    expect((await call(store, `/v1/mailbox/${id}/a`, { method: "PUT", body: JSON.stringify({ box: "again" }) }))?.status).toBe(204);
    expect(await (await call(store, `/v1/mailbox/${id}/a`))?.json()).toEqual({ box: "again" });
  });
});
