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

export function onLocalChange(cb: (l: Local) => void): void {
  listeners.add(cb);
}
