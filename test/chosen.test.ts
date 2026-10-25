import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const web = resolve(import.meta.dir, "../web/src");
const css = readFileSync(resolve(web, "index.css"), "utf8");
const kit = readFileSync(resolve(web, "components/kit.tsx"), "utf8");

const contrast = css.slice(css.indexOf("@media (prefers-contrast: more)"));

const files = (d: string): string[] =>
  readdirSync(d).flatMap((n) => (statSync(resolve(d, n)).isDirectory() ? files(resolve(d, n)) : n.endsWith(".tsx") && !n.endsWith(".test.tsx") ? [resolve(d, n)] : []));

test("glass falls back to a solid fill under prefers-contrast: more", () => {
  expect(contrast.length).toBeLessThan(css.length);
  expect(contrast).toContain(".glass");
});

test("the chosen and segment fills are tokens, written once in :root, and the prism, spectrum and orb are gone", () => {
  for (const token of ["--chosen", "--segment"]) expect(css.match(new RegExp(`^\\s*${token}:`, "gm"))).toHaveLength(1);
  expect(css).not.toMatch(/prism|spectrum/);
  expect(css).not.toMatch(/\.(orb|orb-pill)\b(?!-)/);
  expect(css).not.toContain("--orb-");
});

test("the kit is the quiet look: an accent primary, an outlined secondary, a wash segmented track, an accent checkbox", () => {
  expect(kit).toContain('primary: "bg-accent ');
  expect(kit).toContain('secondary: "text-ink shadow-[inset_0_0_0_1px_var(--edge-strong)]');
  expect(kit).toContain('SEGMENTED = "rounded-ctl bg-wash ');
  expect(kit).toContain('SEGMENT_ON = "bg-segment ');
  expect(kit).toContain('type="checkbox" className={cx("size-4 shrink-0 accent-[var(--accent)]"');
});

test("what's chosen in a list wears the one quiet fill: the open channel's row, the open conversation, the phone list's open channel, Settings' open section and the personality being edited, and nothing wears a prism", () => {
  const lists = ["components/shell-sidebar.tsx", "components/sidebar.tsx", "components/conversation/channel-sidebar.tsx", "components/settings.tsx", "components/personalities.tsx"].map((f) =>
    resolve(web, f),
  );
  const chosen = files(web).filter((f) => readFileSync(f, "utf8").includes("bg-(--chosen)"));
  expect(chosen.sort()).toEqual(lists.sort());
  const prism = files(web).filter((f) => /\b(prism|prism-lit|orb|orb-pill)\b/.test(readFileSync(f, "utf8")));
  expect(prism).toEqual([]);
});

test("no checkbox outside the kit's: one place to style it", () => {
  const stray = files(web).filter((f) => !f.endsWith("kit.tsx") && readFileSync(f, "utf8").includes('type="checkbox"'));
  expect(stray).toEqual([]);
});
