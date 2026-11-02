import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Image, Span, Tree } from "./mention-scan.ts";

type MdNode = { type: string; value?: string; url?: string; alt?: string | null; children?: MdNode[]; position?: { start: { offset?: number }; end: { offset?: number } } };

const NOT_PROSE = new Set(["link", "linkReference", "definition", "image", "imageReference", "code", "inlineCode", "html"]);

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

export function markdownTree(text: string): Tree {
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  return { spans: prose(tree), images: images(tree) };
}
