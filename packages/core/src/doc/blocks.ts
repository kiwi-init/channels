import * as Y from "yjs";
import { b64url } from "../crypto.ts";
import type { FileAttachment, ImageAttachment } from "../protocol.ts";

const THREAD_FRAGMENT = "thread";

export const GIVEN_BACK = "back";

const BLOCK_KINDS = ["text", "agent", "tool", "comment"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export interface BlockMeta {
  id: string;
  kind: BlockKind;
  author: string;
  at: number;
  sent?: true;
  posted?: true;
  back?: true;
  re?: number;
  quote?: string;
}

export interface Block extends BlockMeta {
  text: string;
}

export type BlockMedia = { image: ImageAttachment & { ref: NonNullable<ImageAttachment["ref"]> } } | { file: FileAttachment };

export const newDocId = (): string => b64url(crypto.getRandomValues(new Uint8Array(16)));

export const threadOf = (doc: Y.Doc): Y.XmlFragment => doc.getXmlFragment(THREAD_FRAGMENT);

const isKind = (k: unknown): k is BlockKind => typeof k === "string" && (BLOCK_KINDS as readonly string[]).includes(k);

function metaOf(el: Y.XmlElement): BlockMeta | null {
  const id = el.getAttribute("id");
  const kind = el.getAttribute("kind");
  const author = el.getAttribute("author");
  const at = Number(el.getAttribute("at"));
  if (typeof id !== "string" || !isKind(kind) || typeof author !== "string" || !Number.isFinite(at)) return null;
  const re = Number(el.getAttribute("re"));
  const quote = el.getAttribute("quote");
  return {
    id,
    kind,
    author,
    at,
    ...(el.getAttribute("sent") === "1" ? { sent: true as const } : {}),
    ...(el.getAttribute("posted") === "1" ? { posted: true as const } : {}),
    ...(el.getAttribute("sent") === GIVEN_BACK ? { back: true as const } : {}),
    ...(Number.isSafeInteger(re) && re > 0 ? { re } : {}),
    ...(typeof quote === "string" && quote ? { quote } : {}),
  };
}

function textOf(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) return node.toString().replace(/<[^>]*>/g, "");
  if (!(node instanceof Y.XmlElement)) return "";
  if (node.nodeName === "mention") return `@${node.getAttribute("name") ?? ""}`;
  if (node.nodeName === "image" || node.nodeName === "file") return `[${node.nodeName}: ${node.getAttribute("name") ?? ""}]`;
  const parts = node.toArray().map((c) => textOf(c));
  return node.nodeName === "paragraph" ? parts.join("") : parts.join("\n");
}

const WRAP: Record<string, string> = { strong: "**", em: "_", strike: "~~", code: "`" };

function inlineMarkdown(t: Y.XmlText): string {
  return (t.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[])
    .map((d) => {
      if (typeof d.insert !== "string") return "";
      const marks = Object.keys(d.attributes ?? {}).filter((k) => k in WRAP);
      const core = d.insert.trim();
      if (!core || !marks.length) return d.insert;
      const lead = d.insert.slice(0, d.insert.indexOf(core));
      const tail = d.insert.slice(lead.length + core.length);
      const order = [...marks.filter((k) => k !== "code"), ...marks.filter((k) => k === "code")];
      return `${lead}${order.map((k) => WRAP[k]).join("")}${core}${[...order]
        .reverse()
        .map((k) => WRAP[k])
        .join("")}${tail}`;
    })
    .join("");
}

function markdownOf(node: Y.XmlElement | Y.XmlText | Y.XmlHook, depth: number): string {
  if (node instanceof Y.XmlText) return inlineMarkdown(node);
  if (!(node instanceof Y.XmlElement)) return "";
  const kids = node.toArray();
  switch (node.nodeName) {
    case "mention":
      return `@${node.getAttribute("name") ?? ""}`;
    case "image":
    case "file":
      return `[${node.nodeName}: ${node.getAttribute("name") ?? ""}]`;
    case "paragraph":
      return kids.map((c) => markdownOf(c, depth)).join("");
    case "code_block":
      return `\`\`\`\n${kids.map((c) => (c instanceof Y.XmlText ? c.toString().replace(/<[^>]*>/g, "") : "")).join("")}\n\`\`\``;
    case "bullet_list":
    case "ordered_list":
      return kids.map((c, i) => `${"  ".repeat(depth)}${node.nodeName === "bullet_list" ? "-" : `${i + 1}.`} ${markdownOf(c, depth + 1)}`).join("\n");
    case "list_item":
      return kids.map((c, i) => (i === 0 ? markdownOf(c, depth) : `\n${markdownOf(c, depth)}`)).join("");
    default:
      return kids.map((c) => markdownOf(c, depth)).join("\n");
  }
}

