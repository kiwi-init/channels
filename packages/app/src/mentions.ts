import { bareAt, memberNamed, readsAsHandle } from "@kiwi/core/state.ts";
import { scanTree, type Span, type Tree } from "./mention-scan.ts";

export type Found = { start: number; end: number } & (
  | { kind: "mention" | "bare"; name: string; label: string }
  | { kind: "task"; id: number }
  | { kind: "ref"; seq: number }
  | { kind: "image"; url: string; alt: string }
);

const MENTION = /(?<![\p{L}\p{N}_.@-])@([\p{L}\p{N}_.-]+)/gu;
const TASK = /\bT(\d+)\b/g;
const REF = /(?<![\p{L}\p{N}\p{M}_/#&.-])#([1-9]\d{0,8})(?![\p{L}\p{N}\p{M}_])/gu;
const NOT_A_MESSAGE = /\b(?:PR|pr|pull|issue|Issue|issues|Issues)\s*$/;
const WORD = /(?<![\p{L}\p{N}\p{M}_/.@-])[\p{L}\p{N}_.-]+/gu;

const parsed = new Map<string, Tree>();
let parse: ((text: string) => Tree) | null = null;
let version = 0;
const waiting = new Set<() => void>();

export function takeParser(next: (text: string) => Tree): void {
  parse = next;
  parsed.clear();
  version++;
  for (const w of waiting) w();
}

export const parserVersion = (): number => version;

export function onParser(listener: () => void): () => void {
  waiting.add(listener);
  return () => void waiting.delete(listener);
}

function treeOf(text: string): Tree {
  const known = parsed.get(text);
  if (known) return known;
  const next = parse ? parse(text) : scanTree(text);
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
