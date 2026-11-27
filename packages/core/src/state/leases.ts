import { thawed, type Frozen } from "./types.ts";
import type { Lease } from "./types.ts";

export const LEASE_WAIT_MS = 2 * 3_600_000;

type InLine = Lease["queue"][number];

export type LeftLine = (entry: Frozen<InLine>, at: number) => void;

function expire(queue: InLine[], at: number, left: LeftLine | undefined): InLine[] {
  const kept = queue.filter((q) => q.joined + LEASE_WAIT_MS > at);
  if (left) for (const q of queue) if (!kept.includes(q)) left(q, q.joined + LEASE_WAIT_MS);
  return kept;
}

export function settle(lease: Lease, t: number, left?: LeftLine): void {
  while (lease.holder && lease.until <= t) {
    const ended = lease.until;
    lease.queue = expire(lease.queue, ended, left);
    const next = lease.queue.shift();
    if (!next) {
      lease.holder = undefined;
      lease.note = undefined;
      break;
    }
    left?.(next, ended);
    lease.holder = next.name;
    lease.note = next.note;
    lease.since = ended;
    lease.until = ended + next.ttl;
  }
  lease.queue = expire(lease.queue, t, left);
}

export function take(lease: Lease, who: string, ttl: number, at: number, note: string | undefined, task?: number, left?: LeftLine): void {
  settle(lease, at, left);
  const queued = lease.queue.find((q) => q.name === who);
  if (!lease.holder || lease.holder === who) {
    if (lease.holder !== who) lease.since = at;
    lease.holder = who;
    lease.until = at + ttl;
    lease.note = note;
    if (queued) left?.(queued, at);
    lease.queue = lease.queue.filter((q) => q.name !== who);
    return;
  }
  if (!queued) {
    lease.queue.push({ name: who, ttl, joined: at, ...(note !== undefined ? { note } : {}), ...(task !== undefined ? { task } : {}) });
    return;
  }
  if (queued.task !== undefined && queued.task !== task) left?.({ ...queued }, at);
  Object.assign(queued, { ttl, ...(note !== undefined ? { note } : {}) });
  if (task === undefined) delete queued.task;
  else queued.task = task;
}

export function free(lease: Lease, who: string, at: number, breaking: boolean, left?: LeftLine): boolean {
  settle(lease, at, left);
  if (lease.holder && (lease.holder === who || breaking)) {
    lease.until = at;
    settle(lease, at, left);
    return true;
  }
  const leaving = lease.queue.find((q) => q.name === who);
  if (!leaving) return false;
  left?.(leaving, at);
  lease.queue = lease.queue.filter((q) => q !== leaving);
  return true;
}

export function leftAt(lease: Frozen<Lease>, who: string, now: number): number | undefined {
  let left: number | undefined;
  settle(thawed<Lease>(lease), now, (q, at) => {
    if (q.name === who) left = at;
  });
  return left;
}

export function nextIn(lease: Frozen<Lease>, at: number): string | undefined {
  return lease.queue.find((q) => q.joined + LEASE_WAIT_MS > at)?.name;
}

export function placeIn(lease: Frozen<Lease>, who: string): number {
  return lease.queue.findIndex((q) => q.name === who) + 1;
}
