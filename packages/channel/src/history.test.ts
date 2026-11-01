// The sealed history cache: ciphertext at rest, one member's rows stay theirs,
// and a hole or a seq past the relay head is thrown out instead of shown.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { b64url, seal } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts";
import { openKept, openRow, openRows, packKept, packRow, packEnvelope } from "@kiwi/core/cache-row.ts";
import { backfill, forgetAllHistory, forgetHistory, readCached, readKept, rememberKept, rememberRow, rememberRows, useHistoryDb, type CachedKept, type CachedRow, type HistoryDb } from "./history.ts";

const SENTINEL = "SENTINEL-plain-text-should-not-rest";
const ROOM = "a".repeat(32);
const ROOM_B = "b".repeat(32);
const PK_A = "pk-account-a";
const PK_B = "pk-account-b";

let store: HistoryDb;
let key: string;

function memoryDb(): HistoryDb {
  const rows = new Map<string, CachedRow>();
  const kept = new Map<string, CachedKept>();
  const floors = new Set<string>();
  const id = (room: string, pk: string, seq: number) => `${room}\0${pk}\0${seq}`;
  const list = (room: string, pk: string) =>
    [...rows.entries()]
      .filter(([k]) => k.startsWith(`${room}\0${pk}\0`))
      .map(([, row]) => row)
      .sort((a, b) => a.seq - b.seq);
  return {
    put: async (room, pk, row) => {
      rows.set(id(room, pk, row.seq), row);
    },
    putRows: async (room, pk, batch) => {
      for (const row of batch) rows.set(id(room, pk, row.seq), row);
    },
    newest: async (room, pk, count) => list(room, pk).slice(-count),
    oldest: async (room, pk) => list(room, pk)[0]?.seq ?? null,
    floor: async (room, pk) => floors.has(`${room}\0${pk}`),
    putFloor: async (room, pk) => void floors.add(`${room}\0${pk}`),
    trimAbove: async (room, pk, newest) => {
      for (const row of list(room, pk)) if (row.seq > newest) rows.delete(id(room, pk, row.seq));
    },
    drop: async (room, pk) => {
      for (const row of list(room, pk)) rows.delete(id(room, pk, row.seq));
      kept.delete(`${room}\0${pk}`);
      floors.delete(`${room}\0${pk}`);
    },
    dropAll: async () => {
      rows.clear();
      kept.clear();
    },
    putKept: async (room, pk, k) => void kept.set(`${room}\0${pk}`, k),
    kept: async (room, pk) => kept.get(`${room}\0${pk}`) ?? null,
  };
}

function msg(seq: number, body: string): Message {
  return {
    v: PROTOCOL_VERSION,
    id: `id-${seq}`,
    from: "Ada",
    kind: "msg",
    body,
    ts: 1_700_000_000_000 + seq,
    seq,
    rts: 1_800_000_000_000 + seq,
    sigOk: true,
  };
}

async function rememberMessage(room: string, pk: string, epoch: number, k: string, m: Message): Promise<void> {
  await rememberRow(room, pk, await packRow(k, room, epoch, m));
}

beforeEach(() => {
  store = memoryDb();
  useHistoryDb(store);
  key = b64url(crypto.getRandomValues(new Uint8Array(32)));
});

afterAll(() => {
  useHistoryDb(null);
});

test("a stored row is ciphertext, and a changed seq does not open", async () => {
  const row = await packRow(key, ROOM, 1, msg(4, SENTINEL));
  expect(JSON.stringify(row).includes(SENTINEL)).toBe(false);
  expect(row).toEqual({ seq: 4, rts: 1_800_000_000_004, e: 1, iv: row.iv, ct: row.ct });

  expect(await openRow(row, ROOM, { "1": key })).toMatchObject({ body: SENTINEL, seq: 4, sigOk: false });

  expect(await openRow({ ...row, seq: 5 }, ROOM, { "1": key })).toBeNull();
  expect(await openRow(row, ROOM, { "1": b64url(crypto.getRandomValues(new Uint8Array(32))) })).toBeNull();
});

