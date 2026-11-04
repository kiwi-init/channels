import { describe, expect, test } from "bun:test";
import { inOrder } from "../scripts/doc-oracle.ts";

const doc = (...blocks: string[]) => `#general's shared doc:\n${blocks.join("\n\n")}`;

describe("the fuzzer's oracle finds every whole sent line, in order (T2559)", () => {
  test("a doc that holds every sent line whole and in order passes", () => {
    expect(inOrder(doc("jow: first\nsecond", "bot1 (agent): bot1 line 1: building", "jow: third"), ["first\nsecond", "third"])).toBeNull();
  });

  test("a lost or changed continuation line fails, not just a lost first line", () => {
    expect(inOrder(doc("jow: first"), ["first\nLOST SECOND LINE"])).toBe("first\nLOST SECOND LINE");
    expect(inOrder(doc("jow: first\nLOST SECOND LINE", "jow: next"), ["first", "next"])).toBe("first");
    expect(inOrder(doc("jow: first\nsecxnd"), ["first\nsecond"])).toBe("first\nsecond");
    expect(inOrder(doc("jow: first\nsecond and more"), ["first\nsecond"])).toBe("first\nsecond");
  });

  test("lines out of order, or another author's line, fail", () => {
    expect(inOrder(doc("jow: b", "jow: a"), ["a", "b"])).toBe("b");
    expect(inOrder(doc("harry: a"), ["a"])).toBe("a");
  });

  test("only blank space around a line is forgiven: a leading blank line, trailing spaces and a trailing blank paragraph", () => {
    expect(inOrder(doc("jow:  \nabc", "bot1 (agent): x"), ["abc"])).toBeNull();
    expect(inOrder(doc("jow: abc  ", "jow: def\n", "bot1 (agent): x"), ["abc", "def"])).toBeNull();
  });

  test("a blank paragraph inside a sent line must be there too", () => {
    expect(inOrder(doc("jow: one\n\ntwo", "bot1 (agent): x"), ["one\n\ntwo"])).toBeNull();
    expect(inOrder(doc("jow: one\n\ntwo", "bot1 (agent): x"), ["one"])).toBe("one");
  });
});
