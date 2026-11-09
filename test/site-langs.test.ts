import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { LANGS, alternatesHtml, landingHtml, landingWords, switcherHtml, wordsOf, writeDocs } from "../scripts/docs-site.ts";

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

  test("a language with translated docs links its landing's Docs to them", () => {
    expect(landingHtml(english, lang("ja"), true)).toContain('<a class="nav" href="/ja/docs/">ドキュメント</a>');
    expect(landingHtml(english, lang("ja"), true)).not.toContain('href="/docs/"');
  });

  test("on a docs page with no translation the switcher keeps the page in English and says the docs are English for now", () => {
    const docs = switcherHtml(lang(""), "cli");
    expect(docs).toContain('<a href="/docs/cli" hreflang="en" lang="en" data-lang-pick="en" aria-current="true">English</a>');
    expect(docs).toContain('<a href="/ja/" hreflang="ja" lang="ja" data-lang-pick="ja">日本語<span class="langs-note">ドキュメントは現在英語のみです</span></a>');
    expect(docs).toContain('<a href="/pt-br/" hreflang="pt-BR"');
    expect(docs).not.toContain("/ja/docs");
  });
});

describe("the first visit picks the browser's language (site/lang.js)", () => {
  const run = (pathname: string, languages: string[], stored: string | null = null, hash = "") => {
    const kept = new Map<string, string>(stored ? [["kiwi.site-lang", stored]] : []);
    const seen: { went: string | null } = { went: null };
    const context = {
      location: { pathname, search: "", hash, replace: (to: string) => (seen.went = to) },
      navigator: { languages, language: languages[0] },
      localStorage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) },
      document: { addEventListener: () => {} },
      Element: class {},
    };
    new Function(...Object.keys(context), readFileSync(join(SITE, "lang.js"), "utf8"))(...Object.values(context));
    return { went: seen.went, kept: kept.get("kiwi.site-lang") ?? null };
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

  test("docs pages never redirect: the switcher links each translation", () => {
    expect(run("/docs/cli", ["pt-BR"]).went).toBeNull();
    expect(run("/docs/", ["ja"], "ja").went).toBeNull();
    expect(run("/ja/docs/cli", ["en"], "en").went).toBeNull();
  });

  test("English first, a past pick of English, or a page outside the site's pages: no redirect", () => {
    expect(run("/", ["en-GB", "ja"]).went).toBeNull();
    expect(run("/", ["ja"], "en").went).toBeNull();
    expect(run("/join/abc", ["ja"]).went).toBeNull();
    expect(run("/ja/", ["pt-BR"]).went).toBeNull();
  });
});

