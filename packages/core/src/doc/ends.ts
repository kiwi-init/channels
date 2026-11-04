import type { Block } from "./blocks.ts";

type Line = Pick<Block, "author" | "by" | "sent" | "posted" | "text">;

const endsEarlierLines = (b: Line): boolean => !!b.sent || !!b.posted || b.text.trim() !== "";

export interface LaterLines {
  add: (b: Line) => void;
  finish: (b: Line) => boolean;
}

export function laterLines(): LaterLines {
  const seen = new Map<string, Set<string>>();
  return {
    add: (b) => {
      if (!endsEarlierLines(b)) return;
      const by = seen.get(b.author) ?? new Set<string>();
      by.add(b.by ?? "");
      seen.set(b.author, by);
    },
    finish: (b) => {
      const by = seen.get(b.author);
      return !!by && (!b.by || by.has("") || by.has(b.by));
    },
  };
}
