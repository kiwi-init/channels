import { describe, expect, test } from "bun:test";
import { sameChannels, type KnownChannel } from "./list.ts";

const list = (): KnownChannel[] => [
  { code: "mc2-a", at: 20, name: "launch" },
  { code: "mc2-b", at: 10 },
];

describe("the known channels keep their identity until one changes (T1786)", () => {
  test("a hundred reads of an unchanged store are one list, so nothing downstream rebuilds", () => {
    let held = list();
    const seen = new Set<KnownChannel[]>([held]);
    for (let i = 0; i < 100; i++) seen.add((held = sameChannels(held, list())));
    expect(seen.size).toBe(1);
  });

  test("a new channel, a rename, a new time or a new order is a new list", () => {
    const held = list();
    expect(sameChannels(held, [...list(), { code: "mc2-c", at: 5 }])).not.toBe(held);
    expect(sameChannels(held, [{ code: "mc2-a", at: 20, name: "launch day" }, list()[1]!])).not.toBe(held);
    expect(sameChannels(held, [{ code: "mc2-a", at: 21, name: "launch" }, list()[1]!])).not.toBe(held);
    expect(sameChannels(held, [...list()].reverse())).not.toBe(held);
    expect(sameChannels(held, [list()[0]!])).not.toBe(held);
    expect(sameChannels([], [])).toEqual([]);
  });
});
