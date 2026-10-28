import { describe, expect, test } from "bun:test";
import { freePath, savedName } from "../desktop/src/save-file.ts";

describe("a file the page asks the app to save", () => {
  test("keeps a plain name and its kind", () => {
    expect(savedName("kiwi 2026-10-28 transcript.md")).toBe("kiwi 2026-10-28 transcript.md");
    expect(savedName("kiwi.jsonl")).toBe("kiwi.jsonl");
  });

  test("can't climb out of Downloads or hide itself", () => {
    expect(savedName("../../.ssh/authorized_keys.md")).toBe("ssh authorized_keys.md");
    expect(savedName("a/b\\c:d.md")).toBe("a b c d.md");
    expect(savedName("..hidden.md")).toBe("hidden.md");
  });

  test("is only ever a transcript or a log", () => {
    for (const name of ["run.command", "x.app", "x.sh", "x.md.exe", "noext"]) expect(() => savedName(name)).toThrow("only .md and .jsonl");
    expect(() => savedName("...md")).toThrow("needs a name");
  });

  test("never overwrites: a taken name gets (2), (3) and so on", () => {
    const taken = new Set(["/d/log.md", "/d/log (2).md"]);
    expect(freePath("/d", "log.md", (f) => taken.has(f))).toBe("/d/log (3).md");
    expect(freePath("/d", "new.md", (f) => taken.has(f))).toBe("/d/new.md");
  });
});
