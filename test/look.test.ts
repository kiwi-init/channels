import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const web = resolve(import.meta.dir, "../web/src");
const css = readFileSync(resolve(web, "index.css"), "utf8");
const kit = readFileSync(resolve(web, "components/kit.tsx"), "utf8");

const contrast = css.slice(css.indexOf("@media (prefers-contrast: more)"));

const files = (d: string): string[] =>
  readdirSync(d).flatMap((n) => (statSync(resolve(d, n)).isDirectory() ? files(resolve(d, n)) : /\.(tsx?|css)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [resolve(d, n)] : []));

test("one face: Paper Mono, served with the app, for every word and every code block", () => {
  expect(css).toContain('src: url("./fonts/PaperMono.woff2")');
  expect(css).toMatch(/--font-sans: "Paper Mono", /);
  expect(css).toMatch(/--font-mono: "Paper Mono", /);
  const other = files(web).filter((f) => /Inter Variable|fontsource|-apple-system|system-ui|"SF Pro/.test(readFileSync(f, "utf8")));
  expect(other).toEqual([]);
});

test("no glass: nothing blurs what's behind it, and no prism, spectrum or gradient decoration is left", () => {
  const decorated = files(web).filter((f) => /backdrop-filter|backdrop-blur|\bglass\b|prism|spectrum|--band\b/.test(readFileSync(f, "utf8")));
  expect(decorated).toEqual([]);
});

test("what floats is afloat: opaque and outlined, a stronger edge under prefers-contrast: more", () => {
  expect(css).toMatch(/\.afloat \{\n\s+background: var\(--afloat-fill\);\n\s+box-shadow: inset 0 0 0 1px var\(--afloat-edge\);/);
  expect(contrast.length).toBeLessThan(css.length);
  expect(contrast).toContain(".afloat");
});

test("black and white: the accent is ink, links the landing's blue", () => {
  expect(css).toMatch(/--accent: var\(--ink\);/);
  expect(css).toMatch(/--link: light-dark\([^)]+, #8ab4ff\);/);
});

test("the kit is the quiet look: an ink primary, an outlined secondary, a wash segmented track, an accent checkbox", () => {
  expect(kit).toContain('primary: "bg-accent ');
  expect(kit).toContain('secondary: "text-ink shadow-[inset_0_0_0_1px_var(--edge-strong)]');
  expect(kit).toContain('SEGMENTED = "rounded-ctl bg-wash ');
  expect(kit).toContain('SEGMENT_ON = "bg-segment ');
  expect(kit).toContain('type="checkbox" className={cx("size-4 shrink-0 accent-[var(--accent)]"');
});

test("no checkbox outside the kit's: one place to style it", () => {
  const stray = files(web).filter((f) => !f.endsWith("kit.tsx") && readFileSync(f, "utf8").includes('type="checkbox"'));
  expect(stray).toEqual([]);
});
