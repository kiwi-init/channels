import { describe, expect, test } from "bun:test";
import { SESSION_PRINT_RE } from "@kiwi/core/protocol.ts";
import { sessionFingerprint } from "@kiwi/core/session-print.ts";
import { sameCard } from "../src/card.ts";
import { realSession } from "../src/seats.ts";

const ROOM_A = "ab".repeat(16);
const ROOM_B = "cd".repeat(16);

describe("which sessions count as real", () => {
  test("a per-conversation id from claude, codex, grok, opencode, mimo or agy counts", () => {
    for (const harness of ["claude", "codex", "grok", "opencode", "mimo", "agy"] as const) expect(realSession({ harness, session: "thread-1" })).toBe("thread-1");
  });

  test("a process-id stand-in, a harness outside the list, or no id doesn't", () => {
    expect(realSession({ harness: "mimo", session: "mimo-pid-4242", pid: 4242 })).toBeUndefined();
    expect(realSession({ harness: "kimi", session: "kimi-pid-7", pid: 7 })).toBeUndefined();
    expect(realSession({ harness: "zcode", session: "zcode-pid-8", pid: 8 })).toBeUndefined();
    expect(realSession({ harness: "gemini", session: "gemini-pid-9", pid: 9 })).toBeUndefined();
    expect(realSession({ harness: "cursor", session: "conv-1" })).toBeUndefined();
    expect(realSession({ harness: "claude" })).toBeUndefined();
    expect(realSession({})).toBeUndefined();
  });
});

describe("the fingerprint", () => {
  test("is well formed, stable for one session in one channel, and differs across sessions and channels", async () => {
    const a = await sessionFingerprint(ROOM_A, "thread-1");
    expect(a).toMatch(SESSION_PRINT_RE);
    expect(await sessionFingerprint(ROOM_A, "thread-1")).toBe(a);
    expect(await sessionFingerprint(ROOM_A, "thread-2")).not.toBe(a);
    expect(await sessionFingerprint(ROOM_B, "thread-1")).not.toBe(a);
    expect(a).not.toContain("thread-1");
  });

  test("a card with a new fingerprint isn't the same card, so it gets posted", () => {
    expect(sameCard({ harness: "codex", session: "sessionAAAAAAAA1" }, { harness: "codex", session: "sessionBBBBBBBB2" })).toBe(false);
    expect(sameCard({ harness: "codex", session: "sessionAAAAAAAA1" }, { harness: "codex", session: "sessionAAAAAAAA1" })).toBe(true);
  });
});
