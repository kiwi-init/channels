// The pairing mailbox at the relay (src/relay/mailbox.ts, wired in
// src/relay/bun.ts and worker.ts): write-once sealed slots the relay can't
// read, gone ten minutes after the first write, open to any origin.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity } from "../src/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { answerPair, askToPair, mailboxId, newSecret, openMailbox, readPairAnswer, readPairAsk } from "../src/mailbox.ts";
import { MAILBOX_MAX_BYTES } from "../src/mailbox.ts";
import { onMailboxHttp, type MailboxStore } from "../src/relay/mailbox.ts";

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

describe("the relay's pairing mailbox", () => {
  test("a computer pairs through the real relay, and the relay learns nothing", async () => {
    const person = await generateIdentity("Ada Lovelace");
    const machine = await generateIdentity("vps-1");
    const secret = newSecret();
    const there = await openMailbox(relay, secret);
    await askToPair(machine, there, "vps-1", "linux");
    const here = await openMailbox(relay, secret);
    const ask = await readPairAsk(await here.get("a"), here);
    expect(ask?.pk).toBe(machine.pk);
    const cert = await answerPair(person, here, ask!);
    expect((await readPairAnswer(await there.wait("b", { timeoutMs: 5_000 }), machine.pk))?.cert).toEqual(cert);
    await there.drop();
    expect(await here.get("a")).toBeNull();
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
  const call = (store: MailboxStore, path: string, init?: RequestInit, opts?: Parameters<typeof onMailboxHttp>[2]) =>
    onMailboxHttp(new Request(`http://relay.test${path}`, init), store, opts);

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
