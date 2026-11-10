import { describe, expect, test } from "bun:test";
import { mergeMarks } from "@kiwi/core/note.ts";

describe("the read floor rides the person's note as one more mark (T3487)", () => {
  test("a build that doesn't know the key still carries it when it writes: merging keeps what the note has", () => {
    const note = { main: 40, floor: 57, "room:design": 9 };
    const oldBuildsOwn = { main: 44, "task:7": 12 };
    expect(mergeMarks(note, oldBuildsOwn)).toEqual({ main: 44, floor: 57, "room:design": 9, "task:7": 12 });
  });

  test("the floor only rises, like every mark, whichever side has the higher one", () => {
    expect(mergeMarks({ floor: 57 }, { floor: 30 }).floor).toBe(57);
    expect(mergeMarks({ floor: 30 }, { floor: 57 }).floor).toBe(57);
    expect(mergeMarks({}, { floor: 57 }).floor).toBe(57);
  });
});
