import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LANGS, alternatesHtml, landingHtml, landingWords, switcherHtml, wordsOf } from "../scripts/docs-site.ts";

const SITE = join(import.meta.dir, "..", "site");
const english = readFileSync(join(SITE, "index.html"), "utf8");
const lang = (dir: string) => LANGS.find((l) => l.dir === dir) ?? LANGS[0]!;
const translated = LANGS.filter((l) => l.dir);

describe("the site in five languages (#759)", () => {
  test("the English landing's language marks are up to date", () => {
    expect(landingHtml(english, lang(""))).toBe(english);
  });

  test("each language's landing says its language, links the English docs, and marks itself in the switcher", () => {
    const ja = landingHtml(english, lang("ja"));
    expect(ja).toContain('<html lang="ja">');
    expect(ja).toContain('<a class="nav" href="/docs/">ドキュメント</a>');
    expect(ja).toContain('<a class="brand" href="/ja/">');
    expect(ja).toContain('<summary aria-label="言語: 日本語" title="日本語"><span class="langs-name">日本語</span><span class="langs-code" aria-hidden="true">JA</span></summary>');
    expect(ja).toContain('<a href="/ja/" hreflang="ja" lang="ja" data-lang-pick="ja" aria-current="true">');
    expect(landingHtml(english, lang("zh-cn"))).toContain('<html lang="zh-CN">');
  });

  test.each(translated.map((l) => [l.dir, l] as const))("the %s landing has every English sentence translated", (_, l) => {
    const words = wordsOf(l);
    const source = landingWords(english);
    expect(source.length).toBeGreaterThan(10);
    for (const en of Object.keys(words)) expect(english.includes(`>${en}<`) || english.includes(`="${en}"`)).toBe(true);
    const left = landingWords(landingHtml(english, l)).filter((t) => source.includes(t));
    expect(left).toEqual([]);
  });

  test.each(translated.map((l) => [l.dir, l] as const))("the %s landing keeps every element, class and id of the English one", (_, l) => {
    const skeleton = (html: string) =>
      html
        .replace(/<!-- langs -->[\s\S]*?<!-- \/langs -->/, "")
        .replace(/>[^<]*</g, "><")
        .replace(/ (alt|title|aria-label|content|lang|href)="[^"]*"/g, "");
    expect(skeleton(landingHtml(english, l))).toBe(skeleton(english));
  });

  test("the landing lists all five languages and an x-default for search engines", () => {
    const links = alternatesHtml();
    for (const [dir, tag] of [
      ["", "en"],
      ["pt-br/", "pt-BR"],
      ["ja/", "ja"],
      ["ko/", "ko"],
      ["zh-cn/", "zh-CN"],
    ]) {
      expect(links).toContain(`hreflang="${tag}" href="https://channels.kiwiinit.com/${dir}"`);
    }
    expect(links).toContain('hreflang="x-default" href="https://channels.kiwiinit.com/"');
  });

  test("on a docs page the switcher keeps the page in English and says the docs are English for now", () => {
    const docs = switcherHtml(lang(""), "docs/cli");
    expect(docs).toContain('<a href="/docs/cli" hreflang="en" lang="en" data-lang-pick="en" aria-current="true">English</a>');
    expect(docs).toContain('<a href="/ja/" hreflang="ja" lang="ja" data-lang-pick="ja">日本語<span class="langs-note">ドキュメントは現在英語のみです</span></a>');
    expect(docs).toContain('<a href="/pt-br/" hreflang="pt-BR"');
    expect(docs).not.toContain("/ja/docs");
  });
});

describe("the first visit picks the browser's language (site/lang.js)", () => {
  const run = (pathname: string, languages: string[], stored: string | null = null, hash = "") => {
    const kept = new Map<string, string>(stored ? [["kiwi.site-lang", stored]] : []);
    let went: string | null = null;
    const context = {
      location: { pathname, search: "", hash, replace: (to: string) => (went = to) },
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
    expect(run("/", ["pt-BR"]).went).toBe("/pt-br/");
    expect(run("/", ["zh-CN"]).went).toBe("/zh-cn/");
    expect(run("/", ["zh-TW"]).went).toBeNull();
  });

  test("an invite in the landing's hash follows the visitor to their language", () => {
    expect(run("/", ["ko"], null, "#mc2-abc").went).toBe("/ko/#mc2-abc");
  });

  test("docs pages never redirect: they are English only for now", () => {
    expect(run("/docs/cli", ["pt-BR"]).went).toBeNull();
    expect(run("/docs/", ["ja"], "ja").went).toBeNull();
  });

  test("English first, a past pick of English, or a page outside the site's pages: no redirect", () => {
    expect(run("/", ["en-GB", "ja"]).went).toBeNull();
    expect(run("/", ["ja"], "en").went).toBeNull();
    expect(run("/join/abc", ["ja"]).went).toBeNull();
    expect(run("/ja/", ["pt-BR"]).went).toBeNull();
  });
});