test("a signed message still verifies after a cache round trip", async () => {
  const id = await generateIdentity("Ada");
  const signed = await sign(id, {
    v: PROTOCOL_VERSION as typeof PROTOCOL_VERSION,
    id: "id-1",
    from: "Ada",
    kind: "msg" as const,
    body: "signed",
    ts: 10,
  });
  await rememberMessage(ROOM, PK_A, 1, key, { ...signed, seq: 1, rts: 20, sigOk: true });
  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, { "1": key }), 1, 10);
  expect(out.messages.map((m) => ({ body: m.body, seq: m.seq, sigOk: m.sigOk, pk: m.pk }))).toEqual([{ body: "signed", seq: 1, sigOk: true, pk: id.pk }]);
});

test("two members and two rooms do not read each other's rows", async () => {
  const keys = { "1": key };
  await rememberMessage(ROOM, PK_A, 1, key, msg(1, "a-in-room"));
  await rememberMessage(ROOM, PK_B, 1, key, msg(1, "b-in-room"));
  await rememberMessage(ROOM_B, PK_A, 1, key, msg(1, "a-in-other"));

  const a = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 1, 10);
  expect(a.messages.map((m) => m.body)).toEqual(["a-in-room"]);
  expect(a.since).toBe(1);

  const b = await readCached(ROOM, PK_B, (rows) => openRows(rows, ROOM, keys), 1, 10);
  expect(b.messages.map((m) => m.body)).toEqual(["b-in-room"]);
});

test("a row that does not open is a hole, so the cache is dropped", async () => {
  const keys = { "1": key };
  await rememberMessage(ROOM, PK_A, 1, key, msg(1, "one"));
  await rememberMessage(ROOM, PK_A, 1, key, msg(2, "two"));
  await rememberMessage(ROOM, PK_A, 1, key, msg(3, "three"));
  const rows = await store.newest(ROOM, PK_A, Infinity);
  const broken = rows.find((r) => r.seq === 2)!;
  await store.put(ROOM, PK_A, { ...broken, ct: "not-ciphertext" });

  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 3, 10);
  expect(out).toEqual({ messages: [], unread: [], firstSeq: undefined, since: 0 });
  expect(await store.newest(ROOM, PK_A, Infinity)).toEqual([]);
});

test("a hole drops the cache and asks for the usual window", async () => {
  const keys = { "1": key };
  await rememberMessage(ROOM, PK_A, 1, key, msg(1, "one"));
  await rememberMessage(ROOM, PK_A, 1, key, msg(3, "three"));

  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 3, 10);
  expect(out).toEqual({ messages: [], unread: [], firstSeq: undefined, since: 0 });
  expect(await store.newest(ROOM, PK_A, Infinity)).toEqual([]);
});

test("a seq past the relay head is dropped and cannot return later", async () => {
  const keys = { "1": key };
  await rememberMessage(ROOM, PK_A, 1, key, msg(1, "one"));
  await rememberMessage(ROOM, PK_A, 1, key, msg(2, "two"));
  await rememberMessage(ROOM, PK_A, 1, key, msg(9, "nine"));

  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 2, 10);
  expect(out.messages.map((m) => m.seq)).toEqual([1, 2]);
  expect(out.messages.map((m) => m.body)).toEqual(["one", "two"]);
  expect(out.since).toBe(2);
  expect((await store.newest(ROOM, PK_A, Infinity)).map((r) => r.seq)).toEqual([1, 2]);
});

test("a reload shows the newest limit messages, in seq order, and keeps the older ones as the archive (T977)", async () => {
  const keys = { "1": key };
  for (let seq = 1; seq <= 5; seq++) await rememberMessage(ROOM, PK_A, 1, key, msg(seq, `m${seq}`));

  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 5, 3);
  expect(out.messages.map((m) => m.seq)).toEqual([3, 4, 5]);
  expect(out.since).toBe(5);
  expect((await store.newest(ROOM, PK_A, Infinity)).map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
});

test("a batch of messages is one write, and every row stays (T977)", async () => {
  const keys = { "1": key };
  let writes = 0;
  const counted = { ...store, putRows: (...a: Parameters<HistoryDb["putRows"]>) => (writes++, store.putRows(...a)) };
  useHistoryDb(counted);
  await rememberRows(ROOM, PK_A, await Promise.all([1, 2, 3, 4, 5].map((seq) => packRow(key, ROOM, 1, msg(seq, `m${seq}`)))));
  await rememberRows(ROOM, PK_A, []);
  expect(writes).toBe(1);
  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 5, 3);
  expect(out.messages.map((m) => m.seq)).toEqual([3, 4, 5]);
  expect((await store.newest(ROOM, PK_A, Infinity)).length).toBe(5);
});

