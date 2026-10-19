import { readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STALE_MS = 30_000;
const UNWRITTEN_MS = 2_000;
const WAIT_MS = 5_000;

export function lockPath(dir: string): string {
  return join(dir, "daemon.lock");
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function holder(path: string): { pid: number | null; age: number } | null {
  try {
    const age = Date.now() - statSync(path).mtimeMs;
    const pid = Number(readFileSync(path, "utf8").trim());
    return { pid: Number.isInteger(pid) && pid > 0 ? pid : null, age };
  } catch {
    return null;
  }
}

export function ownsLock(path: string): boolean {
  return holder(path)?.pid === process.pid;
}

export function beatLock(path: string): boolean {
  if (!ownsLock(path)) return false;
  try {
    const now = new Date();
    utimesSync(path, now, now);
  } catch {
    // A missed beat only ages the lock; the next tick beats again.
  }
  return true;
}

export function dropLock(path: string): void {
  if (ownsLock(path)) rmSync(path, { force: true });
}

export async function takeLock(path: string): Promise<void> {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    try {
      writeFileSync(path, String(process.pid), { flag: "wx", mode: 0o600 });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const h = holder(path);
    if (h?.pid === process.pid) return;
    const busy = h !== null && (h.pid === null ? h.age < UNWRITTEN_MS : running(h.pid) && h.age < STALE_MS);
    if (busy) {
      if (Date.now() > until) throw new Error(`another kiwi daemon${h.pid ? ` (pid ${h.pid})` : ""} holds ${path}`);
      await Bun.sleep(100);
      continue;
    }
    if (h?.pid && running(h.pid)) {
      try {
        process.kill(h.pid, "SIGKILL");
      } catch {
        // It exited between the check and the kill: the lock is free either way.
      }
    }
    rmSync(path, { force: true });
  }
}
