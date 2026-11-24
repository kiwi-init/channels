import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckpointAsk } from "@kiwi/core/state/types.ts";
import { noteOwedShown, owedMark, owedShown, owedText } from "../src/hooks/checkpoint-ask.ts";

const ask = (over: Partial<CheckpointAsk> = {}): CheckpointAsk => ({ seq: 40, at: 1, by: "jon", asks: [], unreachable: [], occurrence: null, ...over });

describe("the checkpoint request at the turn boundary", () => {
  test("names each missing task, the command for the first, and who asked", () => {
    const text = owedText({ ask: ask(), tasks: [3, 5], lead: false }, "kiwi");
    expect(text).toContain("jon (#40) asks for your checkpoints");
    expect(text).toContain("T3, T5");
    expect(text).toContain("`kiwi task checkpoint T3 --file note.md`");
    expect(text).not.toContain("task checkpoint lead");
  });

  test("a lead owes its channel checkpoint, alone or after its tasks", () => {
    expect(owedText({ ask: ask(), tasks: [], lead: true }, "kiwi")).toContain("`kiwi task checkpoint lead --file note.md`");
    const both = owedText({ ask: ask(), tasks: [7], lead: true }, "kiwi");
    expect(both).toContain("T7");
    expect(both).toContain("task checkpoint lead");
  });

  test("the daily request says so; past eight tasks it counts the rest; with nothing owed there's no text", () => {
    expect(owedText({ ask: ask({ occurrence: "2026-11-16T18:00" }), tasks: [1], lead: false }, "kiwi")).toContain("The daily checkpoint request (#40)");
    expect(owedText({ ask: ask(), tasks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], lead: false }, "kiwi")).toContain("T8 and 2 more");
    expect(owedText({ ask: ask(), tasks: [], lead: false }, "kiwi")).toBeNull();
  });
});

describe("shown once per missing set", () => {
  let dir = "";
  const was = process.env.KIWI_HOME;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kiwi-ckpt-"));
    process.env.KIWI_HOME = dir;
  });
  afterAll(() => {
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    rmSync(dir, { recursive: true, force: true });
  });

  test("the same missing set isn't shown twice, and a smaller one is shown again", () => {
    const both = owedMark({ ask: ask(), tasks: [3, 5], lead: false });
    expect(owedShown("chan", "win", "s1")).toBeNull();
    noteOwedShown("chan", "win", "s1", both);
    expect(owedShown("chan", "win", "s1")).toBe(both);
    const one = owedMark({ ask: ask(), tasks: [5], lead: false });
    expect(one).not.toBe(both);
    expect(owedShown("chan", "win", "s2")).toBeNull();
  });

  test("a new request with the same tasks is a new mark", () => {
    expect(owedMark({ ask: ask({ seq: 41 }), tasks: [3], lead: false })).not.toBe(owedMark({ ask: ask(), tasks: [3], lead: false }));
  });
});
