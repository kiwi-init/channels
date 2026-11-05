import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { b64url, fromB64url } from "@kiwi/core/crypto.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { Roster } from "@kiwi/core/state.ts";
import { SearchCore } from "../desktop/src/search-core.ts";
import { stampFor } from "../desktop/src/search-feed.ts";
import type { FoldInputs, SearchAsk, SearchOp, SearchReply } from "../desktop/src/search-types.ts";
import { bunSearchWorker, SearchHost, type SearchWorker } from "../desktop/src/search-host.ts";
import { SearchIndex, type IndexStamp } from "../desktop/src/search-index.ts";
import { openIndex, sealIndex } from "../desktop/src/search-store.ts";

const dir = mkdtempSync(join(tmpdir(), "kiwi-search-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ROOM = "f".repeat(32);
const key = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent" },
];
const inputs: FoldInputs = { roster, roomsFloor: null, guardFloor: null, now: 0 };
const line = (seq: number, body: string, from = "win"): Message => ({ v: 1, id: `m${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "msg", body, ts: seq, rts: seq }) as Message;
const lines = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => line(from + i, `note ${from + i} about the archive`));
const until = async (ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 1_000 && !ok(); i++) await Bun.sleep(5);
};
const through = async (file: string, k: string): Promise<unknown> => new SearchCore().handle({ id: 1, op: "open", code: "c", file, key: k, roomId: ROOM });

describe("the index (T977)", () => {
  test("finds words by prefix and without accents, only in the rooms asked for", () => {
    const index = SearchIndex.empty();
    index.put([
      { seq: 1, room: "general", from: "jow", text: "A relay ficou lento ontem", at: 0 },
      { seq: 2, room: "r-ops", from: "win", text: "relay restarted, latência normal", at: 0 },
      { seq: 3, room: "general", from: "win", text: "unrelated", at: 0 },
    ]);
    expect(index.search("relay", ["general"], 10).map((h) => h.seq)).toEqual([1]);
    expect(
      index
        .search("rel", ["general", "r-ops"], 10)
        .map((h) => h.seq)
        .sort(),
    ).toEqual([1, 2]);
    expect(index.search("latencia", ["r-ops"], 10).map((h) => h.seq)).toEqual([2]);
    expect(index.search("relay", [], 10)).toEqual([]);
  });

  test("a query is words, never FTS syntax, whatever it holds", () => {
    const index = SearchIndex.empty();
    index.put([{ seq: 1, room: "general", from: "jow", text: "near or not", at: 0 }]);
    for (const q of ['"', "NEAR(a b)", "near OR", "-not", "*", "room:general", "a AND (b", "'; DROP TABLE hits; --", "^near", ""]) {
      expect(() => index.search(q, ["general"], 10)).not.toThrow();
    }
    expect(index.search("NEAR(", ["general"], 10).map((h) => h.seq)).toEqual([1]);
  });

  test("the stretch around a message comes back in order, only from rooms asked for and without what was dropped", () => {
    const index = SearchIndex.empty();
    index.put(Array.from({ length: 30 }, (_, i) => ({ seq: i + 1, room: i % 5 === 0 ? "r-private" : "general", from: "jow", text: `line ${i + 1}`, at: i })));
    index.drop([12]);
    const near = index.around(10, ["general"], 3);
    expect(near.map((h) => h.seq)).toEqual([7, 8, 9, 10, 13]);
    expect(near[0]).toMatchObject({ room: "general", from: "jow", text: "line 7", at: 6 });
    expect(index.around(10, [], 3)).toEqual([]);
  });

  test("an edit replaces the text, a delete and a room's removal drop it", () => {
    const index = SearchIndex.empty();
    index.put([
      { seq: 1, room: "general", from: "jow", text: "first draft", at: 0 },
      { seq: 2, room: "r-x", from: "jow", text: "secret plan", at: 0 },
    ]);
    index.retext(1, "final wording");
    expect(index.search("draft", ["general"], 10)).toEqual([]);
    expect(index.search("wording", ["general"], 10).map((h) => h.seq)).toEqual([1]);
    index.dropRoom("r-x");
    expect(index.search("plan", ["r-x"], 10)).toEqual([]);
    index.drop([1]);
    expect(index.count()).toBe(0);
  });
});

describe("the sealed index file (T977)", () => {
  test("rests as ciphertext, opens only with its key and its room, and keeps the fold base", async () => {
    const k = key();
    const index = SearchIndex.empty();
    index.put([{ seq: 7, room: "general", from: "jow", text: "PLAINTEXT-SENTINEL words", at: 70 }]);
    const sealed = await sealIndex(index, { base: null, from: 1, through: 7 }, k, ROOM);
    expect(Buffer.from(sealed).includes(Buffer.from("PLAINTEXT-SENTINEL"))).toBe(false);
    expect(await openIndex(sealed, key(), ROOM)).toBeNull();
    expect(await openIndex(sealed, k, "e".repeat(32))).toBeNull();
    const back = await openIndex(sealed, k, ROOM);
    expect(back?.fed.through).toBe(7);
    expect(back?.index.search("sentinel", ["general"], 5)).toEqual([{ seq: 7, rank: expect.any(Number), room: "general", from: "jow", text: "PLAINTEXT-SENTINEL words", at: 70 }]);
  });

  test("an index from other fold rules or another file layout is thrown away, never mixed", async () => {
    for (const change of [(s: IndexStamp) => ({ ...s, rules: s.rules - 1 }), (s: IndexStamp) => ({ ...s, schema: s.schema - 1 })]) {
      const k = key();
      const index = SearchIndex.empty();
      const stamp = index.setStamp.bind(index);
      index.setStamp = (s) => stamp(change(s));
      const sealed = await sealIndex(index, { base: null, from: 1, through: 3 }, k, ROOM);
      expect(await openIndex(sealed, k, ROOM)).toBeNull();
    }
  });

  test("stays the WebCrypto AES-GCM file it was, both ways, past one chunk", async () => {
    const k = key();
    const aes = await crypto.subtle.importKey("raw", fromB64url(k), "AES-GCM", false, ["encrypt", "decrypt"]);
    const additionalData = new TextEncoder().encode(`kiwi-search-index:${ROOM}`);
    const index = SearchIndex.empty();
    index.put(Array.from({ length: 6_000 }, (_, i) => ({ seq: i + 1, room: "general", from: "jow", text: `${i} ${"wide words to fill pages ".repeat(12)}`, at: i })));
    index.setStamp(stampFor({ base: null, from: 1, through: 6_000 }));
    index.set("base", "null");
    const plain = new Uint8Array(index.bytes());
    expect(plain.length).toBeGreaterThan(2 << 20);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, aes, plain));
    const before = new Uint8Array([0x6b, 0x73, 0x69, 0x01, ...iv, ...ct]);
    const opened = await openIndex(before, k, ROOM);
    expect(opened?.fed.through).toBe(6_000);
    expect(opened?.index.count()).toBe(6_000);
    const sealed = await sealIndex(index, { base: null, from: 1, through: 6_000 }, k, ROOM);
    const back = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.slice(4, 16), additionalData }, aes, sealed.slice(16)));
    expect(Buffer.from(back).equals(Buffer.from(index.bytes()))).toBe(true);
    const damaged = sealed.slice();
    damaged[damaged.length - 1]! ^= 1;
    expect(await openIndex(damaged, k, ROOM)).toBeNull();
  });
});

describe("the worker's core (T977)", () => {
  test("feeds stay in memory until a save or an unload seals them, and a new worker resumes after the last one", async () => {
    const file = join(dir, "resume.idx");
    const k = key();
    const a = new SearchCore();
    expect(await a.handle({ id: 1, op: "open", code: "c", file, key: k, roomId: ROOM })).toEqual({ through: 0 });
    await a.handle({ id: 2, op: "feed", code: "c", messages: lines(1, 300), inputs, from: 1 });
    expect(existsSync(file)).toBe(false);
    await a.handle({ id: 3, op: "save", code: "c" });
    expect(readFileSync(file).includes(Buffer.from("archive"))).toBe(false);
    const saved = statSync(file).ino;
    await a.handle({ id: 4, op: "feed", code: "c", messages: [], inputs, from: 1 });
    await a.handle({ id: 5, op: "save", code: "c" });
    await a.handle({ id: 6, op: "unload", code: "c" });
    expect(statSync(file).ino).toBe(saved);
    const b = new SearchCore();
    expect(await b.handle({ id: 1, op: "open", code: "c", file, key: k, roomId: ROOM })).toEqual({ through: 300 });
    expect(await b.handle({ id: 2, op: "feed", code: "c", messages: lines(250, 400), inputs, from: 250 })).toEqual({ through: 400 });
    await b.handle({ id: 3, op: "unload", code: "c" });
    await expect(b.handle({ id: 4, op: "search", code: "c", query: "note", rooms: ["general"], limit: 500 })).rejects.toThrow("isn't open");
    const c = new SearchCore();
    expect(await c.handle({ id: 1, op: "open", code: "c", file, key: k, roomId: ROOM })).toEqual({ through: 400 });
    const found = await c.handle({ id: 2, op: "search", code: "c", query: "note", rooms: ["general"], limit: 500 });
    expect(found && "hits" in found ? found.hits.length : 0).toBe(400);
    await c.handle({ id: 3, op: "forget", code: "c" });
    expect(existsSync(file)).toBe(false);
  });

  test("dropping a room seals the index at once", async () => {
    const file = join(dir, "drop.idx");
    const k = key();
    const core = new SearchCore();
    await core.handle({ id: 1, op: "open", code: "c", file, key: k, roomId: ROOM });
    await core.handle({ id: 2, op: "feed", code: "c", messages: lines(1, 10), inputs, from: 1 });
    await core.handle({ id: 3, op: "dropRoom", code: "c", room: "general" });
    const back = new SearchCore();
    await back.handle({ id: 1, op: "open", code: "c", file, key: k, roomId: ROOM });
    const found = await back.handle({ id: 2, op: "search", code: "c", query: "note", rooms: ["general"], limit: 500 });
    expect(found && "hits" in found ? found.hits : null).toEqual([]);
  });

  test("rows from below the index fold it again from there, so a later delete hides the older message", async () => {
    const core = new SearchCore();
    await core.handle({ id: 1, op: "open", code: "c", file: join(dir, "lower.idx"), key: key(), roomId: ROOM });
    const gone = { ...line(201, ""), kind: "event", ev: { op: "msg.delete", seq: 50 } } as Message;
    const hits = async (query: string) => {
      const found = await core.handle({ id: 9, op: "search", code: "c", query, rooms: ["general"], limit: 500 });
      return found && "hits" in found ? found.hits.map((h) => h.seq) : [];
    };
    expect(await core.handle({ id: 2, op: "feed", code: "c", messages: [...lines(101, 200), gone], inputs, from: 101 })).toEqual({ through: 201 });
    expect((await hits("note")).length).toBe(100);
    expect(await core.handle({ id: 3, op: "feed", code: "c", messages: [...lines(1, 200), gone], inputs, from: 1 })).toEqual({ through: 201 });
    expect((await hits("note")).length).toBe(199);
    expect(await hits("50")).toEqual([]);
    expect(await hits("49")).toEqual([49]);
  });

  test("a feed that skips past what's indexed starts over instead of leaving a gap", async () => {
    const core = new SearchCore();
    await core.handle({ id: 1, op: "open", code: "c", file: join(dir, "gap.idx"), key: key(), roomId: ROOM });
    await core.handle({ id: 2, op: "feed", code: "c", messages: lines(1, 100), inputs, from: 1 });
    expect(await core.handle({ id: 3, op: "feed", code: "c", messages: lines(500, 520), inputs, from: 500 })).toEqual({ through: 520 });
    const found = await core.handle({ id: 4, op: "search", code: "c", query: "note", rooms: ["general"], limit: 500 });
    expect(found && "hits" in found ? found.hits.map((h) => h.seq).sort((a, b) => a - b)[0] : 0).toBe(500);
  });
});

interface Fake {
  spawn: () => SearchWorker;
  kill: () => void;
  asks: SearchAsk[];
  done: SearchAsk[];
  hold: (ops: SearchOp[]) => void;
  spawned: () => number;
  ended: () => number;
}

function inProcess(): Fake {
  let exit: ((why: string) => void) | null = null;
  let held = new Set<SearchOp>();
  let spawned = 0;
  let ended = 0;
  const asks: SearchAsk[] = [];
  const done: SearchAsk[] = [];
  const spawn = (): SearchWorker => {
    spawned++;
    const core = new SearchCore();
    let reply: (r: SearchReply) => void = () => {};
    let dead = false;
    let queue: Promise<void> = Promise.resolve();
    return {
      postMessage: (ask) => {
        asks.push(ask);
        if (held.has(ask.op)) return;
        queue = queue.then(() =>
          core.handle(ask).then(
            (value) => void (!dead && (done.push(ask), reply({ id: ask.id, ok: true, value }))),
            (e: Error) => void (!dead && reply({ id: ask.id, ok: false, error: e.message })),
          ),
        );
      },
      terminate: () => void ((dead = true), ended++),
      onReply: (fn) => void (reply = fn),
      onExit: (fn) => void (exit = (why) => ((dead = true), fn(why))),
    };
  };
  return { spawn, kill: () => exit?.("crashed"), asks, done, hold: (ops) => void (held = new Set(ops)), spawned: () => spawned, ended: () => ended };
}

describe("the search host (T977)", () => {
  test("a worker that dies loses only what wasn't sealed yet: search says it's still indexing, and feeding from there brings it all back", async () => {
    const w = inProcess();
    const host = new SearchHost(w.spawn, 60_000, 10);
    const at = { file: join(dir, "crash.idx"), key: key(), roomId: ROOM };
    await host.open("c", at);
    expect(await host.feed("c", lines(1, 200), inputs, 1)).toBe(200);
    await until(() => w.done.some((a) => a.op === "save"));
    w.hold(["save"]);
    expect(await host.feed("c", lines(201, 300), inputs, 201)).toBe(300);
    w.hold(["save", "feed"]);
    const lost = host.feed("c", lines(301, 400), inputs, 301);
    while (!w.asks.some((a) => a.op === "feed" && a.messages[0]?.seq === 301)) await Bun.sleep(1);
    w.kill();
    await expect(lost).rejects.toThrow("the search worker stopped");
    w.hold([]);
    const after = await host.search("c", "note", ["general"], 500, 400);
    expect(after.state).toBe("indexing");
    expect(after.through).toBe(200);
    expect(after.hits.length).toBe(200);
    expect(await host.feed("c", lines(201, 400), inputs, 201)).toBe(400);
    const done = await host.search("c", "note", ["general"], 500, 400);
    expect(done.state).toBe("ready");
    expect(done.hits.length).toBe(400);
    host.stop();
  });

  test("feeds are sealed together on a timer, not one by one", async () => {
    const w = inProcess();
    const host = new SearchHost(w.spawn, 60_000, 300);
    const at = { file: join(dir, "batched.idx"), key: key(), roomId: ROOM };
    await host.open("c", at);
    for (let i = 0; i < 10; i++) await host.feed("c", lines(i * 10 + 1, i * 10 + 10), inputs, i * 10 + 1);
    expect(existsSync(at.file)).toBe(false);
    await until(() => w.done.some((a) => a.op === "save"));
    expect(w.asks.filter((a) => a.op === "save").length).toBe(1);
    expect(await through(at.file, at.key)).toEqual({ through: 100 });
    host.stop();
  });

  test("an idle channel is sealed and unloaded, the worker ends, and the next search starts it again with nothing lost", async () => {
    const w = inProcess();
    const host = new SearchHost(w.spawn, 20, 60_000);
    const at = { file: join(dir, "idle.idx"), key: key(), roomId: ROOM };
    await host.open("c", at);
    await host.feed("c", lines(1, 5), inputs, 1);
    await until(() => w.ended() === 1);
    expect(w.asks.map((a) => a.op)).toEqual(["open", "feed", "unload"]);
    expect(await through(at.file, at.key)).toEqual({ through: 5 });
    const found = await host.search("c", "note", ["general"], 10, 5);
    expect(found.state).toBe("ready");
    expect(found.hits.length).toBe(5);
    expect(w.spawned()).toBe(2);
    host.stop();
  });

  test("the worker stays while another channel is still open", async () => {
    const w = inProcess();
    const host = new SearchHost(w.spawn, 100, 60_000);
    await host.open("a", { file: join(dir, "two-a.idx"), key: key(), roomId: ROOM });
    await host.open("b", { file: join(dir, "two-b.idx"), key: key(), roomId: ROOM });
    await host.feed("a", lines(1, 5), inputs, 1);
    for (let i = 0; i < 25; i++) {
      await Bun.sleep(10);
      await host.feed("b", lines(1 + i, 1 + i), inputs, 1);
    }
    expect(w.asks.some((a) => a.op === "unload" && a.code === "a")).toBe(true);
    expect(w.ended()).toBe(0);
    await until(() => w.ended() === 1);
    expect(w.spawned()).toBe(1);
    host.stop();
  });

  test("quitting seals what wasn't sealed yet and ends the worker", async () => {
    const w = inProcess();
    const host = new SearchHost(w.spawn, 60_000, 60_000);
    const at = { file: join(dir, "quit.idx"), key: key(), roomId: ROOM };
    await host.open("c", at);
    await host.feed("c", lines(1, 50), inputs, 1);
    expect(existsSync(at.file)).toBe(false);
    await host.close();
    expect(w.ended()).toBe(1);
    expect(await through(at.file, at.key)).toEqual({ through: 50 });
  });

  test("runs in a real Bun Worker, which ends when idle and starts again", async () => {
    let spawned = 0;
    let ended = 0;
    const host = new SearchHost(() => {
      spawned++;
      const w = bunSearchWorker(join(import.meta.dir, "../desktop/src/search-worker.ts"));
      return { ...w, terminate: () => (ended++, w.terminate()) };
    }, 50);
    await host.open("c", { file: join(dir, "real.idx"), key: key(), roomId: ROOM });
    await host.feed("c", lines(1, 50), inputs, 1);
    expect((await host.search("c", "archive", ["general"], 100, 50)).hits.length).toBe(50);
    await until(() => ended === 1);
    expect((await host.search("c", "archive", ["general"], 100, 50)).hits.length).toBe(50);
    expect(spawned).toBe(2);
    host.stop();
  });
});
