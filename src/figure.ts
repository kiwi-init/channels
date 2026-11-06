import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { LocalFile } from "./attach.ts";

export const MAX_FIGURE_BYTES = 8 * 1024 * 1024;

export interface Figure {
  title: string;
  files: LocalFile[];
}

const LIGHT = /\[data-theme=(["']?)light\1\]/;
const LIGHT_ALL = new RegExp(LIGHT.source, "g");
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text);
  const out = new Uint8Array(encoded.length);
  out.set(encoded);
  return out;
}

function page(path: string): string | null {
  if (!existsSync(path)) return null;
  if (!statSync(path).isFile()) throw new Error(`not a file: ${path}`);
  return readFileSync(path, "utf8");
}

function svgEnd(html: string, from: number): number {
  const tag = /<(\/?)svg\b[^>]*?(\/?)>/g;
  tag.lastIndex = from;
  let depth = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    if (m[1]) depth--;
    else if (!m[2]) depth++;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

function followSystem(css: string): string {
  let out = "";
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      const rule = css.slice(start, i + 1);
      const head = rule.slice(0, rule.indexOf("{"));
      out += head.trim().startsWith("@") || !LIGHT.test(head) ? rule : `@media (prefers-color-scheme: light){${head.replace(LIGHT_ALL, "").trim()}${rule.slice(head.length)}}`;
      start = i + 1;
    }
  }
  return out + css.slice(start);
}

function snapshotOf(html: string, name: string): string {
  const open = /<svg\b[^>]*\bclass="([^"]*\biso-svg\b[^"]*)"[^>]*>/.exec(html);
  if (!open) throw new Error(`${name} has no anatomy figure in it (no <svg class="iso-svg">)`);
  const end = svgEnd(html, open.index);
  if (end < 0) throw new Error(`${name}: its figure's <svg> never closes`);
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).find((c) => c.includes("--anatomy-"));
  if (!css) throw new Error(`${name} has no anatomy styles in it`);
  let tag = open[0].replace(open[1]!, `${open[1]} iso`);
  if (!/\sxmlns=/.test(tag)) tag = tag.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  const box = /\sviewBox="[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/.exec(tag);
  if (box && !/\swidth=/.test(tag) && !/\sheight=/.test(tag)) tag = tag.replace(/^<svg\b/, `<svg width="${box[1]}" height="${box[2]}"`);
  return `${tag}<style>${followSystem(css)}</style>${html.slice(open.index + open[0].length, end)}`;
}

function ownSnapshot(path: string): string | null {
  const svg = page(path);
  if (svg === null) return null;
  if (!/^\s*(<\?xml[^>]*>\s*)?<svg\b/.test(svg)) throw new Error(`${path} isn't an SVG`);
  return svg;
}

export function loadFigure(path: string): Figure {
  if (!/\.html$/i.test(path)) throw new Error(`${path}: --figure takes the .html page the anatomy skill builds`);
  const stem = path.replace(/\.html$/i, "").replace(/-light$/, "");
  const dark = page(`${stem}.html`);
  const light = page(`${stem}-light.html`);
  const main = dark ?? light;
  if (main === null) throw new Error(`no such page: ${path}`);
  const name = basename(stem).replace(/[^A-Za-z0-9_-]/g, "-") || "figure";
  const files: LocalFile[] = [
    { name: `${name}.figure.html`, mime: "text/html", bytes: bytesOf(main) },
    ...(dark !== null && light !== null ? [{ name: `${name}.figure-light.html`, mime: "text/html", bytes: bytesOf(light) }] : []),
    { name: `${name}.figure.svg`, mime: "image/svg+xml", bytes: bytesOf(ownSnapshot(`${stem}.svg`) ?? snapshotOf(main, basename(path))) },
  ];
  const size = files.reduce((n, f) => n + f.bytes.length, 0);
  if (size > MAX_FIGURE_BYTES) throw new Error(`${name} is ${(size / (1024 * 1024)).toFixed(1)} MB with its snapshot; a figure is at most ${MAX_FIGURE_BYTES / (1024 * 1024)} MB`);
  const title = /<title>([^<]*)<\/title>/i
    .exec(main)?.[1]
    ?.trim()
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ENTITIES[e]!);
  return { title: title || name, files };
}
