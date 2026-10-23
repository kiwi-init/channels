import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const web = resolve(import.meta.dir, "../web/src");
const css = readFileSync(resolve(web, "index.css"), "utf8");
const kit = readFileSync(resolve(web, "components/kit.tsx"), "utf8");

const contrast = css.slice(css.indexOf("@media (prefers-contrast: more)"));

const files = (d: string): string[] =>
  readdirSync(d).flatMap((n) => (statSync(resolve(d, n)).isDirectory() ? files(resolve(d, n)) : n.endsWith(".tsx") && !n.endsWith(".test.tsx") ? [resolve(d, n)] : []));

test("the lit prism and glass fall back to a solid fill under prefers-contrast: more", () => {
  expect(contrast.length).toBeLessThan(css.length);
  for (const sel of [".prism-lit", ".glass", ".prism-lit::before", ".prism-lit::after"]) expect(contrast).toContain(sel);
});

test("the spectrum is tokens, written once in :root, and the plain prism and the orb are gone", () => {
  for (const token of ["--spectrum-1", "--spectrum-7", "--prism-glint-lit", "--prism-fill-lit", "--segment"]) {
    expect(css.match(new RegExp(`^\\s*${token}:`, "gm"))).toHaveLength(1);
  }
  expect(css).not.toMatch(/\.(prism|orb|orb-pill)\b(?!-)/);
  expect(css).not.toContain("--orb-");
});

test("the kit is the quiet look: an accent primary, an outlined secondary, a wash segmented track, an accent checkbox", () => {
  expect(kit).toContain('primary: "bg-accent ');
  expect(kit).toContain('secondary: "text-ink shadow-[inset_0_0_0_1px_var(--edge-strong)]');
  expect(kit).toContain('SEGMENTED = "rounded-ctl bg-wash ');
  expect(kit).toContain('SEGMENT_ON = "bg-segment ');
  expect(kit).toContain('type="checkbox" className={cx("size-4 shrink-0 accent-[var(--accent)]"');
});

test("the prism means one thing: the open channel's tab or row and the sidebar's chosen view or conversation wear prism-lit, nothing else does", () => {
  const sidebar = ["components/sidebar.tsx", "components/conversation/channel-sidebar.tsx"].map((f) => resolve(web, f));
  const lit = files(web).filter((f) => readFileSync(f, "utf8").includes("prism-lit"));
  expect(lit.sort()).toEqual(sidebar.sort());
  const plain = files(web).filter((f) => /\b(prism|orb|orb-pill)\b(?!-)/.test(readFileSync(f, "utf8").replace(/--prism-[a-z-]+/g, "")));
  expect(plain).toEqual([]);
  expect(css.slice(css.indexOf("@utility sheet"))).not.toContain("prism");
});

test("no checkbox outside the kit's: one place to style it", () => {
  const stray = files(web).filter((f) => !f.endsWith("kit.tsx") && readFileSync(f, "utf8").includes('type="checkbox"'));
  expect(stray).toEqual([]);
});
