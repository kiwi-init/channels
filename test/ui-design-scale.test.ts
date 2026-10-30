import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STYLES = join(import.meta.dir, "../ui/src/styles");
const SPACING = new Set([0, 1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64]);
const SPACING_DECL = /(?:^|[;{\s])((?:padding|margin)(?:-[a-z-]+)?|(?:row-|column-)?gap)\s*:\s*([^;}]+)/g;
const RADIUS_DECL = /border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/g;
const RADIUS_PX = /(?<![\w.-])(\d+(?:\.\d+)?)px/g;
const ALLOWED_ROUND = new Set(["999"]);

function sheets(): [string, string][] {
  return readdirSync(STYLES)
    .filter((f) => f.endsWith(".css") && f !== "tokens.css")
    .map((f): [string, string] => [f, readFileSync(join(STYLES, f), "utf8")]);
}

function offScale(css: string): string[] {
  const found: string[] = [];
  for (const decl of css.matchAll(SPACING_DECL)) {
    for (const px of (decl[2] ?? "").matchAll(/(?<![\w.])-?(\d+(?:\.\d+)?)px/g)) {
      if (!SPACING.has(Number(px[1]))) found.push(`${decl[1]}: ${decl[2]}`);
    }
  }
  return found;
}

function rawRadii(css: string): string[] {
  const found: string[] = [];
  for (const decl of css.matchAll(RADIUS_DECL)) {
    for (const px of (decl[1] ?? "").matchAll(RADIUS_PX)) if (!ALLOWED_ROUND.has(px[1] ?? "")) found.push(`border-radius: ${decl[1]}`);
  }
  return found;
}

describe("ui styles keep to the design scale", () => {
  test("spacing sits on the scale in DESIGN.md", () => {
    const wrong = sheets().flatMap(([f, css]) => offScale(css).map((v) => `${f}: ${v}`));
    expect(wrong).toEqual([]);
  });

  test("radii come from the tokens", () => {
    const wrong = sheets().flatMap(([f, css]) => rawRadii(css).map((v) => `${f}: ${v}`));
    expect(wrong).toEqual([]);
  });

  test("the checks catch a stray value", () => {
    expect(offScale(".a { padding: 13px 8px; }")).toEqual(["padding: 13px 8px"]);
    expect(offScale(".a { gap: 8px; margin: -8px 0 var(--gutter); }")).toEqual([]);
    expect(rawRadii(".a { border-radius: 7px; }")).toEqual(["border-radius: 7px"]);
    expect(rawRadii(".a { border-radius: var(--r-row); }")).toEqual([]);
  });
});
