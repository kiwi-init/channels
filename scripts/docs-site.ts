import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, posix, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

const ROOT = resolve(import.meta.dir, "..");
const DOCS = join(ROOT, "docs");
const SITE = join(ROOT, "site");
const OUT = join(SITE, "docs");
const UI = join(ROOT, "ui");
const DEMO = join(SITE, "demo");
const SCENE = join(SITE, "afk", "scene.html");
const REPO = "https://github.com/kiwi-init/channels";
const ORIGIN = "https://channels.kiwiinit.com";

const I18N = join(SITE, "i18n");
const PRODUCT_NAMES = new Set(["Channels", "Kiwi"]);

interface Chrome {
  docs: string;
  title: string;
  download: string;
  source: string;
  edit: string;
  previous: string;
  next: string;
  pages: string;
  copy: string;
  copyLabel: string;
  copied: string;
  copyFailed: string;
  theme: string;
  system: string;
  light: string;
  dark: string;
  done: string;
  todo: string;
  demo: string;
  noDemo: string;
}

interface Lang {
  dir: string;
  tag: string;
  name: string;
  code: string;
  label: string;
  docsNote: string;
  chrome: Chrome;
}

export const LANGS: readonly Lang[] = [
  {
    dir: "",
    tag: "en",
    name: "English",
    code: "EN",
    label: "Language",
    docsNote: "",
    chrome: {
      docs: "Docs",
      title: "Channels docs",
      download: "Download",
      source: "Source on GitHub",
      edit: "Edit this page",
      previous: "Previous",
      next: "Next",
      pages: "Pages",
      copy: "copy",
      copyLabel: "Copy",
      copied: "copied",
      copyFailed: "can't copy",
      theme: "Theme",
      system: "Match the system",
      light: "Light",
      dark: "Dark",
      done: "done",
      todo: "to do",
      demo: "The Channels app in demo mode",
      noDemo: "This copy of the docs was built without the app: play the demo on channels.kiwiinit.com.",
    },
  },
  {
    dir: "pt-br",
    tag: "pt-BR",
    name: "Português (Brasil)",
    code: "PT",
    label: "Idioma",
    docsNote: "Documentação só em inglês por enquanto",
    chrome: {
      docs: "Documentação",
      title: "Documentação do Channels",
      download: "Baixar",
      source: "Código no GitHub",
      edit: "Editar esta página",
      previous: "Anterior",
      next: "Próxima",
      pages: "Páginas",
      copy: "copiar",
      copyLabel: "Copiar",
      copied: "copiado",
      copyFailed: "não deu para copiar",
      theme: "Tema",
      system: "Seguir o sistema",
      light: "Claro",
      dark: "Escuro",
      done: "feito",
      todo: "a fazer",
      demo: "O app Channels em modo demo",
      noDemo: "Esta cópia da documentação foi gerada sem o app: veja a demo em channels.kiwiinit.com.",
    },
  },
  {
    dir: "ja",
    tag: "ja",
    name: "日本語",
    code: "JA",
    label: "言語",
    docsNote: "ドキュメントは現在英語のみです",
    chrome: {
      docs: "ドキュメント",
      title: "Channels ドキュメント",
      download: "ダウンロード",
      source: "GitHub のソースコード",
      edit: "このページを編集",
      previous: "前へ",
      next: "次へ",
      pages: "ページ",
      copy: "コピー",
      copyLabel: "コピー",
      copied: "コピーしました",
      copyFailed: "コピーできません",
      theme: "テーマ",
      system: "システムに合わせる",
      light: "ライト",
      dark: "ダーク",
      done: "完了",
      todo: "未完了",
      demo: "デモモードの Channels アプリ",
      noDemo: "このドキュメントはアプリなしでビルドされています。デモは channels.kiwiinit.com で試せます。",
    },
  },
  {
    dir: "ko",
    tag: "ko",
    name: "한국어",
    code: "KO",
    label: "언어",
    docsNote: "문서는 현재 영어로만 제공됩니다",
    chrome: {
      docs: "문서",
      title: "Channels 문서",
      download: "다운로드",
      source: "GitHub 소스 코드",
      edit: "이 페이지 편집",
      previous: "이전",
      next: "다음",
      pages: "페이지",
      copy: "복사",
      copyLabel: "복사",
      copied: "복사됨",
      copyFailed: "복사할 수 없음",
      theme: "테마",
      system: "시스템 설정 따르기",
      light: "라이트",
      dark: "다크",
      done: "완료",
      todo: "할 일",
      demo: "데모 모드의 Channels 앱",
      noDemo: "이 문서는 앱 없이 빌드되었습니다. 데모는 channels.kiwiinit.com에서 체험하세요.",
    },
  },
  {
    dir: "zh-cn",
    tag: "zh-CN",
    name: "简体中文",
    code: "ZH",
    label: "语言",
    docsNote: "文档暂时只有英文版",
    chrome: {
      docs: "文档",
      title: "Channels 文档",
      download: "下载",
      source: "GitHub 上的源代码",
      edit: "编辑此页",
      previous: "上一页",
      next: "下一页",
      pages: "页面",
      copy: "复制",
      copyLabel: "复制",
      copied: "已复制",
      copyFailed: "无法复制",
      theme: "主题",
      system: "跟随系统",
      light: "浅色",
      dark: "深色",
      done: "已完成",
      todo: "待办",
      demo: "演示模式下的 Channels 应用",
      noDemo: "这份文档构建时没有包含应用，请在 channels.kiwiinit.com 体验演示。",
    },
  },
];
const ENGLISH = LANGS[0] as Lang;

