import { afterEach, describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts";
import { computed, signal } from "@preact/signals-core";
import type { ChannelLink } from "./channel-ops.ts";
import { pageBefore, Scrollback, type PageSource } from "./back.ts";
import { useHistoryDb, type CachedRow, type HistoryDb } from "./history.ts";

const row = (seq: number): CachedRow => ({ seq, e: 1, iv: "iv", ct: "ct" });
const msg = (seq: number): Message => ({ v: PROTOCOL_VERSION, id: `id-${seq}`, from: "atlas", kind: "msg", body: `m${seq}`, ts: seq, seq, sigOk: true });
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

function archive(seqs: number[], floor = false): HistoryDb & { rows: () => number[] } {
  let rows = seqs.map(row);
  return {
    rows: () => rows.map((r) => r.seq),
    put: async () => {},
    putRows: async (_room, _pk, more) => {
      rows = [...new Map([...rows, ...more].map((r) => [r.seq, r])).values()].sort((a, b) => a.seq - b.seq);
    },
    newest: async (_room, _pk, count) => rows.slice(-count),
    after: async (_room, _pk, seq, count) => rows.filter((r) => r.seq > seq).slice(0, count),
    before: async (_room, _pk, seq, count) => rows.filter((r) => r.seq < seq).slice(-count),
    oldest: async () => rows[0]?.seq ?? null,
    floor: async () => floor,
    putFloor: async () => {},
    trimAbove: async () => {},
    drop: async () => {},
    dropAll: async () => {},
    putKept: async () => {},
    kept: async () => null,
  };
}

function relay(first = 1): PageSource & { asked: [number, number][] } {
  const asked: [number, number][] = [];
  return {
    asked,
    older: async (before, limit) => {
      asked.push([before, limit]);
      const since = Math.max(first - 1, before - 1 - limit);
      return { rows: range(since + 1, before - 1).map(row), done: since <= first - 1 };
    },
    open: async (rows) => rows.map((r) => (r.seq % 50 === 0 ? { seq: r.seq, unread: true as const } : msg(r.seq))),
  };
}

afterEach(() => useHistoryDb(null));

describe("a page of older messages for the scrollback", () => {
  test("comes from this device's archive when it holds the page, without asking the relay", async () => {
    useHistoryDb(archive(range(1, 900)));
    const src = relay();
    const page = await pageBefore("room", "pk", 801, 200, src);
    expect(page.messages.map((m) => m.seq)).toEqual(range(601, 800).filter((s) => s % 50 !== 0));
    expect(page.done).toBe(false);
    expect(src.asked).toEqual([]);
  });

  test("asks the relay only for what the archive lacks below its oldest row, and remembers it", async () => {
    const db = archive(range(701, 900));
    useHistoryDb(db);
    const src = relay();
    const page = await pageBefore("room", "pk", 801, 200, src);
    expect(page.messages[0]?.seq).toBe(601);
    expect(page.messages.at(-1)?.seq).toBe(799);
    expect(src.asked).toEqual([[701, 100]]);
    expect(db.rows()[0]).toBe(601);
  });

  test("an archive with a gap below the window is skipped for the relay's page", async () => {
    useHistoryDb(archive([...range(1, 500), ...range(801, 900)]));
    const src = relay();
    const page = await pageBefore("room", "pk", 801, 200, src);
    expect(page.messages[0]?.seq).toBe(601);
    expect(src.asked).toEqual([[801, 200]]);
  });

  test("it is done at the channel's first message, or where the relay forgot", async () => {
    useHistoryDb(archive(range(1, 300)));
    expect((await pageBefore("room", "pk", 150, 200, relay())).done).toBe(true);
    expect(await pageBefore("room", "pk", 1, 200, relay())).toEqual({ messages: [], done: true });
    useHistoryDb(archive(range(401, 600)));
    const forgot = await pageBefore("room", "pk", 401, 200, relay(301));
    expect(forgot.done).toBe(true);
    expect(forgot.messages[0]?.seq).toBe(301);
  });

  test("an archive that holds everything down to its floor never asks the relay", async () => {
    useHistoryDb(archive(range(301, 600), true));
    const src = relay();
    const page = await pageBefore("room", "pk", 401, 200, src);
    expect(page.messages[0]?.seq).toBe(301);
    expect(src.asked).toEqual([]);
  });
});

describe("scrollback while only the newest rows are in (T3008)", () => {
  test("a page waits for the whole window, then reads below it: no row comes twice", async () => {
    useHistoryDb(archive(range(1, 500)));
    const asked: number[] = [];
    const ch = {
      roomId: "room",
      pk: "pk",
      olderRows: async () => ({ rows: [], done: true }),
      openRows: async (rows: CachedRow[]) => (asked.push(rows[0]!.seq), rows.map((r) => msg(r.seq))),
    } as unknown as ChannelLink;
    const messages = signal(range(451, 500).map(msg));
    const back = signal<Message[]>([]);
    const opening = signal(true);
    const shown = computed(() => [...back.value, ...messages.value]);
    const scroll = new Scrollback({ ch, back, shown, messages, opening, gone: signal(null), page: 100, reach: 2000 });
    const paged = scroll.more();
    const reached = scroll.to(300);
    await new Promise((r) => setTimeout(r, 5));
    expect(asked).toEqual([]);
    messages.value = range(201, 500).map(msg);
    opening.value = false;
    expect(await paged).toBe(true);
    expect(await reached).toBe(true);
    expect(asked).toEqual([101]);
    const seqs = [...back.peek(), ...messages.peek()].map((m) => m.seq);
    expect(seqs).toEqual(range(101, 500));
  });
});
