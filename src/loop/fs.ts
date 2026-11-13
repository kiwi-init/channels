import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";

const TAIL_BYTES = 64 * 1024;

export function names(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    // No rollout written on that day yet.
    return [];
  }
}

export function holds(file: string, nonce: string): boolean {
  try {
    return readFileSync(file, "utf8").includes(nonce);
  } catch {
    // Gone or unreadable between the listing and the read: not this launch's thread.
    return false;
  }
}

export function tailLines(file: string): string[] {
  let fd: number | null = null;
  try {
    const size = statSync(file).size;
    const from = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - from);
    fd = openSync(file, "r");
    readSync(fd, buf, 0, buf.length, from);
    const lines = buf.toString("utf8").split("\n");
    return from > 0 ? lines.slice(1) : lines;
  } catch {
    // No update stream yet: nothing to read a turn from.
    return [];
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
