const pending = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;

export const WRITE_DELAY_MS = 1000;

export function flushWrites(): void {
  clearTimeout(timer);
  timer = undefined;
  for (const [key, value] of pending) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // A private window or a full disk: this tab keeps what it holds in memory.
    }
  }
  pending.clear();
}

export function writeLater(key: string, value: string): void {
  pending.set(key, value);
  timer ??= setTimeout(flushWrites, WRITE_DELAY_MS);
}

export const pendingWrite = (key: string): string | undefined => pending.get(key);

export function dropWrite(key: string): void {
  pending.delete(key);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("pagehide", flushWrites);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushWrites();
  });
}