const home = (lang: Lang): string => (lang.dir ? `/${lang.dir}/` : "/");

type Node = {
  type: string;
  value?: string;
  depth?: number;
  url?: string;
  alt?: string;
  lang?: string | null;
  ordered?: boolean;
  start?: number | null;
  checked?: boolean | null;
  align?: (string | null)[];
  children?: Node[];
};

interface Page {
  slug: string;
  file: string;
  title: string;
  description: string;
  group: string;
  order: number;
  tree: Node;
  outline: Node[];
  ids: Map<Node, string>;
}

interface DocSet {
  lang: Lang;
  pages: Page[];
}

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const plain = (node: Node): string => (node.type === "text" || node.type === "inlineCode" ? (node.value ?? "") : (node.children ?? []).map(plain).join(""));

const slugOf = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

const headingsOf = (node: Node): Node[] => (node.type === "heading" ? [node] : (node.children ?? []).flatMap(headingsOf));

function frontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { meta, body: raw.slice(match[0].length) };
}

function checkOutline(shown: string, outline: Node[], en: Page): void {
  const mark = (h: Node | undefined) => (h ? `${"#".repeat(h.depth ?? 1)} ${plain(h)}` : "nothing");
  for (let i = 0; i < Math.max(outline.length, en.outline.length); i++) {
    if (outline[i]?.depth === en.outline[i]?.depth) continue;
    throw new Error(
      `${shown} must keep the headings of docs/${en.file} in the same order and depth (${en.outline.length} headings, ${outline.length} here): heading ${i + 1} is "${mark(outline[i])}" where the English page has "${mark(en.outline[i])}"`,
    );
  }
}

function readPages(docs = DOCS, lang: Lang = ENGLISH, english: Page[] = []): Page[] {
  const dir = join(docs, lang.dir);
  if (!existsSync(dir)) return [];
  const groups = new Map<string, { name: string; file: string }>();
  const pages = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file): Page => {
      const shown = posix.join("docs", lang.dir, file);
      const { meta, body } = frontMatter(readFileSync(join(dir, file), "utf8"));
      const tree = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as Node;
      const h1 = (tree.children ?? []).find((n) => n.type === "heading" && n.depth === 1);
      if (!h1) throw new Error(`${shown} has no # title`);
      if (!meta.description) throw new Error(`${shown} has no description in its front matter`);
      const outline = headingsOf(tree);
      const page = { slug: file === "index.md" ? "" : basename(file, ".md"), file, title: plain(h1), description: meta.description, tree, outline };
      if (!lang.dir) return { ...page, group: meta.group ?? "", order: Number(meta.order ?? 99), ids: new Map(outline.map((h) => [h, slugOf(plain(h))])) };
      const en = english.find((p) => p.file === file);
      if (!en) throw new Error(`${shown} has no English page: a translation keeps the file name of its docs/*.md`);
      checkOutline(shown, outline, en);
      const group = meta.group ?? en.group;
      const named = groups.get(en.group);
      if (named && named.name !== group)
        throw new Error(`${shown} translates the group "${en.group}" as "${group}", but docs/${lang.dir}/${named.file} translates it as "${named.name}": one group, one name per language`);
      groups.set(en.group, { name: group, file });
      return { ...page, group, order: Number(meta.order ?? en.order), ids: new Map(outline.map((h, i) => [h, en.ids.get(en.outline[i] ?? h) ?? slugOf(plain(h))])) };
    });
  return pages.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

