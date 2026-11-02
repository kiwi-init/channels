import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { edgePage, PAGE_CAP_MS, type PageCache } from "../src/relay/pages.ts";
import { startRelay } from "../src/relay/bun.ts";
import { OPEN_POLICY, policyFrom } from "../src/relay/policy.ts";
import { fill, roomWith, type PagedRoom } from "./pages-room.ts";

setDefaultTimeout(60_000);

const KEY = "a-page-key-only-this-relay-knows-0123456789";
const clock = { now: Date.now() };
const dirs: string[] = [];
const servers: ReturnType<typeof startRelay>[] = [];
let relay = "";
let dataDir = "";
let room: PagedRoom;

function start(pageKey: string | null): { relay: string; dataDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-pages-"));
  dirs.push(dir);
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, policy: { ...OPEN_POLICY, pageKey }, now: () => clock.now });
  servers.push(server);
  return { relay: server.url.origin, dataDir: dir };
}

beforeAll(async () => {
  ({ relay, dataDir } = start(KEY));
  room = await roomWith(relay, dataDir, 3000);
});

afterAll(() => {
  for (const s of servers) s.stop(true);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function get(base: string, roomId: string, path: string, as?: Identity): Promise<Response> {
  const headers: Record<string, string> = {};
  if (as) headers.authorization = `Bearer ${await signRequest(as, roomId, "GET", path)}`;
  return fetch(`${base}/v1/rooms/${roomId}${path}`, { headers });
}

async function offer(as: Identity, base = relay, roomId = room.roomId): Promise<{ cap: string; exp: number; next: number }> {
  const res = await get(base, roomId, "/messages?since=0&pages=1", as);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { pages?: { cap: string; exp: number; next: number } };
  expect(body.pages).toBeDefined();
  return body.pages!;
}

const page = (k: number, cap: string, as?: Identity, roomId = room.roomId, base = relay) => get(base, roomId, `/pages/${k}?cap=${encodeURIComponent(cap)}`, as);

const messagesPart = (text: string) => text.slice(text.indexOf('"messages":'));

describe("old pages", () => {
  test("a member's capability reads a complete page, byte for byte what /messages answers", async () => {
    const { cap, next } = await offer(room.owner);
    expect(next).toBe(1000);
    for (const k of [0, 1, 2]) {
      const viaMessages = await (await get(relay, room.roomId, `/messages?since=${k * 1000}`, room.owner)).text();
      const miss = await page(k, cap, room.owner);
      expect(miss.status).toBe(200);
      const first = await miss.text();
      const hit = await page(k, cap, room.owner);
      expect(hit.headers.get("x-kiwi-cache")).toBe("hit");
      const again = await hit.text();
      expect(messagesPart(first)).toBe(messagesPart(viaMessages));
      expect(messagesPart(again)).toBe(messagesPart(viaMessages));
      expect((JSON.parse(first) as { messages: unknown[] }).messages).toHaveLength(1000);
    }
  });

  test("a capability covers only the pages complete when it was issued", async () => {
    const { cap } = await offer(room.owner);
    expect((await page(3, cap, room.owner)).status).toBe(403);
    const more = cap.replace(/\.(\d+)\.([A-Za-z0-9_-]{43})$/, (_, n: string, mac: string) => `.${Number(n) + 1}.${mac}`);
    expect(more).not.toBe(cap);
    expect((await page(3, more, room.owner)).status).toBe(403);
    expect((await page(0, more, room.owner)).status).toBe(403);
  });

  test("never to someone who isn't a member, nor without the signature, nor with another key's capability", async () => {
    const { cap } = await offer(room.owner);
    const stranger = await generateIdentity("eve");
    expect((await get(relay, room.roomId, "/messages?since=0&pages=1", stranger)).status).toBe(404);
    for (const k of [0, 2]) {
      expect((await page(k, cap)).status).toBe(401);
      expect((await page(k, cap, stranger)).status).toBe(403);
      expect((await page(k, cap, room.agent)).status).toBe(403);
      expect((await page(k, "", room.owner)).status).toBe(403);
    }
  });

  test("a tampered or another room's capability is refused", async () => {
    const { cap } = await offer(room.owner);
    const flipped = cap.slice(0, -2) + (cap.endsWith("AA") ? "BB" : "AA");
    expect((await page(0, flipped, room.owner)).status).toBe(403);
    const later = cap.replace(/\.(\d+)\./, (_, exp: string) => `.${Number(exp) + 1000}.`);
    expect((await page(0, later, room.owner)).status).toBe(403);
    const other = await roomWith(relay, dataDir, 2000);
    const { cap: otherCap } = await offer(other.owner, relay, other.roomId);
    expect((await page(0, otherCap, room.owner)).status).toBe(403);
    expect((await page(0, cap, other.owner, other.roomId)).status).toBe(403);
  });

  test("an expired capability is refused, cached page or not", async () => {
    const { cap } = await offer(room.owner);
    expect((await page(1, cap, room.owner)).status).toBe(200);
    clock.now += PAGE_CAP_MS + 1;
    try {
      expect((await page(1, cap, room.owner)).status).toBe(403);
      expect((await page(0, cap, room.owner)).status).toBe(403);
    } finally {
      clock.now -= PAGE_CAP_MS + 1;
    }
  });

  test("a removed member is refused anything the cache doesn't already hold", async () => {
    const r = await roomWith(relay, dataDir, 2000);
    const { cap } = await offer(r.agent, relay, r.roomId);
    expect((await page(0, cap, r.agent, r.roomId)).headers.get("x-kiwi-cache")).toBe("miss");
    await r.ownerCh.remove(r.agent.pk);
    const cached = await page(0, cap, r.agent, r.roomId);
    expect(cached.status).toBe(200);
    expect(cached.headers.get("x-kiwi-cache")).toBe("hit");
    expect((await page(1, cap, r.agent, r.roomId)).status).toBe(403);
    expect((await get(relay, r.roomId, "/messages?since=0&pages=1", r.agent)).status).toBe(403);
  });

  test("a closed room's pages are refused, and a room re-created under its id never reaches them", async () => {
    const r = await roomWith(relay, dataDir, 2000);
    const { cap } = await offer(r.owner, relay, r.roomId);
    expect((await page(0, cap, r.owner, r.roomId)).status).toBe(200);
    await r.ownerCh.close();
    expect((await page(0, cap, r.owner, r.roomId)).status).toBe(404);
    expect((await page(1, cap, r.owner, r.roomId)).status).toBe(404);
    await Channel.create(relay, r.owner, { name: "boss" }, [], r.roomId);
    const again = new Channel(r.ownerCh.access, relay, r.owner);
    for (let i = 0; i < 3; i++) await again.send(`again ${i}`);
    const res = await page(0, cap, r.owner, r.roomId);
    expect(res.status).toBe(403);
  });

  test("an edge cache that outlives a close never gives a re-created room's capability the old room's pages", async () => {
    const r = await roomWith(relay, dataDir, 2000);
    const kept = new Map<string, string>();
    const cache: PageCache = {
      match: async (key) => {
        const body = kept.get(key);
        return body === undefined ? undefined : new Response(body);
      },
      put: async (key, res) => {
        kept.set(key, await res.text());
      },
    };
    const edge = async (k: number, cap: string): Promise<Response> => {
      const path = `/pages/${k}?cap=${encodeURIComponent(cap)}`;
      const url = `${relay}/v1/rooms/${r.roomId}${path}`;
      const headers = { authorization: `Bearer ${await signRequest(r.owner, r.roomId, "GET", path)}` };
      return edgePage(new Request(url, { headers }), r.roomId, `/pages/${k}`, KEY, cache, () => fetch(url, { headers }), clock.now);
    };
    const before = await offer(r.owner, relay, r.roomId);
    const warm = await edge(0, before.cap);
    expect(warm.headers.get("x-kiwi-cache")).toBe("miss");
    const oldPage = messagesPart(await warm.text());
    await r.ownerCh.close();
    await Channel.create(relay, r.owner, { name: "boss" }, [], r.roomId);
    await new Channel(r.ownerCh.access, relay, r.owner).send("again");
    fill(dataDir, r.roomId, 2000);
    const after = await offer(r.owner, relay, r.roomId);
    const res = await edge(0, after.cap);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-kiwi-cache")).toBe("miss");
    const newPage = messagesPart(await res.text());
    expect(newPage).toBe(messagesPart(await (await get(relay, r.roomId, "/messages?since=0", r.owner)).text()));
    expect(newPage).not.toBe(oldPage);
  });

  test("history() reads through pages and gets every message once", async () => {
    const { head, messages } = await room.fresh(room.agent).history(0);
    expect(head).toBe(3000);
    expect(messages.map((m) => m.seq)).toEqual(Array.from({ length: 3000 }, (_, i) => i + 1));
    const tail = await room.fresh().history(1500);
    expect(tail.messages.map((m) => m.seq)).toEqual(Array.from({ length: 1500 }, (_, i) => i + 1501));
  });
});

describe("a relay without KIWI_PAGE_KEY", () => {
  test("offers no pages and has no page route; history() reads /messages as before", async () => {
    const off = start(null);
    const r = await roomWith(off.relay, off.dataDir, 2500);
    const body = (await (await get(off.relay, r.roomId, "/messages?since=0&pages=1", r.owner)).json()) as { messages: unknown[]; pages?: unknown };
    expect(body.pages).toBeUndefined();
    expect(body.messages).toHaveLength(1000);
    expect((await get(off.relay, r.roomId, "/pages/0?cap=x", r.owner)).status).toBe(404);
    expect((await r.fresh().history(0)).messages).toHaveLength(2500);
  });

  test("a key shorter than 32 characters leaves pages off", () => {
    expect(OPEN_POLICY.pageKey).toBeNull();
    expect(policyFrom({ KIWI_PAGE_KEY: "short" }).pageKey).toBeNull();
    expect(policyFrom({ KIWI_PAGE_KEY: KEY }).pageKey).toBe(KEY);
  });
});
