import { describe, expect, test } from "bun:test";

import { formatAgoShort, formatFull, formatShort, formatStamp, formatTime, isoTime, shortTitle } from "./format";

describe("shortTitle", () => {
  test("keeps a title that is already short", () => {
    expect(shortTitle("Blue accent color")).toBe("Blue accent color");
  });

  test("stops at the first aside", () => {
    expect(shortTitle("Seat on first approval (owner's pick on #1340): a linked computer gets a seat only when…")).toBe("Seat on first approval");
    expect(shortTitle("Sidebar: tasks grouped by state (owner picked B)")).toBe("Sidebar: tasks grouped by state");
  });

  test("stops at the first sentence, keeping dots inside words", () => {
    expect(shortTitle("Ship kiwi 0.10.3. Then tell everyone.")).toBe("Ship kiwi 0.10.3");
  });

  test("a long clause keeps its several-word head before the colon", () => {
    expect(shortTitle("Coordinator mode on/off is easy to find: the details panel shows 'Coordinator mode: on (atlas relays)'")).toBe("Coordinator mode on/off is easy to find");
    expect(shortTitle("Accent color: replace the kiwi green with a blue the owner likes (our own blue, refined)")).toBe("Accent color");
  });

  test("a one-word label before the colon stays: the row truncates instead", () => {
    expect(shortTitle("Bug: kiwi's Claude Code hooks in a checkout shared by several agents name the wrong seat. In /Users/jow")).toBe(
      "Bug: kiwi's Claude Code hooks in a checkout shared by several agents name the wrong seat",
    );
  });

  test("only the first line, and never empty", () => {
    expect(shortTitle("Fix the build\nmore detail")).toBe("Fix the build");
    expect(shortTitle("(draft)")).toBe("(draft)");
  });
});

test("a row's time is short: now, then minutes, hours and days without the ago", () => {
  const now = 10_000_000;
  expect(formatAgoShort(now - 5_000, now)).toBe("now");
  expect(formatAgoShort(now - 4 * 60_000, now)).toBe("4m");
  expect(formatAgoShort(now - 3 * 3_600_000, now)).toBe("3h");
  expect(formatAgoShort(now - 2 * 86_400_000, now)).toBe("2d");
});

test("a time no date can hold formats as nothing instead of throwing (T136)", () => {
  for (const ts of [1e16, -1e16, Number.NaN]) {
    expect(formatTime(ts)).toBe("");
    expect(formatFull(ts)).toBe("");
    expect(formatShort(ts)).toBe("");
    expect(formatStamp(ts)).toBe("");
    expect(isoTime(ts)).toBeUndefined();
  }
  expect(isoTime(Date.UTC(2026, 9, 20))).toBe("2026-10-20T00:00:00.000Z");
  expect(formatShort(Date.UTC(2026, 9, 20, 12), Date.UTC(2026, 9, 20, 13))).toBe(formatTime(Date.UTC(2026, 9, 20, 12)));
});