describe("translated docs pages (#759, step 5)", () => {
  let root = "";
  const page = (front: string, body: string) => `---\n${front}\n---\n\n${body}\n`;
  const put = (docs: string, files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(docs, file)), { recursive: true });
      writeFileSync(join(docs, file), text);
    }
  };
  const english = {
    "index.md": page("description: The first page.\ngroup: Start\norder: 0", "# Play demo\n\nHello."),
    "start.md": page("description: Get going.\ngroup: Start\norder: 10", "# Get started\n\n## Try it first\n\nGo."),
    "cli.md": page(
      "description: Every command.\ngroup: Reference\norder: 50",
      "# CLI reference\n\n## Install the CLI\n\n### On a Mac\n\n```sh\nkiwi up\n```\n\n## Every command\n\nSee [start](start.md#try-it-first), [the demo](index.md), [start again](/docs/start), [home](/), [this](#every-command), [security](../SECURITY.md) and [deploy](../deploy).\n\n![The CLI](shots/cli.png)\n\n- [x] done",
    ),
    "shots/cli.png": "png",
    "plans/idea.md": page("description: Not a page.", "# An idea"),
  };
  const ja = {
    "ja/index.md": page("description: 最初のページ。\ngroup: はじめに\norder: 0", "# デモを試す\n\nこんにちは。"),
    "ja/cli.md": page(
      "description: すべてのコマンド。\ngroup: リファレンス\norder: 50",
      "# CLI リファレンス\n\n## CLI をインストール\n\n### Mac の場合\n\n```sh\nkiwi up\n```\n\n## すべてのコマンド\n\n[はじめる](start.md#try-it-first)、[デモ](index.md)、[もう一度](/docs/start)、[ホーム](/)、[ここ](#every-command)、[セキュリティ](../SECURITY.md)、[デプロイ](../deploy)。\n\n![CLI](shots/cli.png)\n\n- [x] 完了",
    ),
  };
  const build = async (name: string, files: Record<string, string>) => {
    const docs = join(root, name, "docs");
    const site = join(root, name, "site");
    put(docs, files);
    mkdirSync(join(docs, "pt-br"), { recursive: true });
    await writeDocs(docs, site);
    return (path: string) => readFileSync(join(site, path), "utf8");
  };
  let read: (path: string) => string = () => "";

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "docs-langs-"));
    read = await build("ok", { ...english, ...ja });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("each translated page is written under its language, and only those", () => {
    expect(existsSync(join(root, "ok/site/ja/docs/cli.html"))).toBe(true);
    expect(existsSync(join(root, "ok/site/ja/docs/index.html"))).toBe(true);
    expect(existsSync(join(root, "ok/site/ja/docs/start.html"))).toBe(false);
    expect(existsSync(join(root, "ok/site/docs/idea.html"))).toBe(false);
    expect(existsSync(join(root, "ok/site/docs/ja.html"))).toBe(false);
  });

  test("a language with no translated files builds no docs", () => {
    expect(existsSync(join(root, "ok/site/pt-br/docs"))).toBe(false);
    expect(existsSync(join(root, "ok/site/ko/docs"))).toBe(false);
  });

  test("links go to the translation when it exists, to the English page when not, home to the language's landing, and relative links and images where the English page's go", () => {
    const cli = read("ja/docs/cli.html");
    expect(cli).toContain('<a href="/docs/start#try-it-first">はじめる</a>');
    expect(cli).toContain('<a href="/ja/docs/">デモ</a>');
    expect(cli).toContain('<a href="/docs/start">もう一度</a>');
    expect(cli).toContain('<a href="/ja/">ホーム</a>');
    expect(cli).toContain('<a href="#every-command">ここ</a>');
    expect(cli).toContain('<a href="https://github.com/kiwi-init/channels/blob/main/SECURITY.md">セキュリティ</a>');
    expect(cli).toContain('<a href="https://github.com/kiwi-init/channels/tree/main/deploy">デプロイ</a>');
    expect(cli).toContain('<img src="/docs/shots/cli.png" alt="CLI" loading="lazy" />');
    expect(readFileSync(join(root, "ok/site/docs/shots/cli.png"), "utf8")).toBe("png");
    const en = read("docs/cli.html");
    expect(en).toContain('<a href="/docs/start#try-it-first">start</a>');
    expect(en).toContain('<a href="/docs/">the demo</a>');
    expect(en).toContain('<a href="/">home</a>');
    expect(en).toContain('<a href="https://github.com/kiwi-init/channels/blob/main/SECURITY.md">security</a>');
    expect(en).toContain('<a href="https://github.com/kiwi-init/channels/tree/main/deploy">deploy</a>');
    expect(en).toContain('<img src="/docs/shots/cli.png" alt="The CLI" loading="lazy" />');
  });

  test("a translated heading takes the id of the English heading in its place", () => {
    const ids = (html: string) => [...html.matchAll(/<h[2-6] id="([^"]*)"/g)].map((m) => m[1]);
    expect(ids(read("ja/docs/cli.html"))).toEqual(["install-the-cli", "on-a-mac", "every-command"]);
    expect(ids(read("ja/docs/cli.html"))).toEqual(ids(read("docs/cli.html")));
  });

  test("the chrome speaks the page's language", () => {
    const cli = read("ja/docs/cli.html");
    expect(cli).toContain('<html lang="ja">');
    expect(cli).toContain("<title>CLI リファレンス · Channels ドキュメント</title>");
    expect(cli).toContain('<a class="brand" href="/ja/">');
    expect(cli).toContain('<a class="section" href="/ja/docs/">ドキュメント</a>');
    expect(cli).toContain('<a class="quiet download" href="/ja/">ダウンロード</a>');
    expect(cli).toContain('<a href="https://github.com/kiwi-init/channels/blob/main/docs/ja/cli.md">このページを編集</a>');
    expect(cli).toContain('<a class="prev" rel="prev" href="/ja/docs/"><span>前へ</span>デモを試す</a>');
    expect(cli).toContain('<p class="group-name">リファレンス</p>');
    expect(cli).toContain('data-copied="コピーしました"');
    expect(cli).toContain(">コピー</button>");
    expect(cli).toContain('aria-label="完了"');
    expect(cli).not.toContain('href="/ja/docs/start"');
    expect(cli).not.toMatch(/>(Docs|Download|Previous|Next|Edit this page|copy)</);
  });

  test("the switcher and hreflang name only the languages the page exists in", () => {
    const cli = read("ja/docs/cli.html");
    expect(cli).toContain('<a href="/docs/cli" hreflang="en" lang="en" data-lang-pick="en">English</a>');
    expect(cli).toContain('<a href="/ja/docs/cli" hreflang="ja" lang="ja" data-lang-pick="ja" aria-current="true">日本語</a>');
    expect(cli).toContain('<a href="/ko/" hreflang="ko" lang="ko" data-lang-pick="ko">한국어<span class="langs-note">');
    const links = [...cli.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(links).toEqual(["en https://channels.kiwiinit.com/docs/cli", "ja https://channels.kiwiinit.com/ja/docs/cli", "x-default https://channels.kiwiinit.com/docs/cli"]);
    expect(read("docs/cli.html")).toContain('<link rel="alternate" hreflang="ja" href="https://channels.kiwiinit.com/ja/docs/cli" />');
    expect(read("docs/cli.html")).toContain('<a href="/ja/docs/cli" hreflang="ja"');
    const start = read("docs/start.html");
    expect(start).not.toContain('rel="alternate"');
    expect(start).toContain('<a href="/ja/" hreflang="ja" lang="ja" data-lang-pick="ja">日本語<span class="langs-note">');
  });

  test("a translation whose headings differ from the English outline fails the build", async () => {
    const short = { "ja/cli.md": ja["ja/cli.md"].replace("### Mac の場合\n\n", "") };
    await expect(build("short", { ...english, ...short })).rejects.toThrow(
      'docs/ja/cli.md must keep the headings of docs/cli.md in the same order and depth (4 headings, 3 here): heading 3 is "## すべてのコマンド" where the English page has "### On a Mac"',
    );
    const deeper = { "ja/cli.md": ja["ja/cli.md"].replace("### Mac の場合", "#### Mac の場合") };
    await expect(build("deeper", { ...english, ...deeper })).rejects.toThrow('heading 3 is "#### Mac の場合"');
  });

  test("a translation with no English page, or a group named two ways, fails the build", async () => {
    await expect(build("orphan", { ...english, "ja/extra.md": page("description: x", "# x") })).rejects.toThrow("docs/ja/extra.md has no English page");
    const twice = { ...ja, "ja/start.md": page("description: 始める。\ngroup: スタート\norder: 10", "# はじめる\n\n## まず試す") };
    await expect(build("twice", { ...english, ...twice })).rejects.toThrow('translates the group "Start" as "スタート", but docs/ja/index.md translates it as "はじめに"');
  });
});
