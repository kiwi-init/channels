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
  posted?: true;
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
  return {
    id,
    kind,
    author,
    at,
    ...(el.getAttribute("sent") === "1" ? { sent: true as const } : {}),
    ...(el.getAttribute("posted") === "1" ? { posted: true as const } : {}),
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

export function unmarkSent(doc: Y.Doc, id: string): boolean {
  const el = blockElement(doc, id);
  if (!el) return false;
  doc.transact(() => {
    if (el.getAttribute("sent") === "1") el.removeAttribute("sent");
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

export function threadText(doc: Y.Doc, name: (pk: string) => string = (pk) => pk.slice(0, 8), keep: (b: Block) => boolean = () => true): string {
  return blocksOf(doc)
    .filter(keep)
    .map((b) => `${name(b.author)}${b.kind === "text" ? "" : ` (${b.kind})`}: ${b.text}`)
    .join("\n\n");
}
