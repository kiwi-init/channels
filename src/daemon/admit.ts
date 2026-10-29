import { admitOwn, type Admitted } from "@kiwi/core/client/delegate.ts";
import type { Identity } from "@kiwi/core/identity.ts";

const EVERY_MS = 1_500;
const GRACE_MS = 15_000;
const LONGEST_MS = 30 * 60_000;

export interface AdmitRoom {
  relay: string;
  roomId: string;
  ownerPk: string;
}

interface Watch extends AdmitRoom {
  since: number;
  until: number;
  busy: boolean;
}

export interface Admitter {
  watch(room: AdmitRoom, graceMs?: number): void;
  watching(): number;
  stop(): void;
}

export interface AdmitterOptions {
  everyMs?: number;
  graceMs?: number;
  longestMs?: number;
  admit?: (relay: string, roomId: string, ownerPk: string, machine: Identity) => Promise<Admitted>;
}

const ROOM_RE = /^[0-9a-f]{32}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

export function readAdmitRoom(params: Record<string, unknown>): AdmitRoom | null {
  const { relay, room, owner } = params;
  if (typeof relay !== "string" || !/^https?:\/\//.test(relay) || typeof room !== "string" || !ROOM_RE.test(room) || typeof owner !== "string" || !KEY_RE.test(owner)) return null;
  return { relay, roomId: room, ownerPk: owner };
}

export function startAdmitter(machine: () => Identity | null, opts: AdmitterOptions = {}): Admitter {
  const everyMs = opts.everyMs ?? EVERY_MS;
  const graceMs = opts.graceMs ?? GRACE_MS;
  const longestMs = opts.longestMs ?? LONGEST_MS;
  const admit = opts.admit ?? admitOwn;
  const rooms = new Map<string, Watch>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const pass = async (key: string, w: Watch): Promise<void> => {
    const id = machine();
    if (!id?.xsk) {
      rooms.delete(key);
      return;
    }
    w.busy = true;
    try {
      const { waiting } = await admit(w.relay, w.roomId, w.ownerPk, id);
      const now = Date.now();
      if (waiting > 0 && now - w.since < longestMs) w.until = Math.max(w.until, now + everyMs * 2);
    } catch {
      // A relay that is down or refuses: the next poke, request frame or pass in the window tries again.
    } finally {
      w.busy = false;
    }
    if (Date.now() >= w.until && rooms.get(key) === w) rooms.delete(key);
  };

  const tick = async (): Promise<void> => {
    timer = null;
    if (stopped) return;
    await Promise.all([...rooms].filter(([, w]) => !w.busy).map(([key, w]) => pass(key, w)));
    if (!stopped && rooms.size && !timer) timer = setTimeout(() => void tick(), everyMs);
  };

  return {
    watch(room, grace = graceMs) {
      if (stopped) return;
      const key = `${room.relay} ${room.roomId}`;
      const now = Date.now();
      const w = rooms.get(key);
      if (w && w.ownerPk === room.ownerPk) {
        w.since = now;
        w.until = Math.max(w.until, now + grace);
      } else rooms.set(key, { ...room, since: now, until: now + grace, busy: false });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void tick(), 0);
    },
    watching: () => rooms.size,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      rooms.clear();
    },
  };
}
