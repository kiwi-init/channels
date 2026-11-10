import { expect, test } from "bun:test";
import { openRows, packEnvelope, packRow, reopenRows, type CachedRow } from "@kiwi/core/cache-row.ts";
import { open, seal } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, type Envelope, type Message } from "@kiwi/core/protocol.ts";

const KEY = "A".repeat(43);
const OTHER = "B".repeat(43);
const ROOM = "c".repeat(32);
const keys = { "0": KEY };

const payload = async (seq: number, body = `m${seq}`) =>
  sign(await generateIdentity("mac"), { v: PROTOCOL_VERSION as typeof PROTOCOL_VERSION, id: `id-${seq}`, from: "mac", kind: "msg" as const, body, ts: seq });
const envelope = async (seq: number, p: object): Promise<Envelope> => ({ seq, ts: seq * 10, e: 0, ...(await seal(KEY, ROOM, p)) });
const inside = (row: CachedRow) => open(KEY, ROOM, row.iv, row.ct) as Promise<{ ok?: unknown; raw?: { ct: string }; msg?: { body?: string } }>;
const sigOk = (m: unknown) => (m && typeof m === "object" && "sigOk" in m ? m.sigOk : null);

async function countVerifies<T>(run: () => Promise<T>): Promise<{ out: T; verifies: number }> {
  const real = crypto.subtle.verify.bind(crypto.subtle);
  let verifies = 0;
  crypto.subtle.verify = ((...a: Parameters<typeof real>) => (verifies++, real(...a))) as typeof crypto.subtle.verify;
  try {
    return { out: await run(), verifies };
  } finally {
    crypto.subtle.verify = real;
  }
}

test("a row cached from a message checked on arrival carries the mark inside its seal, and reopens with no signature check", async () => {
  const row = await packEnvelope(KEY, ROOM, 0, await envelope(1, await payload(1)), true);
  expect((await inside(row)).ok).toBe(1);
  expect(Object.keys(row).sort()).toEqual(["ct", "e", "iv", "rts", "seq"]);
  const { out, verifies } = await countVerifies(() => reopenRows([row], ROOM, keys, 0));
  expect(verifies).toBe(0);
  expect(out.opened.map(sigOk)).toEqual([true]);
  expect(out.rows).toEqual([]);
});

test("a row with no mark is checked once, comes back rewritten with it, and the rewritten row reopens with no check", async () => {
  const old = await packEnvelope(KEY, ROOM, 0, await envelope(2, await payload(2)));
  expect((await inside(old)).ok).toBeUndefined();
  const first = await countVerifies(() => reopenRows([old], ROOM, keys, 0));
  expect(first.verifies).toBe(1);
  expect(first.out.opened.map(sigOk)).toEqual([true]);
  expect(first.out.rows.map((r) => [r.seq, r.rts, r.e])).toEqual([[2, 20, 0]]);
  expect((await inside(first.out.rows[0]!)).raw?.ct).toBe((await inside(old)).raw?.ct);
  const second = await countVerifies(() => reopenRows(first.out.rows, ROOM, keys, 0));
  expect(second.verifies).toBe(0);
  expect(second.out.opened).toEqual(first.out.opened);
  expect(second.out.rows).toEqual([]);
});

test("a message whose signature fails is never marked: it is checked on every reopen and stays unverified", async () => {
  const forged = { ...(await payload(3)), body: "changed after signing" };
  const row = await packEnvelope(KEY, ROOM, 0, await envelope(3, forged), false);
  expect((await inside(row)).ok).toBeUndefined();
  for (let round = 0; round < 2; round++) {
    const { out, verifies } = await countVerifies(() => reopenRows([row], ROOM, keys, 0));
    expect(verifies).toBe(1);
    expect(out.opened.map(sigOk)).toEqual([false]);
    expect(out.rows).toEqual([]);
  }
});

test("the mark only counts inside the seal: beside the row it does nothing, and a row sealed under another key doesn't open", async () => {
  const row = await packEnvelope(KEY, ROOM, 0, await envelope(4, { ...(await payload(4)), body: "changed after signing" }));
  const beside = { ...row, ok: 1 };
  const { out, verifies } = await countVerifies(() => reopenRows([beside], ROOM, keys, 0));
  expect(verifies).toBe(1);
  expect(out.opened.map(sigOk)).toEqual([false]);
  const planted = await seal(OTHER, ROOM, { seq: 5, msg: { ...(await payload(5)), body: "planted" }, ok: 1 });
  expect((await reopenRows([{ seq: 5, e: 0, ...planted }], ROOM, keys, 0)).opened).toEqual([null]);
  const moved = await reopenRows([await packEnvelope(KEY, ROOM, 0, await envelope(6, await payload(6)), true)], "d".repeat(32), keys, 0);
  expect(moved.opened).toEqual([null]);
});

test("a row stored as an opened message is not marked when written, only after its stored bytes pass the check", async () => {
  const p = await payload(7);
  const shown: Message = { ...p, seq: 7, sigOk: true };
  const row = await packRow(KEY, ROOM, 0, shown);
  expect((await inside(row)).ok).toBeUndefined();
  const first = await countVerifies(() => reopenRows([row], ROOM, keys, 0));
  expect(first.verifies).toBe(1);
  expect(first.out.rows.length).toBe(1);
  expect((await countVerifies(() => reopenRows(first.out.rows, ROOM, keys, 0))).verifies).toBe(0);
  const edited = await packRow(KEY, ROOM, 0, { ...shown, body: "edited in memory" });
  const again = await reopenRows([edited], ROOM, keys, 0);
  expect(again.opened.map(sigOk)).toEqual([false]);
  expect(again.rows).toEqual([]);
});

test("openRows honours the mark too, and hands back messages only", async () => {
  const row = await packEnvelope(KEY, ROOM, 0, await envelope(8, await payload(8)), true);
  const { out, verifies } = await countVerifies(() => openRows([row], ROOM, keys));
  expect(verifies).toBe(0);
  expect(out.map(sigOk)).toEqual([true]);
});

test("with no key for the current epoch nothing is rewritten, and the rows still open", async () => {
  const row = await packEnvelope(KEY, ROOM, 0, await envelope(9, await payload(9)));
  const out = await reopenRows([row], ROOM, keys, 3);
  expect(out.opened.map(sigOk)).toEqual([true]);
  expect(out.rows).toEqual([]);
});
