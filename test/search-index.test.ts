import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { b64url } from "@kiwi/core/crypto.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { Roster } from "@kiwi/core/state.ts";
import { SearchCore } from "../desktop/src/search-core.ts";
import type { FoldInputs, SearchAsk, SearchReply } from "../desktop/src/search-types.ts";
import { SearchHost, type SearchWorker } from "../desktop/src/search-host.ts";
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
    const sealed = await sealIndex(index, { base: null, through: 7 }, k, ROOM);
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
      const sealed = await sealIndex(index, { base: null, through: 3 }, k, ROOM);
      expect(await openIndex(sealed, k, ROOM)).toBeNull();
    }
  });
});

describe("the worker's core (T977)", () => {
  test("each batch is sealed to disk, and a new worker resumes after the last one", async () => {
    const file = join(dir, "resume.idx");
    const k = key();
    const a = new SearchCore();
    expect(await a.handle({ id: 1, op: "open", code: "c", file, key: k, roomId: ROOM })).toEqual({ through: 0 });
    await a.handle({ id: 2, op: "feed", code: "c", messages: lines(1, 300), inputs });
    expect(readFileSync(file).includes(Buffer.from("archive"))).toBe(false);
    const b = new SearchCore();
    expect(await b.handle({ id: 1, op: "open", code: "c", file, key: k, roomId: ROOM })).toEqual({ through: 300 });
    expect(await b.handle({ id: 2, op: "feed", code: "c", messages: lines(250, 400), inputs })).toEqual({ through: 400 });
    const found = await b.handle({ id: 3, op: "search", code: "c", query: "note", rooms: ["general"], limit: 500 });
    expect(found && "hits" in found ? found.hits.length : 0).toBe(400);
    await b.handle({ id: 4, op: "forget", code: "c" });
    expect(existsSync(file)).toBe(false);
  });
});

function inProcess(): { spawn: () => SearchWorker; kill: () => void; asks: SearchAsk[]; hold: (on: boolean) => void } {
  let exit: ((why: string) => void) | null = null;
  let held = false;
  const asks: SearchAsk[] = [];
  const spawn = (): SearchWorker => {
    const core = new SearchCore();
    let reply: (r: SearchReply) => void = () => {};
    let dead = false;
    return {
      postMessage: (ask) => {
        asks.push(ask);
        if (held && ask.op === "feed") return;
        void core.handle(ask).then(
          (value) => !dead && reply({ id: ask.id, ok: true, value }),
          (e: Error) => !dead && reply({ id: ask.id, ok: false, error: e.message }),
        );
      },
      terminate: () => void (dead = true),
      onReply: (fn) => void (reply = fn),
      onExit: (fn) => void (exit = (why) => ((dead = true), fn(why))),
    };
  };
  return { spawn, kill: () => exit?.("crashed"), asks, hold: (on) => void (held = on) };
}

describe("the search host (T977)", () => {
  test("a worker that dies mid-fold makes search say it's still indexing, then resumes from the last sealed batch", async () => {
    const w = inProcess();
    const host = new SearchHost(w.spawn);
    const at = { file: join(dir, "crash.idx"), key: key(), roomId: ROOM };
    await host.open("c", at);
    expect(await host.feed("c", lines(1, 200), inputs)).toBe(200);
    w.hold(true);
    const lost = host.feed("c", lines(201, 400), inputs);
    while (!w.asks.some((a) => a.op === "feed" && a.messages[0]?.seq === 201)) await Bun.sleep(1);
    w.kill();
    await expect(lost).rejects.toThrow("the search worker stopped");
    w.hold(false);
    const after = await host.search("c", "note", ["general"], 500, 400);
    expect(after.state).toBe("indexing");
    expect(after.through).toBe(200);
    expect(after.hits.length).toBe(200);
    expect(await host.feed("c", lines(201, 400), inputs)).toBe(400);
    const done = await host.search("c", "note", ["general"], 500, 400);
    expect(done.state).toBe("ready");
    expect(done.hits.length).toBe(400);
    host.stop();
  });

  test("an idle channel is unloaded, and opens again on the next search", async () => {
    const w = inProcess();
    const host = new SearchHost(w.spawn, 20);
    await host.open("c", { file: join(dir, "idle.idx"), key: key(), roomId: ROOM });
    await host.feed("c", lines(1, 5), inputs);
    await Bun.sleep(60);
    expect(w.asks.some((a) => a.op === "unload")).toBe(true);
    expect((await host.search("c", "note", ["general"], 10, 5)).hits.length).toBe(5);
    expect(w.asks.filter((a) => a.op === "open").length).toBe(2);
    host.stop();
  });

  test("runs in a real Bun Worker", async () => {
    const host = new SearchHost(() => {
      const worker = new Worker(join(import.meta.dir, "../desktop/src/search-worker.ts"));
      return {
        postMessage: (ask) => worker.postMessage(ask),
        terminate: () => worker.terminate(),
        onReply: (fn) => worker.addEventListener("message", (e: MessageEvent<SearchReply>) => fn(e.data)),
        onExit: (fn) => worker.addEventListener("close", () => fn("exited")),
      };
    });
    await host.open("c", { file: join(dir, "real.idx"), key: key(), roomId: ROOM });
    await host.feed("c", lines(1, 50), inputs);
    expect((await host.search("c", "archive", ["general"], 100, 50)).hits.length).toBe(50);
    host.stop();
  });
});
