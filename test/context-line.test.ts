import { describe, expect, test } from "bun:test";
import { tokensWord } from "@kiwi/core/format.ts";
import { CONTEXT_LINE, cleanActivity } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { crossing, nudgeShort, nudgeText, openTasksOf } from "../src/hooks/context-line.ts";

describe("context in tokens, in words", () => {
  test("thousands as k, a million and up as M, rounding never shows 1000k", () => {
    expect(tokensWord(400)).toBe("400");
    expect(tokensWord(262_431)).toBe("262k");
    expect(tokensWord(CONTEXT_LINE)).toBe("250k");
    expect(tokensWord(999_600)).toBe("1M");
    expect(tokensWord(1_000_000)).toBe("1M");
    expect(tokensWord(1_250_000)).toBe("1.3M");
  });
});

describe("crossing the line", () => {
  test("a nudge once per crossing: below resets, above nudges only the first time, unknown keeps the state", () => {
    expect(crossing(CONTEXT_LINE - 1, false)).toEqual({ nudge: false, over: false });
    expect(crossing(CONTEXT_LINE, false)).toEqual({ nudge: true, over: true });
    expect(crossing(CONTEXT_LINE + 50_000, true)).toEqual({ nudge: false, over: true });
    expect(crossing(120_000, true)).toEqual({ nudge: false, over: false });
    expect(crossing(undefined, true)).toEqual({ nudge: false, over: true });
    expect(crossing(undefined, false)).toEqual({ nudge: false, over: false });
  });
});

describe("the nudge", () => {
  test("names the context, the line, each open task and the command for the first, in one line that asks nothing of the turn", () => {
    const text = nudgeText({ used: 262_000 }, [7, 9], "kiwi --as ana")!;
    expect(text).not.toContain("\n");
    expect(text).not.toContain("Before you end this turn");
    expect(text).not.toMatch(/fresh session|new session|clear/i);
    expect(text).toContain("Your context is at 262k tokens, past the 250k line: a good point to write");
    expect(text).toContain("(T7, T9)");
    expect(text).toContain("`kiwi --as ana task checkpoint T7 --file note.md`");
  });

  test("past eight tasks it counts the rest; with no open task there is nothing to ask", () => {
    expect(nudgeText({ used: 300_000 }, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "kiwi")).toContain("T1, T2, T3, T4, T5, T6, T7, T8 and 2 more");
    expect(nudgeText({ used: 300_000 }, [], "kiwi")).toBeNull();
  });

  test("the lead is asked for its lead checkpoint, alone or after its open tasks", () => {
    const alone = nudgeText({ used: 300_000 }, [], "kiwi --as ana", true)!;
    expect(alone).toBe(
      "Your context is at 300k tokens, past the 250k line: a good point to write where the channel stands as you lead it, every open task and question by its id, with `kiwi --as ana task checkpoint lead --file note.md`.",
    );
    expect(alone).not.toContain("open tasks");
    const both = nudgeText({ used: 300_000 }, [7], "kiwi", true)!;
    expect(both).toContain("(T7) with `kiwi task checkpoint T7 --file note.md`");
    expect(both).toContain("; and where the channel stands as you lead it, every open task and question by its id, with `kiwi task checkpoint lead --file note.md`");
    expect(both.indexOf("T7")).toBeLessThan(both.indexOf("checkpoint lead"));
  });

  test("the short nudge, for when the full one doesn't fit, still names every command and is far shorter", () => {
    expect(nudgeShort([], "kiwi")).toBeNull();
    expect(nudgeShort([7, 9], "kiwi")).toBe("Past the 250k context line: `kiwi task checkpoint T7 --file note.md` for each open task.");
    expect(nudgeShort([], "kiwi", true)).toBe("Past the 250k context line: `kiwi task checkpoint lead --file note.md`.");
    const short = nudgeShort([7], "kiwi --as ana", true)!;
    expect(short).toContain("`kiwi --as ana task checkpoint T7 --file note.md` for each open task and `kiwi --as ana task checkpoint lead --file note.md`");
    expect(short.length * 2).toBeLessThan(nudgeText({ used: 300_000 }, [7], "kiwi --as ana", true)!.length);
  });

  test("the open tasks are the seat's own that aren't done or archived", () => {
    const roster: Roster = [];
    const state = fold([], roster);
    const task = (id: number, owner: string, extra: object = {}) => state.tasks.set(id, { id, title: `t${id}`, owner, state: "doing", notes: [], ...extra } as never);
    task(3, "ana");
    task(1, "ana");
    task(2, "bo");
    task(4, "ana", { state: "done" });
    task(5, "ana", { archived: true });
    expect(openTasksOf(state, "ana")).toEqual([1, 3]);
  });
});

describe("context on the wire", () => {
  test("an activity keeps its context's token counts and drops anything that isn't one", () => {
    expect(cleanActivity({ state: "idle", context: { used: 262_000, window: 1_000_000, prompt: "secret" } })).toEqual({ state: "idle", context: { used: 262_000, window: 1_000_000 } });
    expect(cleanActivity({ state: "idle", context: { used: 5, window: -1 } })).toEqual({ state: "idle", context: { used: 5 } });
    expect(cleanActivity({ state: "idle", context: { used: 0 } })).toEqual({ state: "idle" });
    expect(cleanActivity({ state: "idle", context: { used: 1.5 } })).toEqual({ state: "idle" });
    expect(cleanActivity({ state: "idle", context: { used: 1e12 } })).toEqual({ state: "idle" });
    expect(cleanActivity({ state: "idle", context: "262k" })).toEqual({ state: "idle" });
  });
});
