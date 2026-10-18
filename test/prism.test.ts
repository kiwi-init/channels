import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const web = resolve(import.meta.dir, "../web/src");
const css = readFileSync(resolve(web, "index.css"), "utf8");
const kit = readFileSync(resolve(web, "components/kit.tsx"), "utf8");

const contrast = css.slice(css.indexOf("@media (prefers-contrast: more)"));

test("every prism and glass surface falls back to a solid fill under prefers-contrast: more", () => {
  expect(contrast.length).toBeLessThan(css.length);
  for (const cls of [".prism", ".prism-lit", ".glass", ".orb", ".orb-pill"]) expect(contrast).toContain(cls);
  for (const glint of [".prism::before", ".prism-lit::before", ".prism-lit::after"]) expect(contrast).toContain(glint);
});

test("the spectrum and the orb are tokens, written once in :root", () => {
  for (const token of ["--spectrum-1", "--spectrum-7", "--orb-core", "--orb-blue", "--orb-cyan", "--orb-glow", "--prism-glint", "--segment"]) {
    expect(css.match(new RegExp(`^\\s*${token}:`, "gm"))).toHaveLength(1);
  }
});

test("the kit is the quiet look: an accent primary, an outlined secondary, a wash segmented track, an accent checkbox", () => {
  expect(kit).toContain('primary: "bg-accent ');
  expect(kit).toContain('secondary: "text-ink shadow-[inset_0_0_0_1px_var(--edge-strong)]');
  expect(kit).toContain('SEGMENTED = "rounded-ctl bg-wash ');
  expect(kit).toContain('SEGMENT_ON = "bg-segment ');
  expect(kit).toContain('type="checkbox" className={cx("size-4 shrink-0 accent-[var(--accent)]"');
});

test("prism stays in the sidebar: the kit, the header, the side panels, Settings, Personalities and the conversation don't wear it", () => {
  const shell = [
    "components/kit.tsx",
    "components/conversation/header.tsx",
    "components/info-panel.tsx",
    "components/tasks-panel.tsx",
    "components/thread.tsx",
    "components/settings.tsx",
    "components/update-check.tsx",
    "components/personalities.tsx",
    "components/personality-picker.tsx",
    "components/composer.tsx",
    "components/composer-question.tsx",
    "components/message.tsx",
    "components/ask-options.tsx",
    "components/live-task-card.tsx",
    "components/needs-you.tsx",
    "components/gif-picker.tsx",
    "components/conversation/index.tsx",
  ];
  const wearing = shell.filter((f) => /\b(prism|prism-lit|orb|orb-pill)\b/.test(readFileSync(resolve(web, f), "utf8").replace(/--prism-[a-z-]+/g, "")));
  expect(wearing).toEqual([]);
  expect(css.slice(css.indexOf("@utility sheet"))).not.toContain("prism");
});

test("no checkbox outside the kit's: one place to style it", () => {
  const files = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(resolve(d, n)).isDirectory() ? files(resolve(d, n)) : n.endsWith(".tsx") ? [resolve(d, n)] : []));
  const stray = files(web).filter((f) => !f.endsWith("kit.tsx") && readFileSync(f, "utf8").includes('type="checkbox"'));
  expect(stray).toEqual([]);
});