test("leave drops one member; sign-out drops every row", async () => {
  const keys = { "1": key };
  await rememberMessage(ROOM, PK_A, 1, key, msg(1, "a"));
  await rememberMessage(ROOM, PK_B, 1, key, msg(1, "b"));

  await forgetHistory(ROOM, PK_A);
  expect((await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 1, 10)).messages).toEqual([]);
  expect((await readCached(ROOM, PK_B, (rows) => openRows(rows, ROOM, keys), 1, 10)).messages.map((m) => m.body)).toEqual(["b"]);

  await forgetAllHistory();
  expect(await store.newest(ROOM, PK_B, Infinity)).toEqual([]);
});

test("a row sealed before the keys left the window still opens", async () => {
  const { seq, rts, sigOk, ...payload } = msg(7, "from an older app");
  void sigOk;
  const sealed = await seal(key, ROOM, { seq, msg: payload });
  const old: CachedRow = { seq, rts, e: 1, iv: sealed.iv, ct: sealed.ct };
  await store.put(ROOM, PK_A, old);
  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, { "1": key }), 7, 10);
  expect(out.messages.map((m) => m.body)).toEqual(["from an older app"]);
});

async function sealedPayload(k: string, payload: object): Promise<{ iv: string; ct: string }> {
  return seal(k, ROOM, payload);
}

test("a message this build can't read is kept as an unread row: no hole, so the cache survives", async () => {
  const keys = { "1": key };
  await rememberMessage(ROOM, PK_A, 1, key, msg(1, "one"));
  const malformed = await sealedPayload(key, { ...msg(2, ""), kind: "event", ev: { op: "task.add" } });
  await rememberRow(ROOM, PK_A, await packEnvelope(key, ROOM, 1, { seq: 2, ts: 30, e: 1, ...malformed }));
  await rememberMessage(ROOM, PK_A, 1, key, msg(3, "three"));

  const out = await readCached(ROOM, PK_A, (rows) => openRows(rows, ROOM, keys), 3, 10);
  expect(out.messages.map((m) => m.body)).toEqual(["one", "three"]);
  expect(out.unread).toEqual([2]);
  expect(out.firstSeq).toBe(1);
  expect(out.since).toBe(3);
  expect((await store.newest(ROOM, PK_A, Infinity)).map((r) => r.seq)).toEqual([1, 2, 3]);
});

test("an unread row opens as the message once the build can read it, and a moved one doesn't open", async () => {
  const readable = await sealedPayload(key, { v: PROTOCOL_VERSION, id: "id-7", from: "Ada", kind: "msg", body: SENTINEL, ts: 7 });
  const row = await packEnvelope(key, ROOM, 1, { seq: 7, ts: 70, e: 1, ...readable });
  expect(JSON.stringify(row).includes(SENTINEL)).toBe(false);
  expect(await openRow(row, ROOM, { "1": key })).toMatchObject({ body: SENTINEL, seq: 7, rts: 70 });

  const unreadable = await sealedPayload(key, { v: PROTOCOL_VERSION, id: "id-8", from: "Ada", kind: "event", body: "", ts: 8, ev: { op: "task.add" } });
  const later = await packEnvelope(key, ROOM, 1, { seq: 8, ts: 80, e: 1, ...unreadable });
  expect(await openRow(later, ROOM, { "1": key })).toEqual({ seq: 8, unread: true });
  expect(await openRow({ ...later, seq: 9 }, ROOM, { "1": key })).toBeNull();
});

test("a channel's kept state rests sealed, opens only with its channel's key, and leaves with the member", async () => {
  const keys = { "1": key };
  const state = { roster: [{ name: SENTINEL, pk: "pk" }], base: null };
  await rememberKept(ROOM, PK_A, await packKept(key, ROOM, 1, state));
  await rememberKept(ROOM, PK_B, await packKept(key, ROOM, 1, { roster: [], base: null }));
  const sealed = await readKept(ROOM, PK_A);
  expect(JSON.stringify(sealed)).not.toContain(SENTINEL);
  expect(await openKept(sealed, ROOM, keys)).toEqual(state);
  expect(await openKept(sealed, ROOM_B, keys)).toBeNull();
  expect(await openKept(sealed, ROOM, { "1": b64url(crypto.getRandomValues(new Uint8Array(32))) })).toBeNull();

  await forgetHistory(ROOM, PK_A);
  expect(await readKept(ROOM, PK_A)).toBeNull();
  expect(await readKept(ROOM, PK_B)).not.toBeNull();
  await forgetAllHistory();
  expect(await readKept(ROOM, PK_B)).toBeNull();
});

