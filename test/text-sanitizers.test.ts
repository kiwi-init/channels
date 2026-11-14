import { describe, expect, test } from "bun:test";
import { cleanActivity, cleanCard } from "@kiwi/core/protocol.ts";
import { inlineText } from "@kiwi/core/membership.ts";
import * as base from "./fixtures/text-sanitizers.ts";

const codepoints = [
  ...Array.from({ length: 32 }, (_, i) => i),
  ...Array.from({ length: 33 }, (_, i) => 0x7f + i),
  ...Array.from({ length: 5 }, (_, i) => 0x200b + i),
  ...Array.from({ length: 7 }, (_, i) => 0x2028 + i),
  ...Array.from({ length: 10 }, (_, i) => 0x2060 + i),
  0xfeff,
  0x00a0,
  0x1680,
  0x2000,
  0x2007,
  0x202f,
  0x205f,
  0x3000,
];
const corpus: unknown[] = [
  undefined,
  null,
  false,
  true,
  0,
  42,
  NaN,
  Infinity,
  {},
  [],
  ["text"],
  { toString: () => "text" },
  "",
  " ",
  "\t\n\r",
  "one  two",
  " one\t\n\u0000two ",
  "é\u0301 🥝 漢字",
  "\ud800",
  "\udfff",
  "a\ud800b\udfffc",
  ...[39, 40, 41, 59, 60, 61, 119, 120, 121, 499, 500, 501, 1000].flatMap((length) => ["x".repeat(length), "🥝".repeat(length), "x".repeat(length - 1) + "🥝"]),
  ...codepoints.flatMap((code) => {
    const character = String.fromCodePoint(code);
    return [character, `a${character}b`, ` a${character}${character}  b `];
  }),
  codepoints.map((code) => String.fromCodePoint(code)).join(""),
];

describe(`sanitizer output matches original callers at ${base.SANITIZER_BASE}`, () => {
  for (const [index, input] of corpus.entries()) {
    test(`card input ${index}`, () => {
      const card = { os: input, arch: input, harness: input, model: input, cpu: input, memory: input, repo: input, branch: input, note: input, tools: [input, "kept"] };
      expect(JSON.stringify(cleanCard(card))).toBe(JSON.stringify(base.cleanCard(card)));
      expect(JSON.stringify(cleanCard(input))).toBe(JSON.stringify(base.cleanCard(input)));
    });
    test(`activity input ${index}`, () => {
      for (const state of ["working", "waiting", "idle", "unknown", "invalid"]) {
        const activity = { state, tool: input, model: input, since: 123, context: { used: 10, window: 100 } };
        expect(JSON.stringify(cleanActivity(activity))).toBe(JSON.stringify(base.cleanActivity(activity)));
      }
      expect(JSON.stringify(cleanActivity(input))).toBe(JSON.stringify(base.cleanActivity(input)));
    });
    test(`inline text input ${index}`, () => {
      expect(inlineText(input)).toBe(base.inlineText(input));
      for (const max of [-1, 0, 1, 2, 40, 60, 120, 500]) expect(inlineText(input, max)).toBe(base.inlineText(input, max));
    });
  }

  test("card pruning, tool limits, arrays and objects keep original behavior", () => {
    for (const tools of [[], Array(45).fill("tool"), ["", null, 3, "first", "a\n\nlast"], "not-an-array", undefined]) {
      const card = { os: " linux ", tools, extra: "ignored", note: "n".repeat(501), fresh: 7, session: "ignored" };
      expect(JSON.stringify(cleanCard(card))).toBe(JSON.stringify(base.cleanCard(card)));
    }
    expect(cleanCard({ model: "a  b" })).toEqual({ model: "a  b" });
    expect(cleanCard({ model: "a\u202eb" })).toEqual({ model: "a\u202eb" });
    expect(cleanCard({ model: "a\u0000\u0001b" })).toEqual({ model: "a b" });
    expect(cleanCard({ model: "x".repeat(119) + "🥝" })?.model).toBe("x".repeat(119) + "\ud83e");
  });

  test("activity state, timestamp and context boundaries keep original behavior", () => {
    for (const state of ["working", "waiting", "idle", "unknown", null, 0, "other"]) {
      for (const since of [undefined, null, 0, -1, NaN, Infinity, 123]) {
        for (const context of [undefined, null, {}, { used: 0 }, { used: 1, window: 0 }, { used: 1, window: 2 }, { used: 100_000_000 }, { used: 100_000_001 }, { used: 1.5 }, { used: "1" }]) {
          const activity = { state, tool: " t\nool ", model: "m  odel", since, context, ignored: true };
          expect(JSON.stringify(cleanActivity(activity))).toBe(JSON.stringify(base.cleanActivity(activity)));
        }
      }
    }
    expect(cleanActivity({ state: "unknown", tool: "hidden", model: "shown" })).toEqual({ state: "unknown", model: "shown" });
  });

  test("inline text retains its distinct character, whitespace and ellipsis policies", () => {
    const input = "a  b\u202ec";
    expect(inlineText(input)).toBe(base.inlineText(input));
    expect(inlineText(input)).toBe("a b c");
    expect(cleanCard({ model: input })?.model).toBe(input);
    expect(inlineText("abcdef", 4)).toBe("abc…");
    expect(cleanActivity({ state: "idle", tool: "x".repeat(61) })?.tool).toBe("x".repeat(60));
  });
});
