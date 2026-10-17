import * as Context from "effect/Context";
import type { GoneHow } from "../../protocol.ts";

export interface Effects {
  broadcast?: string[];
  others?: string;
  ephemeral?: string;
  watch?: string[];
  reply?: string | string[];
  readers?: string[];
  disconnect?: { pk: string; how: GoneHow };
  wipe?: boolean;
  directory?: DirectoryUpdate[];
  expireAt?: number;
}

export interface DirectoryEntry {
  room: string;
  code: string;
  owner: boolean;
  member: boolean;
  agents: number;
  at: number;
}

export interface DirectoryUpdate {
  user: string;
  room: string;
  entry: DirectoryEntry | null;
}

export class Directory extends Context.Service<
  Directory,
  {
    list(user: string): Promise<DirectoryEntry[]>;
    reserve(user: string, room: string, most: number): Promise<boolean>;
    release(user: string, room: string): Promise<void>;
  }
>()("kiwi/relay/Directory") {}

export const HOLD_MS = 10 * 60_000;

export const holdEntry = (room: string, now: number): DirectoryEntry => ({ room, code: "", owner: true, member: true, agents: 0, at: now });
const isHold = (e: DirectoryEntry) => e.code === "";

export function reserveSlot(entries: DirectoryEntry[], room: string, most: number, now: number): { ok: boolean; stale: string[] } {
  const stale = entries.filter((e) => isHold(e) && e.room !== room && now - e.at > HOLD_MS).map((e) => e.room);
  const live = entries.filter((e) => e.owner && !stale.includes(e.room));
  return { ok: live.some((e) => e.room === room) || live.length < most, stale };
}

export const releasable = (e: DirectoryEntry | undefined) => !!e && isHold(e);
