import type { Personality } from "@kiwi/core/personality.ts";

import type { ChannelIdentityView, ComputerView, PendingItem, PersonView } from "../../../desktop/src/bridge.ts";

export interface Local {
  person: PersonView | null;
  channels: ChannelIdentityView[];
  computers: ComputerView[];
  pending: PendingItem[];
  personalities: Personality[];
}

const LOCAL_KEY = "kiwi.secrets";
const listeners = new Set<(l: Local) => void>();

export const CHECKS_PREFIX = "mc.checks.";
export const RECORD_PREFIX = "mc.rec.";
export const MEMBER_PREFIX = "mc.member.";
export const PENDING_PREFIX = "mc.pending.";
export const CHANNELS_KEY = "mc.channels";

export function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

export function readLocal(): Local {
  const v = read<Partial<Local>>(LOCAL_KEY);
  return { person: v?.person ?? null, channels: v?.channels ?? [], computers: v?.computers ?? [], pending: v?.pending ?? [], personalities: Array.isArray(v?.personalities) ? v.personalities : [] };
}

export function writeLocal(patch: Partial<Local>): Local {
  const next = { ...readLocal(), ...patch };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
  for (const l of listeners) l(next);
  return next;
}

export function sweepBrowserKeys(): void {
  if (typeof localStorage === "undefined") return;
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k === LOCAL_KEY || k === CHANNELS_KEY || k?.startsWith(CHECKS_PREFIX) || k?.startsWith(RECORD_PREFIX) || k?.startsWith(MEMBER_PREFIX) || k?.startsWith(PENDING_PREFIX)) stale.push(k);
  }
  for (const k of stale) localStorage.removeItem(k);
}

export function onLocalChange(cb: (l: Local) => void): void {
  listeners.add(cb);
}