function hasMedia(node: Y.XmlElement | Y.XmlText | Y.XmlHook): boolean {
  return node instanceof Y.XmlElement && (node.nodeName === "image" || node.nodeName === "file" || node.toArray().some(hasMedia));
}

export interface RichBlock {
  id: string;
  markdown: string;
  media: boolean;
}

export function richOf(node: unknown): RichBlock | null {
  if (!(node instanceof Y.XmlElement) || node.nodeName !== "block") return null;
  const id = node.getAttribute("id");
  return typeof id === "string" ? { id, markdown: markdownOf(node, 0).trim(), media: hasMedia(node) } : null;
}

export function richBlocks(doc: Y.Doc): Map<string, RichBlock> {
  const out = new Map<string, RichBlock>();
  for (const node of threadOf(doc).toArray()) {
    const r = richOf(node);
    if (r) out.set(r.id, r);
  }
  return out;
}

export function blockOf(node: unknown): Block | null {
  if (!(node instanceof Y.XmlElement) || node.nodeName !== "block") return null;
  const meta = metaOf(node);
  return meta ? { ...meta, text: textOf(node) } : null;
}

export function blocksOf(doc: Y.Doc): Block[] {
  const out: Block[] = [];
  for (const node of threadOf(doc).toArray()) {
    const block = blockOf(node);
    if (block) out.push(block);
  }
  return out;
}

function blockElement(doc: Y.Doc, id: string): Y.XmlElement | null {
  for (const node of threadOf(doc).toArray()) if (node instanceof Y.XmlElement && node.nodeName === "block" && node.getAttribute("id") === id) return node;
  return null;
}

function paragraphs(text: string): Y.XmlElement[] {
  return text.split("\n").map((line) => {
    const p = new Y.XmlElement("paragraph");
    if (line) p.insert(0, [new Y.XmlText(line)]);
    return p;
  });
}

export function newBlock(doc: Y.Doc, kind: BlockKind, author: string, text = "", at = Date.now()): BlockMeta {
  const meta: BlockMeta = { id: newDocId(), kind, author, at };
  doc.transact(() => {
    const el = new Y.XmlElement("block");
    el.setAttribute("id", meta.id);
    el.setAttribute("kind", meta.kind);
    el.setAttribute("author", meta.author);
    el.setAttribute("at", String(meta.at));
    el.insert(0, paragraphs(text));
    const thread = threadOf(doc);
    thread.insert(thread.length, [el]);
  });
  return meta;
}

export function markSent(doc: Y.Doc, id: string): boolean {
  const el = blockElement(doc, id);
  if (!el) return false;
  if (el.getAttribute("sent") !== "1") el.setAttribute("sent", "1");
  return true;
}

export function markPosted(doc: Y.Doc, id: string): boolean {
  const el = blockElement(doc, id);
  if (!el) return false;
  doc.transact(() => {
    if (el.getAttribute("sent") !== "1") el.setAttribute("sent", "1");
    if (el.getAttribute("posted") !== "1") el.setAttribute("posted", "1");
  });
  return true;
}

export function markBack(doc: Y.Doc, id: string): boolean {
  const el = blockElement(doc, id);
  if (!el) return false;
  doc.transact(() => {
    if (el.getAttribute("sent") !== GIVEN_BACK) el.setAttribute("sent", GIVEN_BACK);
    if (el.getAttribute("posted") === "1") el.removeAttribute("posted");
  });
  return true;
}

export function appendToBlock(doc: Y.Doc, id: string, text: string): boolean {
  const el = blockElement(doc, id);
  if (!el || !text) return false;
  doc.transact(() => {
    const [first, ...rest] = text.split("\n");
    const last = el.get(el.length - 1);
    if (last instanceof Y.XmlElement && last.nodeName === "paragraph") {
      const tail = last.get(last.length - 1);
      if (tail instanceof Y.XmlText) tail.insert(tail.length, first ?? "");
      else if (first) last.insert(last.length, [new Y.XmlText(first)]);
    } else if (first !== undefined) el.insert(el.length, paragraphs(first));
    if (rest.length) el.insert(el.length, paragraphs(rest.join("\n")));
  });
  return true;
}

