import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STYLES = join(import.meta.dir, "../ui/src/styles");
const FIXED: Record<string, string> = {
  ".av-sm": "initials inside a fixed 24px avatar",
  ".av-lg": "initials inside a fixed avatar",
  ".cpanel-icon-tile": "an emoji inside a fixed icon tile",
  ".msg-time-hover": "the time in the message gutter, which keeps its width",
  ".needs-digit": "one verification digit inside a fixed 44 by 52 box",
  ".palette-tile": "initials inside a fixed palette tile",
  ".palette-kbd": "a key cap with a fixed size",
  ".tile": "initials inside a fixed rail tile",
  ".tile-badge": "a count inside a fixed rail badge",
  ".start-tile": "initials inside a fixed start tile",
  ".start-code": "the join code, already shown at display size and fitted to its card",
};

const FONT = /(?:^|[;{\s])font(?:-size)?\s*:([^;}]*)/g;

const fixedFont = (value: string): boolean => /\d+(?:\.\d+)?px/.test(value.split("/")[0] ?? "") && !value.includes("var(--text-scale");

function violations(css: string): string[] {
  const found: string[] = [];
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (rule[1] ?? "").split(",").map((s) => s.trim());
    const exempt = selectors.every((s) => (s.split(/\s+/).at(-1) ?? "") in FIXED);
    for (const decl of (rule[2] ?? "").matchAll(FONT)) if (fixedFont(decl[1] ?? "") && !exempt) found.push(selectors.join(", "));
  }
  return found;
}

const fixedSizes = (): string[] =>
  readdirSync(STYLES)
    .filter((f) => f.endsWith(".css"))
    .flatMap((file) => violations(readFileSync(join(STYLES, file), "utf8")).map((rule) => `${file} ${rule}`));

describe("Settings > Appearance > Text size", () => {
  test("the guard catches a fixed size in a shared list, across lines, and in any font shorthand", () => {
    expect(violations(".reading, .tile { font-size: 14px; }\n.a,\n.tile {\n  font: italic 14px sans-serif;\n}\n.tile { font-size: 10px }")).toEqual([".reading, .tile", ".a, .tile"]);
  });

  test("every type step grows and shrinks with the chosen text size", () => {
    const tokens = readFileSync(join(STYLES, "tokens.css"), "utf8");
    const steps = [...tokens.matchAll(/^\s*(--t-[a-z]+):\s*([^;]+);/gm)];
    expect(steps.length).toBeGreaterThan(0);
    for (const [, name, value] of steps) expect(`${name}: ${value}`).toContain("var(--text-scale, 1)");
  });

  test("text people read has no fixed size outside the type steps", () => {
    expect(fixedSizes()).toEqual([]);
  });
});
