import { afterEach, describe, expect, test } from "bun:test";
import type { Message } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState, type FoldBase } from "@kiwi/core/state.ts";
import { folded } from "@kiwi/core/state/fold-on.ts";
import { TrackedMap } from "@kiwi/core/state/tracked.ts";
import { rng, roster, SEC, stream, T0 } from "./fold-stream.ts";

const plain = (x: unknown): unknown => {
  if (x instanceof Map) return { map: [...Map.prototype.entries.call(x)].map(([k, v]) => [plain(k), plain(v)]) };
  if (x instanceof Set) return { set: [...x].map(plain) };
  if (Array.isArray(x)) return x.map(plain);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v === undefined ? { undefined: true } : plain(v)]));
  return x;
};

const batches = (r: () => number, messages: Message[], from: number): Message[][] => {
  const out: Message[][] = [];
  for (let i = from; i < messages.length;) {
    const n = 1 + Math.floor(r() * 5);
    out.push(messages.slice(i, i + n));
    i += n;
  }
  return out;
};

interface Run {
  steps: number;
  refolds: number;
  misses: string[];
  differ: string | null;
}

function run(seed: number, length: number, opts: { laterRole?: number; trimAt?: number; check?: boolean } = {}): Run {
  const r = rng(seed * 7 + 1);
  const { messages, times } = stream(seed, length);
  const people = roster(opts.laterRole);
  const start = 1 + Math.floor(r() * 10);
  let base: FoldBase | null = null;
  let held = messages.slice(0, start);
  let now = times[start - 1]!;
  let f = folded(held, people, now, null, null, null, true);
  const kept: { state: ChannelState; was: string }[] = [];
  const out: Run = { steps: 0, refolds: 0, misses: [], differ: null };
  const compare = (state: ChannelState, at: number) => {
    const oracle = fold(held, people, at, null, null, base);
    const a = JSON.stringify(plain(state));
    const b = JSON.stringify(plain(oracle));
    if (a !== b && !out.differ) out.differ = `seed ${seed} at #${held.at(-1)?.seq} (now ${at - T0})`;
    if (opts.check !== false) expect(plain(state)).toEqual(plain(oracle));
    kept.push({ state, was: a });
  };
  compare(f.state, now);
  for (const batch of batches(r, messages, start)) {
    const end = batch.at(-1)!.seq;
    now = times[end - 1]! + (r() < 0.2 ? Math.floor(r() * 400 * SEC) : 0);
    held = [...held, ...batch];
    if (opts.trimAt !== undefined && base === null && end >= opts.trimAt) {
      const cut = held.length - 5;
      let next: FoldBase | null = null;
      fold(held.slice(0, cut), people, now, null, null, null, (b) => void (next = b));
      base = next;
      held = held.slice(cut);
      f = folded(held, people, now, null, null, base, true);
      out.refolds++;
      compare(f.state, now);
      continue;
    }
    const state = f.next(batch, now);
    if (state) out.steps++;
    else {
      out.refolds++;
      out.misses.push(...f.misses);
      f = folded(held, people, now, null, null, base, true);
    }
    compare(f.state, now);
    if (r() < 0.15) {
      const later = now + Math.floor(r() * 300 * SEC);
      const again = f.next([], later);
      if (again) compare(again, later);
    }
  }
  out.misses.push(...f.misses);
  for (const k of kept) if (JSON.stringify(plain(k.state)) !== k.was && !out.differ) out.differ = `seed ${seed}: an earlier state changed`;
  if (opts.check !== false) for (const k of kept) expect(JSON.stringify(plain(k.state))).toBe(k.was);
  return out;
}

const restore: (() => void)[] = [];
afterEach(() => {
  for (const undo of restore.splice(0)) undo();
});

function patch(name: PropertyKey, fn: unknown) {
  const proto = TrackedMap.prototype as unknown as Record<PropertyKey, unknown>;
  const was = proto[name];
  proto[name] = fn;
  restore.push(() => void (proto[name] = was));
}

describe("folding each new message on the last state", () => {
  test("equals a full fold at every cut, across 40 seeds, batches of 1-5 and clock moves", () => {
    let steps = 0;
    let refolds = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const got = run(seed, 160);
      expect(got.misses).toEqual([]);
      steps += got.steps;
      refolds += got.refolds;
    }
    expect(steps).toBeGreaterThan(400);
    expect(refolds).toBeGreaterThan(100);
  }, 120_000);

  test("a lead role that waits in the roster takes effect between two appends as in a full fold", () => {
    for (let seed = 41; seed <= 50; seed++) expect(run(seed, 80, { laterRole: 30 }).misses).toEqual([]);
  }, 60_000);

  test("a trimmed base in place of the old one, then appends on it", () => {
    for (let seed = 51; seed <= 60; seed++) expect(run(seed, 140, { trimAt: 70 }).misses).toEqual([]);
  }, 60_000);

  test("with recording off, the new state is stale and differs from a full fold", () => {
    for (const name of ["get", "set", "delete", "values", "entries", "forEach"] as const) {
      const base = Map.prototype[name] as (...a: unknown[]) => unknown;
      patch(name, function (this: Map<unknown, unknown>, ...args: unknown[]) {
        return base.apply(this, args);
      });
    }
    patch(
      Symbol.iterator as never,
      function (this: Map<unknown, unknown>) {
        return Map.prototype.entries.call(this);
      } as never,
    );
    const differs = Array.from({ length: 10 }, (_, i) => run(i + 1, 160, { check: false }).differ).filter(Boolean);
    expect(differs.length).toBeGreaterThan(0);
  }, 60_000);

  test("with reads not recorded, the verifier names the keys that changed without a record", () => {
    const base = Map.prototype.get as (k: unknown) => unknown;
    patch("get", function (this: Map<unknown, unknown>, k: unknown) {
      return base.call(this, k);
    });
    const misses = Array.from({ length: 10 }, (_, i) => run(i + 1, 160, { check: false }).misses).flat();
    expect(misses.length).toBeGreaterThan(0);
  }, 60_000);

  test("a malformed re keeps the order a full fold has: the head moves past it, and a later message folds on (review #17922)", () => {
    const { messages } = stream(1, 6);
    const chat = (seq: number, over: Partial<Message>): Message =>
      ({ ...messages[0]!, id: `bad-${seq}`, seq, kind: "msg", body: `chat ${seq}`, from: "win", pk: "w".repeat(43), ts: T0 + seq * SEC, rts: T0 + seq * SEC, ...over }) as Message;
    const bad = chat(7, { re: 5 as unknown as number[] });
    const good = chat(8, {});
    const at = T0 + 9 * SEC;
    const whole = fold([...messages, bad], roster(), at);
    expect(whole.head).toBe(7);
    const f = folded(messages, roster(), at);
    const onBad = f.next([bad], at) ?? folded([...messages, bad], roster(), at).state;
    expect(onBad.head).toBe(7);
    expect(JSON.stringify(plain(onBad))).toBe(JSON.stringify(plain(whole)));
    const afterGood = f.next([good], at);
    expect(afterGood?.head).toBe(8);
    expect(JSON.stringify(plain(afterGood))).toBe(JSON.stringify(plain(fold([...messages, bad, good], roster(), at))));
  });
});
