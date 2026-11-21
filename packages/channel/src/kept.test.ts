import { expect, test } from "bun:test";
import { EVENT_OPS_VERSION, PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase } from "@kiwi/core/state.ts";
import { asKept, keptBaseUpTo, toKept, withDocLines, type DocLine, type Kept } from "./kept.ts";

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
const state = (base: FoldBase | null): Kept => ({ roster: [], base, guardFloor: null, roomsFloor: null, docLines: {} });

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

const line = (id: string, text = `line ${id}`): DocLine => ({ id, author: "atlas", at: 1_700_000_000_000, text });

test("doc lines go through the sealed record and come back the same; a record from before them reads as none", () => {
  const docLines = { "task:10": [line("a"), line("b")] };
  expect(asKept(sealedAndBack({ ...state(null), docLines }))?.docLines).toEqual(docLines);
  const older = sealedAndBack(state(null)) as Record<string, unknown>;
  delete older.docLines;
  expect(asKept(older)?.docLines).toEqual({});
});

test("a thread whose lines aren't all well formed is dropped, not half read", () => {
  const good = sealedAndBack(state(null)) as Record<string, unknown>;
  const kept = asKept({ ...good, docLines: { "task:1": [line("a"), { id: "b", author: "atlas", at: "soon", text: "x" }], "task:2": [line("c")], "task:3": "nope" } });
  expect(kept?.docLines).toEqual({ "task:2": [line("c")] });
});

test("keeping the same lines again changes nothing, so the record isn't sealed again", () => {
  const one = withDocLines({}, "task:10", [line("a")]);
  expect(withDocLines(one, "task:10", [line("a")])).toBe(one);
  expect(withDocLines({}, "task:10", [])).toEqual({});
  const none = {};
  expect(withDocLines(none, "task:10", [])).toBe(none);
});

test("a changed line replaces the thread's lines, keeps only what the record holds, and moves the thread first", () => {
  const one = withDocLines(withDocLines({}, "task:1", [line("a")]), "task:2", [line("b")]);
  const withMedia = { ...line("a", "edited"), media: { imgs: [], files: [] } };
  const changed = withDocLines(one, "task:1", [withMedia]);
  expect(Object.keys(changed)).toEqual(["task:1", "task:2"]);
  expect(changed["task:1"]).toEqual([line("a", "edited")]);
});

test("a thread keeps its last 40 lines, and the record its 30 most recent threads", () => {
  const many = Array.from({ length: 45 }, (_, i) => line(`l${i}`));
  expect(withDocLines({}, "task:1", many)["task:1"]?.map((l) => l.id)).toEqual(many.slice(-40).map((l) => l.id));
  let all = {};
  for (let i = 0; i < 32; i++) all = withDocLines(all, `task:${i}`, [line(`l${i}`)]);
  expect(Object.keys(all)).toHaveLength(30);
  expect(Object.keys(all)[0]).toBe("task:31");
  expect(Object.keys(all)).not.toContain("task:0");
  expect(Object.keys(all)).not.toContain("task:1");
  expect(withDocLines(all, "task:5", [])).not.toHaveProperty("task:5");
});