function mediaElement(m: BlockMedia): Y.XmlElement {
  if ("image" in m) {
    const el = new Y.XmlElement("image");
    el.setAttribute("name", m.image.name);
    el.setAttribute("mime", m.image.mime);
    el.setAttribute("size", String(m.image.ref.size));
    el.setAttribute("id", m.image.ref.id);
    el.setAttribute("key", m.image.ref.key);
    return el;
  }
  const el = new Y.XmlElement("file");
  el.setAttribute("name", m.file.name);
  el.setAttribute("mime", m.file.mime);
  el.setAttribute("size", String(m.file.size));
  el.setAttribute("pieces", JSON.stringify(m.file.pieces));
  return el;
}

export function attachToBlock(doc: Y.Doc, id: string, media: readonly BlockMedia[]): boolean {
  const el = blockElement(doc, id);
  if (!el || !media.length) return false;
  el.insert(el.length, media.map(mediaElement));
  return true;
}

export function removeBlock(doc: Y.Doc, id: string): boolean {
  const el = blockElement(doc, id);
  if (!el) return false;
  const thread = threadOf(doc);
  const at = thread.toArray().indexOf(el);
  if (at < 0) return false;
  thread.delete(at, 1);
  return true;
}

const isMedia = (node: unknown): boolean => node instanceof Y.XmlElement && (node.nodeName === "image" || node.nodeName === "file");

function plainWords(p: Y.XmlElement | Y.XmlText | Y.XmlHook | undefined): Y.XmlText | null {
  if (!(p instanceof Y.XmlElement) || p.nodeName !== "paragraph" || p.length !== 1) return null;
  const t = p.get(0);
  if (!(t instanceof Y.XmlText)) return null;
  return (t.toDelta() as { insert: unknown }[]).every((d) => typeof d.insert === "string") ? t : null;
}

function retype(t: Y.XmlText, from: string, to: string): void {
  let head = 0;
  while (head < from.length && head < to.length && from[head] === to[head]) head++;
  let tail = 0;
  while (tail < from.length - head && tail < to.length - head && from[from.length - 1 - tail] === to[to.length - 1 - tail]) tail++;
  if (from.length - head - tail) t.delete(head, from.length - head - tail);
  if (to.length - head - tail) t.insert(head, to.slice(head, to.length - tail));
}

export function rewriteBlock(doc: Y.Doc, id: string, text: string): boolean {
  const el = blockElement(doc, id);
  const meta = el && metaOf(el);
  if (!el || !meta || (!meta.sent && !meta.posted)) return false;
  const units = el
    .toArray()
    .map((node, at) => ({ node, at, lines: textOf(node).split("\n") }))
    .filter((u) => !isMedia(u.node));
  const lines = text.split("\n");
  const fits = (u: (typeof units)[number], start: number): boolean => u.lines.every((l, i) => lines[start + i] === l);
  let head = 0;
  let used = 0;
  while (head < units.length && fits(units[head]!, used)) used += units[head++]!.lines.length;
  let tail = 0;
  let left = lines.length;
  while (tail < units.length - head && left - units[units.length - 1 - tail]!.lines.length >= used && fits(units[units.length - 1 - tail]!, left - units[units.length - 1 - tail]!.lines.length))
    left -= units[units.length - 1 - tail++]!.lines.length;
  const gone = units.slice(head, units.length - tail);
  const fresh = lines.slice(used, left);
  if (!gone.length && !fresh.length) return true;
  doc.transact(() => {
    const only = gone.length === 1 && fresh.length === 1 ? plainWords(gone[0]!.node) : null;
    if (only) return retype(only, gone[0]!.lines[0]!, fresh[0]!);
    const at = gone[0]?.at ?? (head ? units[head - 1]!.at + 1 : (units[units.length - tail]?.at ?? 0));
    for (const u of [...gone].reverse()) el.delete(u.at, 1);
    if (fresh.length) el.insert(at, paragraphs(fresh.join("\n")));
  });
  return true;
}

export function threadText(doc: Y.Doc, name: (pk: string) => string = (pk) => pk.slice(0, 8), keep: (b: Block) => boolean = () => true): string {
  return blocksOf(doc)
    .filter(keep)
    .map((b) => `${name(b.author)}${b.kind === "text" ? "" : ` (${b.kind})`}: ${b.text}`)
    .join("\n\n");
}
