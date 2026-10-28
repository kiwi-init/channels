import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STYLES = join(import.meta.dir, "../ui/src/styles");
const FIXED: Record<string, string> = {
  ".av-sm": "initials inside a fixed 20px avatar",
  ".av-lg": "initials inside a fixed avatar",
  ".cpanel-icon-tile": "an emoji inside a fixed icon tile",
  ".msg-time-hover": "the time in the message gutter, which keeps its width",
  ".needs-digit": "one verification digit inside a fixed 44 by 52 box",
  ".palette-tile": "initials inside a fixed palette tile",
  ".palette-kbd": "a key cap with a fixed size",
  ".tile": "initials inside a fixed rail tile",
  ".tile-badge": "a count inside a fixed rail badge",
  ".start-tile": "initials inside a fixed start tile",
  ".start-code": "the join code shown large, sized to its card",
};

const FIXED_SIZE = /font(?:-size)?:\s*(?:\d{3}\s+)?\d+(?:\.\d+)?px/;

function fixedSizes(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(STYLES).filter((f) => f.endsWith(".css"))) {
    let selector = "";
    readFileSync(join(STYLES, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (line.includes("{")) selector = line.replace("{", "").trim();
        if (FIXED_SIZE.test(line) && !selector.split(/,\s*/).some((s) => (s.split(/\s+/).at(-1) ?? "") in FIXED)) found.push(`${file}:${i + 1} ${selector}`);
      });
  }
  return found;
}

describe("Settings > Appearance > Text size", () => {
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
