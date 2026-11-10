import { expect, test } from "bun:test";
import { EVENT_OPS_VERSION, PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase } from "@kiwi/core/state.ts";
import { asKept, keptBaseUpTo, nearUsable, toKept, type Kept } from "./kept.ts";

const msg = (seq: number): Message => ({ v: PROTOCOL_VERSION, id: `id-${seq}`, from: "atlas", kind: "msg", body: `m${seq}`, ts: 1_700_000_000_000 + seq, seq, sigOk: true });

function baseAt(n: number): FoldBase {
  let base: FoldBase | null = null;
  fold(
    Array.from({ length: n }, (_, i) => msg(i + 1)),
    [],
    1_700_000_100_000,
    null,
    null,
    null,
    (b) => {
      base = b;
    },
  );
  if (!base) throw new Error("no base");
  return base;
}

const sealedAndBack = (k: Kept): unknown => JSON.parse(JSON.stringify(toKept(k)));
const state = (base: FoldBase | null): Kept => ({ roster: [], base, guardFloor: null, roomsFloor: null });

test("a kept base goes through the snapshot's wire format and comes back the same", () => {
  const base = baseAt(3);
  expect(asKept(sealedAndBack(state(base)))?.base).toEqual(base);
  expect(asKept(sealedAndBack(state(null)))).toEqual(state(null));
});

test("a kept state from another version, or with a base this build can't read, is not used", () => {
  const good = sealedAndBack(state(baseAt(3))) as Record<string, unknown>;
  expect(asKept({ ...good, v: 2 })).toBeNull();
  expect(asKept({ ...good, bv: 5 })).toBeNull();
  expect(asKept({ ...good, base: { ...(good.base as object), tasks: "nope" } })).toBeNull();
  expect(asKept({ ...good, base: { ...(good.base as object), n: "3" } })).toBeNull();
});

test("an outgrown base, folded before an event op this build reads, is not used: the snapshot path refuses it too", () => {
  const outgrown = { ...baseAt(3), skipped: true as const, folded: EVENT_OPS_VERSION - 1 };
  expect(asKept(sealedAndBack(state(outgrown)))).toBeNull();
});

test("a kept base past the relay's head (a relay restored from a backup) is not trusted", () => {
  const kept = state(baseAt(3));
  expect(keptBaseUpTo(kept, 2)).toBeNull();
  expect(keptBaseUpTo(kept, 3)).toBe(kept.base);
});

test("the near base, folded up to just before the newest rows, is kept beside the base and comes back the same (T3008)", () => {
  const base = baseAt(3);
  const near = baseAt(40);
  const back = asKept(sealedAndBack({ ...state(base), near }));
  expect(back?.base).toEqual(base);
  expect(back?.near).toEqual(near);
  expect(asKept(sealedAndBack(state(base)))?.near).toBeUndefined();
});

test("a near base older than the base, or with no base under it, is not used (T3008)", () => {
  expect(asKept(sealedAndBack({ ...state(baseAt(40)), near: baseAt(3) }))?.near).toBeUndefined();
  expect(asKept({ ...(sealedAndBack({ ...state(baseAt(3)), near: baseAt(40) }) as object), base: null })?.near).toBeUndefined();
});

test("folding the newest rows on the near base gives the state the whole window gives on the base (T3008)", () => {
  const all = Array.from({ length: 60 }, (_, i) => msg(i + 1));
  let base: FoldBase | null = null;
  let near: FoldBase | null = null;
  fold(all.slice(0, 10), [], 1, null, null, null, (b) => (base = b));
  fold(all.slice(10, 45), [], 1, null, null, base, (b) => (near = b));
  const whole = fold(all.slice(10), [], 1, null, null, base);
  const fromNear = fold(all.slice(45), [], 1, null, null, near);
  const withOlderToo = fold(all.slice(10), [], 1, null, null, near);
  for (const s of [fromNear, withOlderToo]) {
    expect(s.head).toBe(whole.head);
    expect([...s.places]).toEqual([...whole.places]);
    expect([...s.trust].filter(([seq]) => seq > 45)).toEqual([...whole.trust].filter(([seq]) => seq > 45));
    expect([...s.members]).toEqual([...whole.members]);
  }
});

test("a near base holding private rooms is used only once the keys' side has opened them (T3008)", () => {
  const near = { ...baseAt(40), secret: [["room-x", {}]] } as unknown as FoldBase;
  const k: Kept = { ...state(baseAt(3)), near };
  expect(nearUsable(k)).toBeNull();
  expect(nearUsable({ ...k, nearOpened: true })).toBe(near);
  expect(nearUsable({ ...state(baseAt(3)), near: baseAt(40) })).toEqual(baseAt(40));
  expect(nearUsable(state(baseAt(3)))).toBeNull();
  expect(nearUsable(null)).toBeNull();
});
