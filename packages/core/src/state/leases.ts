import type { Lease } from "./types.ts";

export const LEASE_WAIT_MS = 2 * 3_600_000;

export function settle(lease: Lease, t: number): void {
  while (lease.holder && lease.until <= t) {
    const ended = lease.until;
    lease.queue = lease.queue.filter((q) => q.joined + LEASE_WAIT_MS > ended);
    const next = lease.queue.shift();
    if (!next) {
      lease.holder = undefined;
      lease.note = undefined;
      break;
    }
    lease.holder = next.name;
    lease.note = next.note;
    lease.since = ended;
    lease.until = ended + next.ttl;
  }
  lease.queue = lease.queue.filter((q) => q.joined + LEASE_WAIT_MS > t);
}

export function take(lease: Lease, who: string, ttl: number, at: number, note: string | undefined): void {
  settle(lease, at);
  if (!lease.holder || lease.holder === who) {
    if (lease.holder !== who) lease.since = at;
    lease.holder = who;
    lease.until = at + ttl;
    lease.note = note;
    lease.queue = lease.queue.filter((q) => q.name !== who);
    return;
  }
  const queued = lease.queue.find((q) => q.name === who);
  if (queued) Object.assign(queued, { ttl, ...(note !== undefined ? { note } : {}) });
  else lease.queue.push({ name: who, ttl, joined: at, ...(note !== undefined ? { note } : {}) });
}

export function free(lease: Lease, who: string, at: number, breaking: boolean): boolean {
  settle(lease, at);
  if (lease.holder && (lease.holder === who || breaking)) {
    lease.until = at;
    settle(lease, at);
    return true;
  }
  const before = lease.queue.length;
  lease.queue = lease.queue.filter((q) => q.name !== who);
  return lease.queue.length < before;
}

export function nextIn(lease: Lease, at: number): string | undefined {
  return lease.queue.find((q) => q.joined + LEASE_WAIT_MS > at)?.name;
}

export function placeIn(lease: Lease, who: string): number {
  return lease.queue.findIndex((q) => q.name === who) + 1;
}
