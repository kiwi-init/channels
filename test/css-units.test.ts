import { describe, expect, test } from "bun:test";
import { breachesIn, check } from "../scripts/css-units.ts";

const lines = (css: string) => breachesIn(css, "x.css").map((b) => b.line);

describe("sizes that must follow Settings > Appearance > Text size", () => {
  test("type in px is refused, tokens and rem pass", () => {
    expect(lines(".a {\n  font-size: 13px;\n}")).toEqual([2]);
    expect(lines(".a {\n  font: 600 var(--t-ui) / 18px var(--ui);\n}")).toEqual([2]);
    expect(lines(".a {\n  line-height: 22px;\n}")).toEqual([2]);
    expect(lines(".a {\n  font: 600 var(--t-ui) / 1.4 var(--ui);\n  font-size: 0.8125rem;\n}")).toEqual([]);
  });

  test("a box with text and a px height is refused, one measured from tokens or rem passes", () => {
    expect(lines(".a {\n  height: 24px;\n  font: var(--t-ui) var(--ui);\n}")).toEqual([2]);
    expect(lines(".a {\n  min-height: 1.5rem;\n  font: var(--t-ui) var(--ui);\n}")).toEqual([]);
    expect(lines(".a {\n  height: calc(var(--ctl) - 4px);\n  font: var(--t-ui) var(--ui);\n}")).toEqual([]);
    expect(lines(".a {\n  height: 1px;\n  width: 24px;\n}")).toEqual([]);
    expect(lines(".a {\n  height: 24px;\n  font: inherit;\n}")).toEqual([]);
  });

  test("container breakpoints in px are refused", () => {
    expect(lines("@container top (max-width: 1120px) {\n  .a {\n    display: none;\n  }\n}")).toEqual([1]);
    expect(lines("@container top (max-width: 70rem) {\n  .a {\n    display: none;\n  }\n}")).toEqual([]);
  });

  test("the app's stylesheets pass", async () => {
    expect(await check(".")).toEqual([]);
  });
});
