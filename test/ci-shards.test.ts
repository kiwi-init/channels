import { describe, expect, test } from "bun:test";
import { share } from "../scripts/ci-shards.ts";

const files = Array.from({ length: 20 }, (_, i) => `test/f${String(i).padStart(2, "0")}.test.ts`);
const parts = (ms: Record<string, number>, n: number) => Array.from({ length: n }, (_, i) => share(files, i + 1, n, ms));

describe("share", () => {
  test("every file lands in exactly one shard, whatever the timings know", () => {
    for (const ms of [{}, { [files[3]!]: 90_000, [files[7]!]: 50 }, Object.fromEntries(files.map((f, i) => [f, (i * 7919) % 1000]))])
      for (const n of [1, 2, 3, 5]) {
        const dealt = parts(ms, n).flat();
        expect(dealt.sort()).toEqual([...files].sort());
      }
  });

  test("the slow files spread out, and each shard's time stays close to an even split", () => {
    const ms = Object.fromEntries(files.map((f, i) => [f, i < 3 ? 60_000 : 1_000]));
    const shards = parts(ms, 3);
    for (const s of shards) expect(s.filter((f) => ms[f] === 60_000)).toHaveLength(1);
    const totals = shards.map((s) => s.reduce((a, f) => a + ms[f]!, 0));
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1_000);
  });

  test("a file the timings don't know weighs the average of those they do", () => {
    const ms = { [files[0]!]: 10_000, [files[1]!]: 10_000 };
    const [a, b] = parts(ms, 2);
    expect(a!.length + b!.length).toBe(files.length);
    expect(Math.abs(a!.length - b!.length)).toBeLessThanOrEqual(1);
  });

  test("the same inputs always deal the same shards", () => {
    const ms = Object.fromEntries(files.map((f, i) => [f, i % 4]));
    expect(parts(ms, 3)).toEqual(parts({ ...ms }, 3));
  });
});
