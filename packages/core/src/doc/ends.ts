import type { Block } from "./blocks.ts";

export const endsEarlierLines = (b: Pick<Block, "sent" | "posted" | "text">): boolean => !!b.sent || !!b.posted || b.text.trim() !== "";
