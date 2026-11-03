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

  test("a rule's own declarations count around nested blocks, and strings and comments don't", () => {
    expect(lines(".a {\n  font-size: 13px;\n  @media (width > 600px) {\n    color: red;\n  }\n  height: 24px;\n}")).toEqual([2, 6]);
    expect(lines(".a {\n  & .b {\n    line-height: 20px;\n  }\n  font: var(--t-ui) var(--ui);\n  min-height: 30px;\n}")).toEqual([3, 6]);
    expect(lines('.a {\n  content: "font-size: 9px; {";\n  /* height: 9px; font: 9px x; */\n  font: var(--t-ui) var(--ui);\n}')).toEqual([]);
  });

  test("container breakpoints in px are refused", () => {
    expect(lines("@container top (max-width: 1120px) {\n  .a {\n    display: none;\n  }\n}")).toEqual([1]);
    expect(lines("@container top (max-width: 70rem) {\n  .a {\n    display: none;\n  }\n}")).toEqual([]);
  });

  test("the root font size follows the chosen text size, and every type step is in rem", async () => {
    const tokens = await Bun.file("ui/src/styles/tokens.css").text();
    expect(tokens).toMatch(/:root \{\n  font-size: calc\(var\(--text-scale, 1\) \* 100%\);/);
    const steps = [...tokens.matchAll(/^\s*(--t-[a-z]+):\s*([^;]+);/gm)];
    expect(steps.length).toBe(6);
    for (const [, name, value] of steps) expect(`${name}: ${value}`).toMatch(/: \d*\.?\d+rem$/);
  });

  test("the app's stylesheets pass", async () => {
    expect(await check(".")).toEqual([]);
  });
});
