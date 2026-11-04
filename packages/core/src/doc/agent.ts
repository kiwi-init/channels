import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { mentionsOf } from "../changes.ts";
import { appendToBlock, blocksOf, markSent, newBlock, threadText, type Block, type BlockKind } from "./blocks.ts";

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
  after?: number;
}

interface Watched {
  doc: Y.Doc;
  awareness: Awareness;
  th: string;
}

const WAKING_KINDS: readonly BlockKind[] = ["text", "comment", "agent"];

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
  const woke = new Set<string>();
  if (rule.after === undefined) for (const b of blocksOf(doc)) woke.add(b.id);

  const fire = (block: Block): void => {
    if (woke.has(block.id)) return;
    woke.add(block.id);
    onWake({ th, block, thread: threadText(doc, rule.name), selection: selectionOf(awareness, block.author) });
  };

  const look = (): void => {
    const blocks = blocksOf(doc);
    blocks.forEach((block, i) => {
      if (woke.has(block.id) || (rule.after !== undefined && block.at <= rule.after)) return;
      if (!wakesMe(block, rule)) return;
      if (block.sent || blocks.slice(i + 1).some((b) => b.author === block.author)) fire(block);
    });
  };

  doc.on("update", look);
  look();
  return () => doc.off("update", look);
}

export interface AgentBlock {
  id: string;
  write: (chunk: string) => boolean;
  end: () => boolean;
}

export function agentBlock(doc: Y.Doc, me: string, kind: BlockKind = "agent", at = Date.now()): AgentBlock {
  const { id } = newBlock(doc, kind, me, "", at);
  return { id, write: (chunk) => appendToBlock(doc, id, chunk), end: () => markSent(doc, id) };
}
