import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LANGS, alternatesHtml, landingHtml, switcherHtml } from "../scripts/docs-site.ts";

const SITE = join(import.meta.dir, "..", "site");
const english = readFileSync(join(SITE, "index.html"), "utf8");
const lang = (dir: string) => LANGS.find((l) => l.dir === dir) ?? LANGS[0]!;

describe("the site in five languages (#759)", () => {
  test("the English landing's language marks are up to date", () => {
    expect(landingHtml(english, lang(""))).toBe(english);
  });

  test("each language's landing says its language, links its own docs, and marks itself in the switcher", () => {
    const ja = landingHtml(english, lang("ja"));
    expect(ja).toContain('<html lang="ja">');
    expect(ja).toContain('href="/ja/docs/"');
    expect(ja).not.toContain('class="nav" href="/docs/"');
    expect(ja).toContain('<summary aria-label="Language">日本語</summary>');
    expect(ja).toContain('<a href="/ja/" hreflang="ja" lang="ja" data-lang-pick="ja" aria-current="true">');
    expect(landingHtml(english, lang("zh-cn"))).toContain('<html lang="zh-CN">');
  });

  test("every page lists all five languages and an x-default for search engines", () => {
    const links = alternatesHtml("docs/cli");
    for (const [dir, tag] of [["", "en"], ["pt-br/", "pt-BR"], ["ja/", "ja"], ["ko/", "ko"], ["zh-cn/", "zh-CN"]]) {
      expect(links).toContain(`hreflang="${tag}" href="https://channels.kiwiinit.com/${dir}docs/cli"`);
    }
    expect(links).toContain('hreflang="x-default" href="https://channels.kiwiinit.com/docs/cli"');
    expect(switcherHtml("docs/cli", lang("ko"))).toContain('<a href="/pt-br/docs/cli" hreflang="pt-BR"');
  });
});

describe("the first visit picks the browser's language (site/lang.js)", () => {
  const run = (pathname: string, languages: string[], stored: string | null = null) => {
    const kept = new Map<string, string>(stored ? [["kiwi.site-lang", stored]] : []);
    let went: string | null = null;
    const context = {
      location: { pathname, search: "", hash: "", replace: (to: string) => (went = to) },
      navigator: { languages, language: languages[0] },
      localStorage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) },
      document: { addEventListener: () => {} },
      Element: class {},
    };
    new Function(...Object.keys(context), readFileSync(join(SITE, "lang.js"), "utf8"))(...Object.values(context));
    return { went, kept: kept.get("kiwi.site-lang") ?? null };
  };

  test("a Japanese browser on the English landing goes to /ja/, and the pick is kept", () => {
    expect(run("/", ["ja-JP", "en-US"])).toEqual({ went: "/ja/", kept: "ja" });
  });

  test("Brazilian and mainland Chinese browsers land on their pages; Traditional Chinese stays in English", () => {
    expect(run("/docs/cli", ["pt-BR"]).went).toBe("/pt-br/docs/cli");
    expect(run("/", ["zh-CN"]).went).toBe("/zh-cn/");
    expect(run("/", ["zh-TW"]).went).toBeNull();
  });

  test("English first, a past pick of English, or a page outside the site's pages: no redirect", () => {
    expect(run("/", ["en-GB", "ja"]).went).toBeNull();
    expect(run("/", ["ja"], "en").went).toBeNull();
    expect(run("/join/abc", ["ja"]).went).toBeNull();
    expect(run("/ja/", ["pt-BR"]).went).toBeNull();
  });
});
