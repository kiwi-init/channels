export const utcDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export function untilUtcMidnight(ts: number): string {
  const d = new Date(ts);
  const left = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - ts;
  const h = Math.floor(left / 3_600_000);
  const m = Math.ceil((left % 3_600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function formatBytes(n: number): string {
  return n >= 1024 ** 3 ? `${+(n / 1024 ** 3).toFixed(1)} GB` : `${+(n / 1024 ** 2).toFixed(1)} MB`;
}

export const MESSAGES_PER_MINUTE = 120;
export const MORE_PER_MINUTE = 60;
export const EPHEMERAL_PER_MINUTE = 60;
const MAX_WINDOWS = 10_000;
const windows = new Map<string, { start: number; n: number }>();

export function allow(key: string, limit: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start > 60_000) {
    windows.delete(key);
    windows.set(key, { start: now, n: 1 });
    while (windows.size > MAX_WINDOWS) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      windows.delete(oldest);
    }
    return true;
  }
  return ++w.n <= limit;
}

export const MAX_PENDING = 20;

export const READS_PER_MINUTE = 60;
export const BLOBS_PER_MINUTE = 120;
export const REQUEST_TTL_MS = 60 * 60_000;
