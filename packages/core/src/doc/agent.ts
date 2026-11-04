import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { mentionsOf } from "../changes.ts";
import { appendToBlock, attachToBlock, blocksOf, markPosted, markSent, newBlock, threadText, type Block, type BlockKind, type BlockMedia } from "./blocks.ts";

export const PRESENCE_FIELD = "kiwi";

interface DocSelection {
  block: string;
  text: string;
}

interface DocPresence {
  author: string;
  selection?: DocSelection;
}

export interface DocWake {
  th: string;
  block: Block;
  thread: string;
  selection: DocSelection | null;
}

export interface WakeRule {
  me: string;
  names: readonly string[];
  owns: boolean;
  name?: (author: string) => string;
  known?: (block: Block) => boolean;
  settled?: (blocks: readonly Block[]) => void;
}

interface Watched {
  doc: Y.Doc;
  awareness: Awareness;
  th: string;
}

const WAKING_KINDS: readonly BlockKind[] = ["text", "comment", "agent"];

export function settledBlocks(blocks: readonly Block[]): Block[] {
  const later = new Set<string>();
  const out: Block[] = [];
  for (const b of [...blocks].reverse()) {
    if (b.sent || b.posted || (!b.back && later.has(b.author))) out.push(b);
    later.add(b.author);
  }
  return out.reverse();
}

export function wakesMe(block: Block, rule: Pick<WakeRule, "me" | "names" | "owns">): boolean {
  if (block.author === rule.me || !WAKING_KINDS.includes(block.kind) || !block.text.trim()) return false;
  if (rule.owns) return true;
  const said = mentionsOf(block.text);
  return rule.names.some((n) => said.has(n.toLowerCase()));
}

function isSelection(x: unknown): x is DocSelection {
  const s = x as Partial<DocSelection> | null;
  return !!s && typeof s.block === "string" && typeof s.text === "string";
}

function selectionOf(awareness: Awareness, author: string): DocSelection | null {
  for (const state of awareness.getStates().values()) {
    const p = (state as Record<string, unknown>)[PRESENCE_FIELD] as Partial<DocPresence> | undefined;
    if (p?.author === author && isSelection(p.selection) && p.selection.text) return { block: p.selection.block, text: p.selection.text };
  }
  return null;
}

export function watchWakes(watched: Watched, rule: WakeRule, onWake: (wake: DocWake) => void): () => void {
  const { doc, awareness, th } = watched;
  const before = new Set(blocksOf(doc).map((b) => b.id));
  const known = rule.known ?? ((b: Block) => before.has(b.id));
  const done = new Set<string>();

  const look = (): void => {
    const fresh = settledBlocks(blocksOf(doc)).filter((b) => !done.has(b.id) && !known(b));
    for (const block of fresh) {
      done.add(block.id);
      if (!block.posted && wakesMe(block, rule)) onWake({ th, block, thread: threadText(doc, rule.name), selection: selectionOf(awareness, block.author) });
    }
    if (fresh.length) rule.settled?.(fresh);
  };

  doc.on("update", look);
  look();
  return () => doc.off("update", look);
}

export interface AgentBlock {
  id: string;
  write: (chunk: string) => boolean;
  attach: (media: readonly BlockMedia[]) => boolean;
  end: () => boolean;
  post: () => boolean;
}

export function agentBlock(doc: Y.Doc, me: string, kind: BlockKind = "agent", at = Date.now()): AgentBlock {
  const { id } = newBlock(doc, kind, me, "", at);
  return { id, write: (chunk) => appendToBlock(doc, id, chunk), attach: (media) => attachToBlock(doc, id, media), end: () => markSent(doc, id), post: () => markPosted(doc, id) };
}
