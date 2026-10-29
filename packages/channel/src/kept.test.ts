import { expect, test } from "bun:test";
import { EVENT_OPS_VERSION, PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase } from "@kiwi/core/state.ts";
import { asKept, keptBaseUpTo, toKept, type Kept } from "./kept.ts";

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
