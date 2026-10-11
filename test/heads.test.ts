// The signed-in listing's heads (T1245): what lets the sidebar mark closed channels with news.
// Each read wakes a channel's storage, so it must write nothing, stay capped, and be cached.

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "../src/client.ts";
import { generateIdentity } from "../src/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import * as Layer from "effect/Layer";
import { buildContext, clockLayer } from "../src/relay/http.ts";
import { Human } from "../src/relay/human.ts";
import { HEADS_PER_LISTING, myChannels } from "../src/relay/me.ts";
import { Directory, readHead, type DirectoryEntry, type RoomHead, type Sql } from "../src/relay/room.ts";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const human = { clientId: "c", verify: async (t: string) => (t === "ok" ? "user_a" : null) };
const req = () => new Request("https://relay/v1/me/channels", { headers: { "x-human-token": "ok" } });
const entry = (room: string, at: number): DirectoryEntry => ({ room, code: `code-${room}`, owner: true, member: true, agents: 0, at });
/** The listing on its own: this sign-in, a channel list of `rooms`, and a clock stopped at NOW. */
const listing = (rooms: DirectoryEntry[]) =>
  buildContext(Layer.mergeAll(Layer.succeed(Human, human), Layer.succeed(Directory, { list: async () => rooms }), clockLayer(() => NOW)));
const list = async (res: Response) => ((await res.json()) as { channels: (DirectoryEntry & { head?: number })[] }).channels;

/** Reads go to a real database; any write fails the test. */
function readOnly(db: Database): Sql {
  return {
    run: (q) => {
      throw new Error(`wrote: ${q}`);
    },
    all: <T>(q: string, ...p: (string | number | null)[]) => db.query(q).all(...p) as T[],
  };
}

describe("readHead", () => {
  test("a missing room is null and gets no tables", () => {
    const db = new Database(":memory:");
    expect(readHead(readOnly(db))).toBeNull();
    expect(db.query("SELECT name FROM sqlite_master").all()).toEqual([]);
  });

  test("a live room gives its newest seq and time without calling run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-head-"));
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir });
    try {
      const owner = await generateIdentity("human");
      const { access } = await Channel.create(r.url.origin, owner, { name: "human" });
      const db = new Database(join(dir, `${access.roomId}.sqlite`), { readonly: true });
      expect(readHead(readOnly(db))).toEqual({ head: 0, last: 0 });
      const before = Date.now();
      const seq = await new Channel(access, r.url.origin, owner).send("hi");
      const h = readHead(readOnly(db))!;
      expect(h.head).toBe(seq);
      expect(h.last).toBeGreaterThanOrEqual(before);
      db.close();
    } finally {
      r.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("myChannels heads", () => {
  test("only listed channels, newest first, up to the cap, quiet ones without a head", async () => {
    const rooms = Array.from({ length: HEADS_PER_LISTING + 5 }, (_, i) => entry(`r${i}`, NOW - i));
    const read: string[] = [];
    const res = await myChannels(req(), listing(rooms), {
      read: async (room) => {
        read.push(room);
        if (room === "r1") return { head: 9, last: NOW - 8 * DAY };
        if (room === "r2") throw new Error("gone");
        return { head: 7, last: NOW - DAY };
      },
    });
    const out = await list(res);
    expect(read.length).toBe(HEADS_PER_LISTING);
    expect(new Set(read)).toEqual(new Set(rooms.slice(0, HEADS_PER_LISTING).map((r) => r.room)));
    expect(out[0]!.head).toBe(7);
    expect(out[1]!.head).toBeUndefined(); // quiet for 8 days
    expect(out[2]!.head).toBeUndefined(); // its read failed
    expect(out[HEADS_PER_LISTING]!.head).toBeUndefined(); // past the cap
  });

  test("a cached person reads no channel, and the cache never adds rooms outside the listing", async () => {
    const cache = new Map<string, Record<string, RoomHead>>();
    const store = { get: async (u: string) => cache.get(u) ?? null, put: async (u: string, h: Record<string, RoomHead>) => void cache.set(u, h) };
    let reads = 0;
    const heads = { read: async () => (reads++, { head: 3, last: NOW }), cache: store };
    await myChannels(req(), listing([entry("a", 2), entry("b", 1)]), heads);
    expect(reads).toBe(2);
    const out = await list(await myChannels(req(), listing([entry("a", 2)]), heads));
    expect(reads).toBe(2);
    expect(out).toEqual([{ ...entry("a", 2), head: 3 }]);
  });
});
