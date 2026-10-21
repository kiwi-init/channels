import { describe, expect, test } from "bun:test";
import { capsuleOf, capsuleText, diffCommand, emptyCapsule, parseCapsule } from "@kiwi/core/capsule.ts";

const full = {
  branch: "T228-capsule",
  head: "1a2b3c4",
  next: "the reentry test",
  know: ["the capsule rides in the checkpoint note"],
  tried: ["a new event field: older clients drop the message"],
  traps: ["core can't name a Node global"],
  files: ["packages/core/src/capsule.ts", "src/cli/commands/tasks.ts"],
};

describe("a capsule", () => {
  test("reads back as itself from its text, one line per field and one per item", () => {
    const text = capsuleText(full);
    expect(text).toBe(
      [
        "branch: T228-capsule",
        "head: 1a2b3c4",
        "next: the reentry test",
        "know:",
        "- the capsule rides in the checkpoint note",
        "tried:",
        "- a new event field: older clients drop the message",
        "traps:",
        "- core can't name a Node global",
        "files:",
        "- packages/core/src/capsule.ts",
        "- src/cli/commands/tasks.ts",
      ].join("\n"),
    );
    expect(parseCapsule(text)).toEqual(full);
    expect(capsuleText({ ...emptyCapsule("ship it"), know: ["two\nlines", " "] })).toBe("next: ship it\nknow:\n- two lines");
  });

  test("is one only with a next step; free text stays a checkpoint, and a capsule takes what it doesn't know as known", () => {
    expect(parseCapsule("branch T1 at abc, next: tests")).toBeNull();
    expect(parseCapsule("next:\nknow:\n- x")).toBeNull();
    expect(parseCapsule("Next step: tests")).toBeNull();
    expect(parseCapsule("next: tests\r\nknow: inline\r\n* starred\r\nsome loose line\r\ntraps:\r\n  - indented")).toEqual({
      ...emptyCapsule("tests"),
      know: ["inline", "starred", "some loose line"],
      traps: ["indented"],
    });
    expect(parseCapsule("a loose line first\nnext: tests")?.know).toEqual(["a loose line first"]);
  });

  test("of a task is its newest checkpoint; an old free-text one is a legacy capsule whose whole text is known", () => {
    const note = (seq: number, text: string, checkpoint?: true) => ({ seq, by: "ana", ts: seq * 10, text, ...(checkpoint ? { checkpoint } : {}) });
    expect(capsuleOf({ notes: [note(1, "just a note")] })).toBeNull();
    expect(capsuleOf({ notes: [note(1, "branch T1 at abc\nnext: tests", true), note(2, "later note")] })).toEqual({
      ...emptyCapsule("tests"),
      know: ["branch T1 at abc"],
      seq: 1,
      by: "ana",
      at: 10,
      legacy: false,
    });
    expect(capsuleOf({ notes: [note(1, capsuleText(full), true), note(3, "  where it stands, in prose  ", true)] })).toEqual({
      ...emptyCapsule(),
      know: ["where it stands, in prose"],
      seq: 3,
      by: "ana",
      at: 30,
      legacy: true,
    });
  });

  test("points a reviewer at the round's diff, else the head, else the branch, against the remote's default branch", () => {
    expect(diffCommand(full, "9f8e7d6")).toBe("git diff origin/HEAD...9f8e7d6");
    expect(diffCommand(full, undefined)).toBe("git diff origin/HEAD...1a2b3c4");
    expect(diffCommand({ branch: "T228-capsule" }, " ")).toBe("git diff origin/HEAD...T228-capsule");
    expect(diffCommand({}, undefined)).toBeNull();
  });
});
