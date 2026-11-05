import { describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold } from "@kiwi/core/state.ts";
import type { Member } from "@kiwi/core/membership.ts";
import { lighter } from "./lean.ts";
import { dropWarm, heldWindow, keepWarm, leanLoaded, LIGHT, WARM_FULL, WARM_LIGHT, warmOf, type Warm } from "./warm.ts";

const msg = (seq: number): Message => ({ v: PROTOCOL_VERSION, id: `id-${seq}`, from: "atlas", kind: "msg", body: `m${seq}`, ts: 1_700_000_000_000 + seq, seq, sigOk: true });
const held = (seqs: number[], unread: number[] = []): Warm => ({
  messages: seqs.map(msg),
  reach: [],
  unread,
  roster: [],
  requests: [],
  marks: new Map(),
  guardFloor: null,
  roomsFloor: null,
  base: null,
});
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("a channel's warm copy, kept for this session", () => {
  test("is per channel, and gone once dropped", () => {
    keepWarm("mc2-a", held([1, 2]));
    keepWarm("mc2-b", held([7]));
    expect(warmOf("mc2-a")?.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(warmOf("mc2-b")?.messages.map((m) => m.seq)).toEqual([7]);
    dropWarm("mc2-a");
    expect(warmOf("mc2-a")).toBeUndefined();
    expect(warmOf("mc2-b")).toBeDefined();
    dropWarm("mc2-b");
  });

  test("a copy that holds the window follows from its last message, with no cache read", () => {
    expect(heldWindow(held(range(1, 400)), 400, 2000)).toEqual({ since: 400, firstSeq: 1 });
    expect(heldWindow(held(range(1, 400)), 412, 2000)).toEqual({ since: 400, firstSeq: 1 });
    expect(heldWindow(held(range(1, 2400)), 2400, 2000)).toEqual({ since: 2400, firstSeq: 401 });
  });

  test("no copy, a gap in it, or one that ends before the window: read the cache as before", () => {
    expect(heldWindow(undefined, 400, 2000)).toBeNull();
    expect(heldWindow(held([]), 400, 2000)).toBeNull();
    expect(heldWindow(held([1, 2, 4]), 400, 2000)).toBeNull();
    expect(heldWindow(held([1, 2, 4], [3]), 4, 2000)).toEqual({ since: 4, firstSeq: 1 });
    expect(heldWindow(held(range(1, 10)), 5000, 2000)).toBeNull();
  });
});

test(`only the last ${WARM_FULL} opened channels stay whole: the one visited longest ago drops to a light copy, and a revisit counts as recent`, async () => {
  await leanLoaded();
  for (const c of ["lru-a", "lru-b"]) keepWarm(c, held(range(1, 400)));
  keepWarm("lru-a", held(range(1, 401)));
  keepWarm("lru-c", held(range(1, 400)));
  expect(["lru-a", "lru-b", "lru-c"].map((c) => warmOf(c)?.messages.length)).toEqual([401, LIGHT, 400]);
  for (const c of ["lru-a", "lru-b", "lru-c"]) dropWarm(c);
});

test("a light copy from Home never replaces a whole one, and light copies past the limit go cold", () => {
  keepWarm("light-x", held(range(1, 400)));
  keepWarm("light-x", held(range(1, 50)), "light");
  expect(warmOf("light-x")?.messages.length).toBe(400);
  const codes = range(1, WARM_LIGHT + 1).map((i) => `light-${i}`);
  for (const c of codes) keepWarm(c, held([1]), "light");
  expect(warmOf(codes[0]!)).toBeUndefined();
  expect(warmOf(codes.at(-1)!)).toBeDefined();
  for (const c of [...codes, "light-x"]) dropWarm(c);
});

test("dropping to a light copy folds what it lets go into the base, so the state it paints is the same", async () => {
  const atlas = await generateIdentity("atlas");
  const jow = await generateIdentity("jow");
  const roster: Member[] = [
    { name: "jow", pk: jow.pk, xpk: "x-jow", owner: true, at: 0, active: true, kind: "human" },
    { name: "atlas", pk: atlas.pk, xpk: "x-atlas", owner: false, at: 0, active: true, kind: "agent" },
  ];
  const log: Message[] = [];
  const post = async (body: string, ev?: Event) => {
    const seq = log.length + 1;
    const p = await sign(atlas, { v: PROTOCOL_VERSION, id: `x${seq}`, from: "atlas", kind: ev ? "event" : "msg", body, ...(ev ? { ev } : {}), ts: seq });
    log.push({ ...p, seq, rts: seq, sigOk: await verify(p) } as Message);
  };
  for (let i = 0; i < 10; i++) await post("", { op: "task.add", title: `task ${i}` } as Event);
  for (let i = 0; i < 390; i++) await post(`message ${i}`);
  const w: Warm = { ...held([]), messages: log, roster };
  const light = lighter(w, 10_000);
  expect(light.messages.map((m) => m.seq)).toEqual(range(351, 400));
  expect(light.base?.n).toBe(350);
  expect(light.reach.map((m) => m.seq)).toEqual(range(1, 350));
  const before = fold(log, roster, 10_000);
  const after = fold(light.messages, roster, 10_000, null, null, light.base);
  expect([...after.tasks.values()].map((t) => t.title)).toEqual([...before.tasks.values()].map((t) => t.title));
  expect(after.head).toBe(before.head);
});
