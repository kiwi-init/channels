import { describe, expect, test } from "bun:test";
import { SESSION_PRINT_RE } from "@kiwi/core/protocol.ts";
import { sessionFingerprint } from "@kiwi/core/session-print.ts";
import { sameCard } from "../src/card.ts";
import { realSession, sessionNeighbours } from "../src/seats.ts";
import type { Config } from "../src/config.ts";
import { inFlight } from "../src/cli/commands/channel.ts";
import { resetLine } from "@kiwi/core/state/reset.ts";
import type { Task } from "@kiwi/core/state.ts";

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

describe("one session serving seats in more than one channel, as this machine sees it", () => {
  const cfg = {
    channels: { here: {}, there: {}, kimi: {} },
    bindings: {
      "/work/a": [
        { alias: "here", as: "wren", harness: "codex", session: "thread-9" },
        { alias: "here", as: "solo", harness: "codex", session: "thread-1" },
      ],
      "/work/b": { alias: "there", as: "toucan", harness: "codex", session: "thread-9" },
      "/work/c": { alias: "kimi", as: "kim", harness: "kimi", session: "kimi-pid-7" },
      "/work/d": { alias: "there", as: "kim2", harness: "kimi", session: "kimi-pid-7" },
    },
  } as unknown as Config;

  test("a seat here that shares a real session with a seat in another channel is named with it; pid stand-ins never match", () => {
    expect([...sessionNeighbours(cfg, "here")].map(([seat, others]) => [seat, others.map((o) => `${o.alias}/${o.as}`)])).toEqual([["wren", ["there/toucan"]]]);
    expect(sessionNeighbours(cfg, "kimi").size).toBe(0);
  });

  test("the other seat's open review round and task in progress are what a reset would lose", () => {
    const task = (id: number, more: Partial<Task>): Task => ({ id, title: "x", state: "doing", createdBy: "owl", createdAt: 0, updatedAt: 0, notes: [], workedBy: [], rounds: [], ...more }) as Task;
    const tasks = new Map<number, Task>([
      [7, task(7, { state: "review", review: "toucan", rounds: [{ n: 2, by: "win", seq: 9, ts: 9, result: { kind: "open" } }] })],
      [8, task(8, { owner: "toucan" })],
      [9, task(9, { owner: "other" })],
    ]);
    expect(inFlight({ tasks }, "toucan")).toEqual(["round 2 of T7 to review", "T8 in progress"]);
    expect(inFlight({ tasks }, "nobody")).toEqual([]);
  });
});

describe("the status line for a reviewer", () => {
  const card = (session?: string) => ({ harness: "codex", at: 1, ...(session ? { session } : {}) });
  test("says it needs a fresh session, that it's waived, and who shares its session", () => {
    const members = new Map([
      ["mac", { active: true, card: card("sessionAAAAAAAA1"), reset: { kind: "needs" as const, verdict: 41, session: "sessionAAAAAAAA1" } }],
      ["zed", { active: true, card: card("sessionAAAAAAAA1") }],
      ["kim", { active: true, card: card(), reset: { kind: "waived" as const } }],
    ]);
    expect(resetLine({ reviewReset: true, members }, "mac")).toBe(
      "needs a fresh session since verdict #41: reviews nothing until it rejoins from a new session · shares a session with @zed: resetting it resets them too",
    );
    expect(resetLine({ reviewReset: true, members }, "kim")).toBe("may review from one session (waived)");
    expect(resetLine({ reviewReset: false, members }, "kim")).toBe("");
  });
});
