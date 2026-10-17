import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { home, safe, writePrivate } from "./paths.ts";

export function cursorDir(channel: string): string {
  return join(home(), "cursors", safe(channel));
}

export function cursorPath(channel: string, agent: string): string {
  return join(cursorDir(channel), safe(agent));
}

export function readCursor(channel: string, agent: string): number | null {
  const path = cursorPath(channel, agent);
  return existsSync(path) ? Number(readFileSync(path, "utf8").trim()) || 0 : null;
}

export function writeCursor(channel: string, agent: string, seq: number): void {
  writePrivate(cursorPath(channel, agent), `${seq}\n`);
}

export function seenPath(channel: string, agent: string): string {
  return `${cursorPath(channel, agent)}.seen`;
}

export function readSeen(channel: string, agent: string): Set<number> {
  const path = seenPath(channel, agent);
  if (!existsSync(path)) return new Set();
  return new Set(readFileSync(path, "utf8").split(/\s+/).filter(Boolean).map(Number));
}

export function markSeen(channel: string, agent: string, seqs: number[]): void {
  if (!seqs.length) return;
  const cursor = readCursor(channel, agent) ?? 0;
  const all = [...readSeen(channel, agent), ...seqs].filter((s) => s > cursor);
  writePrivate(seenPath(channel, agent), [...new Set(all)].sort((a, b) => a - b).join("\n") + "\n");
}
