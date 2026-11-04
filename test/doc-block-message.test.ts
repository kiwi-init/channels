import { describe, expect, test } from "bun:test";
import { wellFormed } from "@kiwi/core/protocol.ts";

describe("a message names the doc block it came from", () => {
  const p = { v: 1, id: "x", from: "jow", kind: "msg", body: "ship it", ts: 1 };
  const block = { th: "Th1_abcdefghijklmnopqr", id: "Bk1_abcdefghijklmnopqr" };

  test("a person's message carries the thread doc and block it was written in", () => {
    expect(wellFormed({ ...p, block })).toBe(true);
    expect(wellFormed(p)).toBe(true);
  });

  test("only a plain message carries one, and only a well-formed one", () => {
    expect(wellFormed({ ...p, kind: "blocking", block })).toBe(false);
    expect(wellFormed({ ...p, block: { th: block.th } })).toBe(false);
    expect(wellFormed({ ...p, block: { th: "no spaces allowed", id: block.id } })).toBe(false);
    expect(wellFormed({ ...p, block: "Bk1" })).toBe(false);
  });
});
