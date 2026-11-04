import * as Y from "yjs";
import { b64url } from "../crypto.ts";

const THREAD_FRAGMENT = "thread";

const BLOCK_KINDS = ["text", "agent", "tool", "comment"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export interface BlockMeta {
  id: string;
  kind: BlockKind;
  author: string;
  at: number;
  sent?: true;
}

export interface Block extends BlockMeta {
  text: string;
}

export const newDocId = (): string => b64url(crypto.getRandomValues(new Uint8Array(16)));

export const threadOf = (doc: Y.Doc): Y.XmlFragment => doc.getXmlFragment(THREAD_FRAGMENT);

const isKind = (k: unknown): k is BlockKind => typeof k === "string" && (BLOCK_KINDS as readonly string[]).includes(k);

function metaOf(el: Y.XmlElement): BlockMeta | null {
  const id = el.getAttribute("id");
  const kind = el.getAttribute("kind");
  const author = el.getAttribute("author");
  const at = Number(el.getAttribute("at"));
  if (typeof id !== "string" || !isKind(kind) || typeof author !== "string" || !Number.isFinite(at)) return null;
  return el.getAttribute("sent") === "1" ? { id, kind, author, at, sent: true } : { id, kind, author, at };
}

function textOf(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) return node.toString().replace(/<[^>]*>/g, "");
  if (!(node instanceof Y.XmlElement)) return "";
  if (node.nodeName === "mention") return `@${node.getAttribute("name") ?? ""}`;
  if (node.nodeName === "image" || node.nodeName === "file") return `[${node.nodeName}: ${node.getAttribute("name") ?? ""}]`;
  const parts = node.toArray().map((c) => textOf(c));
  return node.nodeName === "paragraph" ? parts.join("") : parts.join("\n");
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

export function threadText(doc: Y.Doc, name: (pk: string) => string = (pk) => pk.slice(0, 8)): string {
  return blocksOf(doc)
    .map((b) => `${name(b.author)}${b.kind === "text" ? "" : ` (${b.kind})`}: ${b.text}`)
    .join("\n\n");
}
