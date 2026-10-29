import { describe, expect, test } from "bun:test";

import { avatarIndex } from "./avatar-pick";

describe("avatarIndex", () => {
  test("is the same robot for the same name, every time", () => {
    expect(avatarIndex("otter-gentle", 12)).toBe(avatarIndex("otter-gentle", 12));
  });

  test("stays inside the set", () => {
    for (const name of ["a", "kiwi-sh", "merge-bus", "deepseek-one", "", "名前"]) {
      const i = avatarIndex(name, 12);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(12);
    }
    expect(avatarIndex("anything", 0)).toBe(0);
  });

  test("spreads a channel's agents over the set", () => {
    const names = ["kiwi-sh", "merge-bus", "kiwi-browser", "deepseek-one", "deepseek-two", "claude-3", "otter-gentle", "heron-calm"];
    expect(new Set(names.map((n) => avatarIndex(n, 12))).size).toBeGreaterThanOrEqual(5);
  });
});
