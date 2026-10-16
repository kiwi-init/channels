import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";
import { OPEN_POLICY } from "../src/relay/policy.ts";
import { roomWith, type PagedRoom } from "./pages-room.ts";
import { sum, trafficProxy } from "./traffic.ts";

setDefaultTimeout(120_000);

const MESSAGES = 3000;

const BUDGET = {
  cold: { http: 3, room: 3 },
  warm: { http: 3, room: 1 },
} as const;

interface Relayed {
  dataDir: string;
  server: ReturnType<typeof startRelay>;
  proxy: ReturnType<typeof trafficProxy>;
  room: PagedRoom;
}

const made: Relayed[] = [];

async function relayed(pageKey: string | null): Promise<Relayed> {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-budget-pages-"));
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, policy: { ...OPEN_POLICY, pageKey } });
  const proxy = trafficProxy(server.url.origin);
  const room = await roomWith(proxy.url, dataDir, MESSAGES);
  const r = { dataDir, server, proxy, room };
  made.push(r);
  return r;
}

const realFetch = globalThis.fetch;
const seen: { origin: string; cache: string | null }[] = [];

beforeAll(() => {
  const counting = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const res = await realFetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.startsWith("/v1/rooms/")) seen.push({ origin: url.origin, cache: res.headers.get("x-kiwi-cache") });
    return res;
  };
  globalThis.fetch = Object.assign(counting, { preconnect: realFetch.preconnect });
});

afterAll(() => {
  globalThis.fetch = realFetch;
  for (const r of made) {
    r.proxy.stop();
    r.server.stop(true);
    rmSync(r.dataDir, { recursive: true, force: true });
  }
});

async function catchUp(r: Relayed): Promise<{ http: number; room: number; routes: Record<string, number> }> {
  r.proxy.reset();
  seen.length = 0;
  const { head, messages } = await r.room.fresh().history(0);
  expect(head).toBe(MESSAGES);
  expect(messages.map((m) => m.seq)).toEqual(Array.from({ length: MESSAGES }, (_, i) => i + 1));
  const routes = { ...r.proxy.stats.routes };
  return { http: sum(routes), room: seen.filter((s) => s.origin === r.proxy.url && s.cache !== "hit").length, routes };
}

describe("a fresh client catching up 3000 messages", () => {
  test("reads old pages without waking the room once they are cached", async () => {
    const before = await catchUp(await relayed(null));
    console.log(`before (pages off): ${before.http} HTTP, ${before.room} reach the room ${JSON.stringify(before.routes)}`);
    const paged = await relayed("k".repeat(40));
    const cold = await catchUp(paged);
    console.log(`after, first reader (cold cache): ${cold.http} HTTP, ${cold.room} reach the room ${JSON.stringify(cold.routes)}`);
    const warm = await catchUp(paged);
    console.log(`after, next reader (warm cache): ${warm.http} HTTP, ${warm.room} reach the room ${JSON.stringify(warm.routes)}`);
    expect(before.room).toBe(3);
    expect(cold.http).toBeLessThanOrEqual(BUDGET.cold.http);
    expect(cold.room).toBeLessThanOrEqual(BUDGET.cold.room);
    expect(warm.http).toBeLessThanOrEqual(BUDGET.warm.http);
    expect(warm.room).toBeLessThanOrEqual(BUDGET.warm.room);
  });
});
