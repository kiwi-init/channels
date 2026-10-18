import type { Task } from "./types.ts";

const OPEN = new Set(["todo", "doing", "review"]);

export function unnamedTasks(summary: string, tasks: Iterable<Task>): number[] {
  const named = new Set([...summary.matchAll(/\bT(\d+)\b/g)].map((m) => Number(m[1])));
  return [...tasks].filter((t) => OPEN.has(t.state) && !t.archived && !named.has(t.id)).map((t) => t.id);
}

export function unnamedAsks(summary: string, asks: Iterable<{ seq: number }>): number[] {
  const named = new Set([...summary.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1])));
  return [...asks].map((m) => m.seq).filter((seq) => !named.has(seq));
}
