import { describe, expect, test } from "bun:test";
import { ownMessage } from "@kiwi/core/client/wire.ts";
import { wellFormed, wellFormedHandoff } from "@kiwi/core/protocol.ts";

const base = { v: 1, id: "1", from: "dev", kind: "msg", body: "hi" };

describe("a message's time is one a date can hold (T136)", () => {
  test("a time no date can hold is malformed, so no client shows or saves the message", () => {
    expect(wellFormed({ ...base, ts: Date.UTC(2026, 9, 20) })).toBe(true);
    expect(wellFormed({ ...base, ts: 8.64e15 })).toBe(true);
    expect(wellFormed({ ...base, ts: -8.64e15 })).toBe(true);
    for (const ts of [8.64e15 + 1, 1e16, -1e16, Number.MAX_VALUE, Infinity, NaN, "1700000000000"]) expect(wellFormed({ ...base, ts })).toBe(false);
    expect(ownMessage({ ...base, ts: 1e16 }, 7, Date.UTC(2026, 9, 20))).toBeNull();
  });

  test("a handoff's expiry follows the same rule", () => {
    const handoff = { url: "https://example.com/session", vendor: "Example" };
    expect(wellFormedHandoff({ ...handoff, expiresAt: Date.UTC(2026, 9, 20) })).toBe(true);
    expect(wellFormedHandoff({ ...handoff, expiresAt: 1e16 })).toBe(false);
  });
});
