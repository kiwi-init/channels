import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(import.meta.dir, "../web/src/index.css"), "utf8");
const kit = readFileSync(resolve(import.meta.dir, "../web/src/components/kit.tsx"), "utf8");

const contrast = css.slice(css.indexOf("@media (prefers-contrast: more)"));

test("every prism surface falls back to a solid fill under prefers-contrast: more", () => {
  expect(contrast.length).toBeLessThan(css.length);
  for (const cls of [".prism", ".prism-lit", ".glass", ".orb", ".orb-pill"]) expect(contrast).toContain(cls);
  for (const glint of [".prism::before", ".prism-lit::before", ".prism-lit::after", ".glass::before"]) expect(contrast).toContain(glint);
});

test("the spectrum and the orb are tokens, written once in :root", () => {
  for (const token of ["--spectrum-1", "--spectrum-7", "--orb-core", "--orb-blue", "--orb-cyan", "--orb-glow", "--prism-glint"]) {
    expect(css.match(new RegExp(`^\\s*${token}:`, "gm"))).toHaveLength(1);
  }
});

test("the kit's buttons and segments wear the prism", () => {
  expect(kit).toContain('primary: "orb-pill');
  expect(kit).toContain('secondary: "prism ');
  expect(kit).toContain('SEGMENTED = "prism ');
  expect(kit).toContain('SEGMENT_ON = "prism-lit ');
});