const hrefOf = (slug: string, lang: Lang = ENGLISH): string => `${lang.dir ? `/${lang.dir}` : ""}/docs/${slug}`;

const DOCS_PATH = /^\/docs\/([^/]*)$/;

function docsSlug(path: string): string | undefined {
  if (!path.includes("/") && path.endsWith(".md")) return path === "index.md" ? "" : path.slice(0, -3);
  return DOCS_PATH.exec(path)?.[1];
}

function linkOf(url: string, r: Pick<Render, "lang" | "slugs" | "english">): string {
  if (/^[a-z]+:|^#/i.test(url)) return url;
  const [path, hash = ""] = url.split("#");
  const tail = hash ? `#${hash}` : "";
  if (!path) return tail;
  const slug = docsSlug(path);
  if (slug !== undefined && r.slugs.has(slug)) return hrefOf(slug, r.lang) + tail;
  if (slug !== undefined && r.english.has(slug)) return hrefOf(slug) + tail;
  if (path === "/") return home(r.lang) + tail;
  if (path.startsWith("/")) return url;
  const target = posix.normalize(posix.join("docs", path));
  const kind = existsSync(join(ROOT, target)) && statSync(join(ROOT, target)).isDirectory() ? "tree" : "blob";
  return `${REPO}/${kind}/main/${target}${tail}`;
}

interface Render {
  lang: Lang;
  slugs: Set<string>;
  english: Set<string>;
  ids: Map<Node, string>;
  figures: Set<string>;
  images: Set<string>;
}

const FIGURE = /^<!--\s*figure:\s*([a-z0-9-]+)\s*-->$/;
const DEMO_MARK = /^<!--\s*demo\s*-->$/;

function buildDemo(): boolean {
  if (!existsSync(join(UI, "vite.config.ts"))) return false;
  const run = Bun.spawnSync(["bunx", "vite", "build", "--base", "/demo/", "--outDir", DEMO, "--emptyOutDir", "--logLevel", "error"], {
    cwd: UI,
    env: { ...process.env, VITE_KIWI_DEMO: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (run.exitCode !== 0) throw new Error(`the demo's build of ui/ failed:\n${run.stderr.toString()}${run.stdout.toString()}`);
  rmSync(join(DEMO, "_headers"), { force: true });
  return true;
}

async function buildScene(): Promise<string> {
  const built = await Bun.build({ entrypoints: [join(UI, "src/meadow/scene.page.ts")], minify: true, target: "browser" });
  if (!built.success) throw new Error(`the meadow scene's build failed:\n${built.logs.join("\n")}`);
  const [entry, ...rest] = built.outputs;
  if (!entry || rest.length) throw new Error(`the meadow scene must build to one script, not ${built.outputs.length} files`);
  const script = (await entry.text()).replace(/<\/(script)/gi, "<\\/$1");
  mkdirSync(dirname(SCENE), { recursive: true });
  writeFileSync(
    SCENE,
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}#box{position:fixed;inset:0}</style></head><body><div id="box"></div><script type="module">${script}</script></body></html>\n`,
  );
  return relative(ROOT, SCENE);
}

const demoHtml = (c: Chrome): string =>
  existsSync(join(DEMO, "index.html"))
    ? `<div class="demo"><iframe class="demo-app" title="${escape(c.demo)}"></iframe></div>\n`
    : `<p>${escape(c.noDemo).replace("channels.kiwiinit.com", `<a href="${ORIGIN}/docs/">channels.kiwiinit.com</a>`)}</p>\n`;

type Figure = { svg: string; css: string; live: boolean };

const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g;

async function figureOf(name: string): Promise<Figure> {
  const dir = join(SITE, "figures", name);
  const build = join(dir, "build.js");
  if (!existsSync(build)) throw new Error(`no figure ${name}: site/figures/${name}/build.js is missing`);
  const mod = (await import(`${pathToFileURL(build).href}?at=${Date.now()}`)) as { default: () => string | Promise<string> };
  const raw = await mod.default();
  const css = [...raw.matchAll(STYLE_BLOCK)].map((m) => (m[1] ?? "").trim()).join("\n");
  const svg = raw.replace(STYLE_BLOCK, "");
  if (/\sstyle="/.test(svg)) throw new Error(`the ${name} figure has a style attribute, which the site's CSP blocks: use an SVG attribute (opacity="0", display="none") instead`);
  const liveFile = join(dir, "live.js");
  const live = existsSync(liveFile);
  if (live && /["']style["']/.test(readFileSync(liveFile, "utf8")))
    throw new Error(`site/figures/${name}/live.js writes a style attribute, which the site's CSP blocks: set el.style.x or an SVG attribute instead`);
  return { svg, css, live };
}

const DRAFT = process.argv.includes("--draft") || process.argv.includes("--serve");

async function figureHtml(name: string): Promise<string> {
  if (DRAFT && !existsSync(join(SITE, "figures", name, "build.js"))) return `<figure class="fig is-missing" data-figure="${name}"></figure>`;
  const { svg, live } = await figureOf(name);
  return `<figure class="fig iso" data-figure="${name}"${live ? " data-live" : ""}>${svg}</figure>`;
}

async function writeFigures(): Promise<string[]> {
  const css: string[] = [];
  for (const name of readdirSync(join(SITE, "figures")).sort()) {
    if (!existsSync(join(SITE, "figures", name, "build.js"))) continue;
    const figure = await figureOf(name);
    if (figure.css) css.push(figure.css);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "figures.css"), css.join("\n") + "\n");
  return [relative(ROOT, join(OUT, "figures.css"))];
}

async function render(node: Node, r: Render): Promise<string> {
  const kids = async (n: Node = node): Promise<string> => (await Promise.all((n.children ?? []).map((c) => render(c, r)))).join("");
  switch (node.type) {
    case "root":
      return kids();
    case "heading": {
      if (node.depth === 1) return `<h1>${await kids()}</h1>\n`;
      const id = r.ids.get(node) ?? slugOf(plain(node));
      return `<h${node.depth} id="${id}"><a class="anchor" href="#${id}">${await kids()}</a></h${node.depth}>\n`;
    }
    case "paragraph":
      return `<p>${await kids()}</p>\n`;
    case "text":
      return escape(node.value ?? "");
    case "emphasis":
      return `<em>${await kids()}</em>`;
    case "strong":
      return `<strong>${await kids()}</strong>`;
    case "delete":
      return `<del>${await kids()}</del>`;
    case "inlineCode":
      return `<code>${escape(node.value ?? "")}</code>`;
    case "break":
      return "<br />";
    case "thematicBreak":
      return "<hr />\n";
    case "blockquote":
      return `<blockquote>${await kids()}</blockquote>\n`;
    case "link": {
      const href = linkOf(node.url ?? "", r);
      const out = /^https?:/.test(href) && !href.startsWith(REPO + "/") ? ' rel="noopener"' : "";
      return `<a href="${escape(href)}"${out}>${await kids()}</a>`;
    }
    case "image": {
      const src = node.url ?? "";
      if (/^[a-z]+:/i.test(src)) return `<img src="${escape(src)}" alt="${escape(node.alt ?? "")}" loading="lazy" />`;
      r.images.add(src);
      return `<img src="/docs/${escape(src)}" alt="${escape(node.alt ?? "")}" loading="lazy" />`;
    }
    case "code": {
      const lang = node.lang ? ` data-lang="${escape(node.lang)}"` : "";
      return `<div class="code"${lang}><pre><code>${escape(node.value ?? "")}</code></pre><button class="copy" type="button" aria-label="${escape(r.lang.chrome.copyLabel)}" data-copied="${escape(r.lang.chrome.copied)}" data-failed="${escape(r.lang.chrome.copyFailed)}">${escape(r.lang.chrome.copy)}</button></div>\n`;
    }
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      const start = node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : "";
      const tasks = (node.children ?? []).some((c) => typeof c.checked === "boolean") ? ' class="tasks"' : "";
      return `<${tag}${start}${tasks}>${await kids()}</${tag}>\n`;
    }
    case "listItem": {
      const box = typeof node.checked === "boolean" ? `<span class="box" data-checked="${node.checked}" aria-label="${escape(node.checked ? r.lang.chrome.done : r.lang.chrome.todo)}"></span>` : "";
      const children = node.children ?? [];
      const only = children.length === 1 ? children[0] : undefined;
      const inner = only?.type === "paragraph" ? await kids(only) : await kids();
      return `<li>${box}${inner}</li>`;
    }
    case "table": {
      const rows = node.children ?? [];
      const align = node.align ?? [];
      const row = async (n: Node, cell: string) =>
        `<tr>${(await Promise.all((n.children ?? []).map(async (c, i) => `<${cell}${align[i] ? ` style="text-align:${align[i]}"` : ""}>${await kids(c)}</${cell}>`))).join("")}</tr>`;
      const head = rows[0] ? await row(rows[0], "th") : "";
      const body = (await Promise.all(rows.slice(1).map((n) => row(n, "td")))).join("");
      return `<div class="table"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>\n`;
    }
    case "html": {
      if (DEMO_MARK.test((node.value ?? "").trim())) return demoHtml(r.lang.chrome);
      const fig = FIGURE.exec((node.value ?? "").trim());
      const name = fig?.[1];
      if (name) {
        r.figures.add(name);
        return (await figureHtml(name)) + "\n";
      }
      return node.value ?? "";
    }
    default:
      return kids();
  }
}

const GITHUB_ICON =
  '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path></svg>';

function navHtml(set: DocSet, here: Page): string {
  const groups: { name: string; pages: Page[] }[] = [];
  for (const p of set.pages) {
    const last = groups[groups.length - 1];
    if (last && last.name === p.group) last.pages.push(p);
    else groups.push({ name: p.group, pages: [p] });
  }
  return groups
    .map(
      (g) =>
        `<div class="group">${g.name ? `<p class="group-name">${escape(g.name)}</p>` : ""}<ul>${g.pages
          .map((p) => `<li><a href="${hrefOf(p.slug, set.lang)}"${p === here ? ' aria-current="page"' : ""}>${escape(p.title)}</a></li>`)
          .join("")}</ul></div>`,
    )
    .join("");
}

function pagerHtml(set: DocSet, at: number): string {
  const c = set.lang.chrome;
  const prev = set.pages[at - 1];
  const next = set.pages[at + 1];
  const link = (p: Page | undefined, rel: string, label: string) =>
    p ? `<a class="${rel}" rel="${rel}" href="${hrefOf(p.slug, set.lang)}"><span>${escape(label)}</span>${escape(p.title)}</a>` : "<span></span>";
  return `<nav class="pager" aria-label="${escape(c.pages)}">${link(prev, "prev", c.previous)}${link(next, "next", c.next)}</nav>`;
}

const themePick = (c: Chrome): string =>
  `<div class="theme" role="group" aria-label="${escape(c.theme)}"><button type="button" data-theme-pick="system" aria-label="${escape(c.system)}" title="${escape(c.system)}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.5"></rect><path d="M5.5 14h5M8 11.25V14"></path></svg></button><button type="button" data-theme-pick="light" aria-label="${escape(c.light)}" title="${escape(c.light)}"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.75"></circle><path d="M8 1.25v1.5M8 13.25v1.5M1.25 8h1.5M13.25 8h1.5M3.23 3.23l1.06 1.06M11.71 11.71l1.06 1.06M3.23 12.77l1.06-1.06M11.71 4.29l1.06-1.06"></path></svg></button><button type="button" data-theme-pick="dark" aria-label="${escape(c.dark)}" title="${escape(c.dark)}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.6 10.1A5.75 5.75 0 0 1 5.9 2.4a5.75 5.75 0 1 0 7.7 7.7Z"></path></svg></button></div>`;

export function alternatesHtml(langs: readonly Lang[] = LANGS, slug?: string): string {
  const of = (lang: Lang) => ORIGIN + (slug === undefined ? home(lang) : hrefOf(slug, lang));
  return [...langs.map((l) => `<link rel="alternate" hreflang="${l.tag}" href="${of(l)}" />`), `<link rel="alternate" hreflang="x-default" href="${of(ENGLISH)}" />`].join("\n    ");
}

export function switcherHtml(here: Lang, slug?: string, langs: readonly Lang[] = [ENGLISH]): string {
  const links = LANGS.map((l) => {
    const translated = slug !== undefined && langs.includes(l);
    const href = translated ? hrefOf(slug, l) : home(l);
    const note = slug !== undefined && !translated && l.docsNote ? `<span class="langs-note">${escape(l.docsNote)}</span>` : "";
    return `<li><a href="${href}" hreflang="${l.tag}" lang="${l.tag}" data-lang-pick="${l.dir || "en"}"${l === here ? ' aria-current="true"' : ""}>${escape(l.name)}${note}</a></li>`;
  }).join("");
  return `<details class="langs"><summary aria-label="${escape(`${here.label}: ${here.name}`)}" title="${escape(here.name)}"><span class="langs-name">${escape(here.name)}</span><span class="langs-code" aria-hidden="true">${here.code}</span></summary><ul>${links}</ul></details>`;
}

function pageHtml(set: DocSet, at: number, body: string, figures: Set<string>, langs: readonly Lang[]): string {
  const { lang } = set;
  const c = lang.chrome;
  const page = set.pages[at];
  if (!page) throw new Error(`no page ${at}`);
  const scripts = [...figures]
    .filter((f) => existsSync(join(SITE, "figures", f, "live.js")))
    .map((f) => `\n    <script type="module" src="/figures/${f}/live.js"></script>`)
    .join("");
  const title = page.slug ? `${page.title} · ${c.title}` : c.title;
  const alternates = langs.length > 1 ? `\n    ${alternatesHtml(langs, page.slug)}` : "";
  const docsHome = set.pages.some((p) => p.slug === "") ? hrefOf("", lang) : hrefOf("");
  const nav = navHtml(set, page);
  return `<!doctype html>
<html lang="${lang.tag}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#111113" media="(prefers-color-scheme: dark)" />
    <title>${escape(title)}</title>
    <meta name="description" content="${escape(page.description)}" />${alternates}
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <link rel="preload" href="/fonts/PaperMono.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/anatomy/iso.css" />
    <link rel="stylesheet" href="/theme.css" />
    <link rel="stylesheet" href="/docs.css" />
    <link rel="stylesheet" href="/docs/figures.css" />
    <script src="/theme.js"></script>
    <script src="/lang.js"></script>
    <script type="module" src="/docs.js"></script>${scripts}
  </head>
  <body>
    <header class="bar">
      <a class="brand" href="${home(lang)}"><img src="/icon.svg" alt="" width="22" height="22" />Channels</a>
      <a class="section" href="${docsHome}">${escape(c.docs)}</a>
      <span class="grow"></span>
      <a class="quiet download" href="${home(lang)}">${escape(c.download)}</a>
      <a class="quiet gh" href="${REPO}" aria-label="${escape(c.source)}" title="${escape(c.source)}">${GITHUB_ICON}</a>
      ${switcherHtml(lang, page.slug, langs)}
      ${themePick(c)}
    </header>
    <div class="docs">
      <nav class="side" aria-label="${escape(c.docs)}">${nav}</nav>
      <main class="page">
        <details class="side-mini"><summary>${escape(page.title)}</summary><nav aria-label="${escape(c.docs)}">${nav}</nav></details>
${body}
        ${pagerHtml(set, at)}
        <p class="edit"><a href="${REPO}/blob/main/docs/${lang.dir ? `${lang.dir}/` : ""}${page.file}">${escape(c.edit)}</a></p>
      </main>
    </div>
  </body>
</html>
`;
}

export const wordsOf = (lang: Lang): Record<string, string> => (lang.dir ? JSON.parse(readFileSync(join(I18N, `${lang.dir}.json`), "utf8")) : {});

const TEXT_SPOTS = [(t: string) => `>${t}<`, ...["alt", "title", "aria-label", "content"].map((name) => (t: string) => ` ${name}="${t}"`)];

function translate(html: string, words: Record<string, string>): string {
  let out = html;
  for (const [en, to] of Object.entries(words).sort(([a], [b]) => b.length - a.length)) {
    for (const spot of TEXT_SPOTS) out = out.replaceAll(spot(en), () => spot(to));
  }
  return out;
}

export function landingWords(html: string): string[] {
  const body = html.replace(/<!-- langs -->[\s\S]*?<!-- \/langs -->/, "").replace(/<(script|style|pre|code)\b[^>]*>[\s\S]*?<\/\1>/g, "");
  const texts = [...body.matchAll(/>([^<>]+)</g), ...body.matchAll(/\s(?:alt|title|aria-label)="([^"]+)"/g), ...body.matchAll(/name="description" content="([^"]+)"/g)].map((m) => m[1] ?? "");
  return [...new Set(texts.map((t) => t.replace(/\s+/g, " ").trim()))].filter((t) => /[A-Za-z]{2}/.test(t) && !PRODUCT_NAMES.has(t));
}

export function landingHtml(english: string, lang: Lang, translatedDocs = false): string {
  const words = translate(english, wordsOf(lang));
  const html = (lang.dir ? words.replace(/href="\/"/g, `href="${home(lang)}"`) : words)
    .replace(/href="\/docs\/"/g, `href="${hrefOf("", translatedDocs ? lang : ENGLISH)}"`)
    .replace('<html lang="en">', `<html lang="${lang.tag}">`)
    .replace(/<!-- alternates -->[\s\S]*?<!-- \/alternates -->/, `<!-- alternates -->\n    ${alternatesHtml()}\n    <!-- /alternates -->`)
    .replace(/<!-- langs -->[\s\S]*?<!-- \/langs -->/, `<!-- langs -->${switcherHtml(lang)}<!-- /langs -->`);
  if (!html.includes(`hreflang="${lang.tag}"`) || !html.includes('class="langs"')) throw new Error("site/index.html lost its <!-- alternates --> or <!-- langs --> marks");
  return html;
}

function writeLanding(): string[] {
  const index = join(SITE, "index.html");
  const english = readFileSync(index, "utf8");
  const fresh = landingHtml(english, ENGLISH);
  if (fresh !== english) throw new Error("site/index.html's language marks are stale: run `bun scripts/docs-site.ts --landing` and commit it");
  return LANGS.filter((l) => l.dir).map((lang) => {
    const dir = join(SITE, lang.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), landingHtml(english, lang, existsSync(join(dir, "docs", "index.html"))));
    return relative(ROOT, join(dir, "index.html"));
  });
}

export async function writeDocs(docs = DOCS, site = SITE): Promise<string[]> {
  const english = readPages(docs);
  const sets: DocSet[] = LANGS.map((lang) => ({ lang, pages: lang.dir ? readPages(docs, lang, english) : english }));
  const englishSlugs = new Set(english.map((p) => p.slug));
  const written: string[] = [];
  for (const set of sets) {
    const out = join(site, set.lang.dir, "docs");
    rmSync(out, { recursive: true, force: true });
    if (!set.pages.length) continue;
    mkdirSync(out, { recursive: true });
    const slugs = new Set(set.pages.map((p) => p.slug));
    for (const [at, page] of set.pages.entries()) {
      const r: Render = { lang: set.lang, slugs, english: englishSlugs, ids: page.ids, figures: new Set(), images: new Set() };
      const body = await render(page.tree, r);
      const langs = sets.filter((s) => s.pages.some((p) => p.slug === page.slug)).map((s) => s.lang);
      const file = join(out, page.slug ? `${page.slug}.html` : "index.html");
      writeFileSync(file, pageHtml(set, at, body, r.figures, langs));
      written.push(relative(ROOT, file));
      for (const img of r.images) {
        const from = join(docs, img);
        if (!existsSync(from)) throw new Error(`${posix.join("docs", set.lang.dir, page.file)} shows ${img}, which isn't in docs/`);
        mkdirSync(dirname(join(site, "docs", img)), { recursive: true });
        copyFileSync(from, join(site, "docs", img));
      }
    }
  }
  return written;
}

async function build(): Promise<string[]> {
  if (!DRAFT) buildDemo();
  const written = await writeDocs();
  written.push(...writeLanding());
  written.push(...(await writeFigures()));
  written.push(await buildScene());
  return written;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".json": "application/json",
};

function fileFor(pathname: string): string | null {
  const path = resolve(SITE, "." + decodeURIComponent(pathname));
  if (!path.startsWith(SITE)) return null;
  for (const p of [path, `${path}.html`, join(path, "index.html")]) if (existsSync(p) && statSync(p).isFile()) return p;
  return null;
}

interface HeaderRule {
  path: RegExp;
  drop: string[];
  set: [string, string][];
}

const HEADER_RULES: HeaderRule[] = readFileSync(join(SITE, "_headers"), "utf8")
  .split(/\n(?=\S)/)
  .map((block) => {
    const [path = "", ...lines] = block.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
    const glob = path
      .trim()
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    const rules = lines.map((l) => l.trim());
    return {
      path: new RegExp(`^${glob}$`),
      drop: rules.filter((l) => l.startsWith("!")).map((l) => l.slice(1).trim().toLowerCase()),
      set: rules.filter((l) => !l.startsWith("!") && l.includes(":")).map((l) => [l.slice(0, l.indexOf(":")).trim().toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]),
    };
  });

function headersFor(pathname: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of HEADER_RULES.filter((r) => r.path.test(pathname))) {
    for (const name of rule.drop) delete out[name];
    for (const [name, value] of rule.set) out[name] = out[name] ? `${out[name]}, ${value}` : value;
  }
  return out;
}

function serve(port: number): void {
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const { pathname } = new URL(req.url);
      const preview = /^\/preview\/([a-z0-9-]+)$/.exec(pathname)?.[1];
      if (preview) {
        const run = Bun.spawnSync(["bun", import.meta.path, "--draft", "--figure", preview], { cwd: ROOT, stderr: "pipe" });
        if (run.exitCode !== 0) return new Response(run.stderr.toString(), { status: 500 });
        return new Response(run.stdout.toString(), { headers: { ...headersFor(pathname), "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      }
      if ((pathname === "/" || pathname.startsWith("/docs") || LANGS.some((l) => l.dir && pathname.startsWith(`/${l.dir}/`))) && !extname(pathname)) {
        const run = Bun.spawnSync(["bun", import.meta.path, "--draft"], { cwd: ROOT, stderr: "pipe" });
        if (run.exitCode !== 0) return new Response(run.stderr.toString(), { status: 500 });
      }
      const file = fileFor(pathname) ?? (extname(pathname) ? null : join(SITE, "index.html"));
      if (!file) return new Response("not found\n", { status: 404 });
      return new Response(Bun.file(file), { headers: { ...headersFor(pathname), "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" } });
    },
  });
  console.log(`docs on http://127.0.0.1:${server.port}/docs/ (rebuilt on every page load), one figure at /preview/<name>; Ctrl-C stops it`);
}

async function previewHtml(name: string): Promise<string> {
  const pages = readPages();
  const page: Page = { slug: `preview/${name}`, file: "index.md", title: name, description: name, group: "Preview", order: 0, tree: { type: "root" }, outline: [], ids: new Map() };
  const body = `<h1>${escape(name)}</h1>\n<p>One figure, on the page as the docs show it.</p>\n${await figureHtml(name)}\n`;
  return pageHtml({ lang: ENGLISH, pages: [page, ...pages] }, 0, body, new Set([name]), [ENGLISH]);
}

if (import.meta.main) {
  const at = process.argv.indexOf("--serve");
  const figure = process.argv.indexOf("--figure");
  if (process.argv.includes("--landing")) {
    const index = join(SITE, "index.html");
    writeFileSync(index, landingHtml(readFileSync(index, "utf8"), ENGLISH));
    console.log("site/index.html: alternates and the language switcher refreshed");
  } else if (figure >= 0) {
    process.stdout.write(await previewHtml(process.argv[figure + 1] ?? ""));
  } else if (at >= 0) {
    buildDemo();
    await build();
    serve(Number(process.argv[at + 1] ?? 4400) || 4400);
  } else {
    const written = await build();
    console.log(`wrote ${written.length} files: site/docs, each language's landing and translated docs under site/<lang>/, and the figures`);
  }
}
