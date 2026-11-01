import { bareAt, memberNamed, readsAsHandle } from "@kiwi/core/state.ts";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

type MdNode = { type: string; value?: string; url?: string; alt?: string | null; children?: MdNode[]; position?: { start: { offset?: number }; end: { offset?: number } } };

export type Found = { start: number; end: number } & (
  | { kind: "mention" | "bare"; name: string; label: string }
  | { kind: "task"; id: number }
  | { kind: "ref"; seq: number }
  | { kind: "image"; url: string; alt: string }
);

const NOT_PROSE = new Set(["link", "linkReference", "definition", "image", "imageReference", "code", "inlineCode", "html"]);
const MENTION = /(?<![\p{L}\p{N}_.@-])@([\p{L}\p{N}_.-]+)/gu;
const TASK = /\bT(\d+)\b/g;
const REF = /(?<![\p{L}\p{N}\p{M}_/#&.-])#([1-9]\d{0,8})(?![\p{L}\p{N}\p{M}_])/gu;
const NOT_A_MESSAGE = /\b(?:PR|pr|pull|issue|Issue|issues|Issues)\s*$/;
const WORD = /(?<![\p{L}\p{N}\p{M}_/.@-])[\p{L}\p{N}_.-]+/gu;

type Span = { start: number; end: number };

type Image = Span & { url: string; alt: string };

function images(node: MdNode): Image[] {
  if (node.type === "image") {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return start !== undefined && end !== undefined && node.url !== undefined ? [{ start, end, url: node.url, alt: node.alt ?? "" }] : [];
  }
  return (node.children ?? []).flatMap(images);
}

function prose(node: MdNode): Span[] {
  if (NOT_PROSE.has(node.type)) return [];
  if (node.type === "text") {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return start !== undefined && end !== undefined ? [{ start, end }] : [];
  }
  return (node.children ?? []).flatMap(prose);
}

const parsed = new Map<string, { spans: Span[]; images: Image[] }>();

function treeOf(text: string): { spans: Span[]; images: Image[] } {
  const known = parsed.get(text);
  if (known) return known;
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const next = { spans: prose(tree), images: images(tree) };
  if (parsed.size >= 500) parsed.delete(parsed.keys().next().value ?? "");
  parsed.set(text, next);
  return next;
}

export const spansOf = (text: string): Span[] => treeOf(text).spans;

function found(text: string, nicknames: ReadonlyMap<string, string>, before?: number): Found[] {
  const labelOf = (name: string) => nicknames.get(name) ?? nicknames.get(name.toLowerCase());
  const { spans, images: pictures } = treeOf(text);
  const hits: Found[] = pictures.map((p) => ({ kind: "image", ...p }));
  for (const span of spans) {
    const part = text.slice(span.start, span.end);
    for (const m of part.matchAll(MENTION)) {
      const who = memberNamed(m[1] ?? "", labelOf);
      if (who) hits.push({ kind: "mention", ...who, start: span.start + m.index, end: span.start + m.index + 1 + who.name.length });
    }
    for (const m of part.matchAll(TASK)) hits.push({ kind: "task", id: Number(m[1]), start: span.start + m.index, end: span.start + m.index + m[0].length });
    if (before !== undefined)
      for (const m of part.matchAll(REF)) {
        const seq = Number(m[1]);
        if (seq < before && !NOT_A_MESSAGE.test(part.slice(0, m.index))) hits.push({ kind: "ref", seq, start: span.start + m.index, end: span.start + m.index + m[0].length });
      }
    for (const m of part.matchAll(WORD)) {
      const who = memberNamed(m[0], labelOf);
      const start = span.start + m.index;
      if (who && readsAsHandle(who.name, who.label) && bareAt(text, start, start + who.name.length)) hits.push({ kind: "bare", ...who, start, end: start + who.name.length });
    }
  }
  const kept: Found[] = [];
  const escaped = (hit: Found) => text[hit.start - 1] === "\\" || text[hit.end] === "\\";
  for (const hit of hits.sort((a, b) => a.start - b.start)) if (!kept.length || hit.start >= (kept.at(-1)?.end ?? 0)) kept.push(hit);
  return kept.filter((hit) => !escaped(hit));
}

export function swap(text: string, nicknames: ReadonlyMap<string, string>, out: (hit: Found) => string | null, before?: number): string {
  let result = "";
  let from = 0;
  for (const hit of found(text, nicknames, before)) {
    const said = out(hit);
    if (said === null) continue;
    result += text.slice(from, hit.start) + said;
    from = hit.end;
  }
  return result + text.slice(from);
}

export const literal = (text: string): string => text.replace(/[\\`*_[\]()<>&!|~]/g, "\\$&");

const asText = (text: string): string => text.replace(/[!-/:-@[-`{-~]/g, "\\$&");

export function namedMarkdown(text: string, nicknames: ReadonlyMap<string, string>): string {
  return swap(text, nicknames, (hit) => (hit.kind === "mention" || hit.kind === "bare" ? `${hit.kind === "mention" ? "@" : ""}${asText(hit.label)}` : null));
}

export function named(text: string, nicknames: ReadonlyMap<string, string>): string {
  return swap(text, nicknames, (hit) => (hit.kind === "mention" || hit.kind === "bare" ? `${hit.kind === "mention" ? "@" : ""}${hit.label}` : null));
}