test("a kept state never opens as a message row, and a row never opens as a kept state", async () => {
  const keys = { "1": key };
  const kept = await packKept(key, ROOM, 1, { roster: [], base: null });
  expect(await openRow({ seq: 1, ...kept }, ROOM, keys)).toBeNull();
  const row = await packRow(key, ROOM, 1, msg(1, "a"));
  expect(await openKept({ e: row.e, iv: row.iv, ct: row.ct }, ROOM, keys)).toBeNull();
});

describe("the archive fills in from the relay, a page at a time (T977)", () => {
  const relay = (from: number, to: number) => Promise.all(Array.from({ length: to - from + 1 }, (_, i) => packRow(key, ROOM, 1, msg(from + i, `old ${from + i}`))));
  const older = (floor: number) => async (before: number, limit: number) => {
    const since = Math.max(floor - 1, before - 1 - limit);
    return { rows: before - 1 > since ? await relay(since + 1, before - 1) : [], done: since <= floor - 1 };
  };
  const quick = { hidden: () => false, wait: async () => {}, stopped: () => false };

  test("it pages down to the relay's first message, then remembers it has everything", async () => {
    await rememberRows(ROOM, PK_A, await relay(1200, 1205));
    let asks = 0;
    const ask = older(1);
    expect(await backfill(ROOM, PK_A, { ...quick, older: (b, l) => (asks++, ask(b, l)) })).toBe("done");
    expect((await store.newest(ROOM, PK_A, Infinity)).map((r) => r.seq)).toEqual(Array.from({ length: 1205 }, (_, i) => i + 1));
    expect(asks).toBe(3);
    expect(await backfill(ROOM, PK_A, { ...quick, older: async () => (asks++, { rows: [], done: true }) })).toBe("done");
    expect(asks).toBe(3);
  });

  test("it stops where the relay forgot, and resumes where it left off after a stop", async () => {
    await rememberRows(ROOM, PK_A, await relay(2000, 2001));
    let left = 2;
    expect(await backfill(ROOM, PK_A, { ...quick, stopped: () => left-- <= 0, older: older(1001) })).toBe("stopped");
    const after = (await store.newest(ROOM, PK_A, Infinity))[0]!.seq;
    expect(after).toBe(1500);
    expect(await backfill(ROOM, PK_A, { ...quick, older: older(1001) })).toBe("done");
    expect((await store.newest(ROOM, PK_A, Infinity))[0]!.seq).toBe(1001);
  });

  test("a refused page waits longer each time and gives up after a few, without losing what it has", async () => {
    await rememberRows(ROOM, PK_A, await relay(50, 51));
    const waits: number[] = [];
    const out = await backfill(ROOM, PK_A, { ...quick, wait: async (ms) => void waits.push(ms), older: () => Promise.reject(new Error("too many page requests; slow down")) });
    expect(out).toBe("failed");
    expect(waits.length).toBe(5);
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
    expect((await store.newest(ROOM, PK_A, Infinity)).map((r) => r.seq)).toEqual([50, 51]);
  });

  test("it waits while the app is hidden, and a dropped cache forgets that it had everything", async () => {
    await rememberRows(ROOM, PK_A, await relay(3, 4));
    let hidden = 2;
    let asked = 0;
    expect(await backfill(ROOM, PK_A, { ...quick, hidden: () => hidden-- > 0, older: async (b, l) => (asked++, older(1)(b, l)) })).toBe("done");
    expect(asked).toBe(1);
    await forgetHistory(ROOM, PK_A);
    await rememberRows(ROOM, PK_A, await relay(9, 9));
    expect(await backfill(ROOM, PK_A, { ...quick, older: older(1) })).toBe("done");
    expect((await store.newest(ROOM, PK_A, Infinity)).length).toBe(9);
  });
});
