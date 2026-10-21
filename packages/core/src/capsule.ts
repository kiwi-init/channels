import type { Task } from "./state.ts";

export const CAPSULE_LISTS = ["know", "tried", "traps", "files"] as const;
export type CapsuleList = (typeof CAPSULE_LISTS)[number];

export interface CapsuleFields {
  branch?: string;
  head?: string;
  next: string;
  know: string[];
  tried: string[];
  traps: string[];
  files: string[];
}

export interface Capsule extends CapsuleFields {
  seq: number;
  by: string;
  at: number;
  legacy: boolean;
}

const SINGLE = /^(branch|head|next):[ \t]*(.*)$/;
const LIST = /^(know|tried|traps|files):[ \t]*(.*)$/;
const ITEM = /^[ \t]*[-*][ \t]+(.+)$/;

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
const isList = (k: string): k is CapsuleList => (CAPSULE_LISTS as readonly string[]).includes(k);

export function emptyCapsule(next = ""): CapsuleFields {
  return { next, know: [], tried: [], traps: [], files: [] };
}

export function capsuleText(c: CapsuleFields): string {
  return [
    ...(c.branch?.trim() ? [`branch: ${oneLine(c.branch)}`] : []),
    ...(c.head?.trim() ? [`head: ${oneLine(c.head)}`] : []),
    `next: ${oneLine(c.next)}`,
    ...CAPSULE_LISTS.flatMap((k) => {
      const items = c[k].map(oneLine).filter(Boolean);
      return items.length ? [`${k}:`, ...items.map((x) => `- ${x}`)] : [];
    }),
  ].join("\n");
}

export function parseCapsule(text: string): CapsuleFields | null {
  const c = emptyCapsule();
  let list: CapsuleList | null = null;
  let next = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const single = SINGLE.exec(line);
    if (single) {
      const value = oneLine(single[2] ?? "");
      list = null;
      if (single[1] === "next") {
        c.next = value;
        next = value.length > 0;
      } else if (value) c[single[1] as "branch" | "head"] = value;
      continue;
    }
    const named = LIST.exec(line);
    if (named && isList(named[1] ?? "")) {
      list = named[1] as CapsuleList;
      const inline = oneLine(named[2] ?? "");
      if (inline) c[list].push(inline);
      continue;
    }
    const item = ITEM.exec(line);
    const said = oneLine(item ? (item[1] ?? "") : line);
    if (said) c[list ?? "know"].push(said);
  }
  return next ? c : null;
}

export function capsuleOf(task: Pick<Task, "notes">): Capsule | null {
  const note = task.notes.findLast((n) => n.checkpoint);
  if (!note) return null;
  const parsed = parseCapsule(note.text);
  const meta = { seq: note.seq, by: note.by, at: note.ts };
  if (parsed) return { ...parsed, ...meta, legacy: false };
  return { ...emptyCapsule(), know: [note.text.trim()], ...meta, legacy: true };
}

export function diffCommand(c: Pick<CapsuleFields, "branch" | "head">, at: string | undefined): string | null {
  const tip = at?.trim() || c.head?.trim() || c.branch?.trim();
  return tip ? `git diff origin/HEAD...${tip}` : null;
}
