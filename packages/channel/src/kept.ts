import { BASE_WIRE_VERSION, baseFromWire, toWire } from "@kiwi/core/base-wire.ts";
import type { RoomsSetting } from "@kiwi/core/client.ts";
import type { Member } from "@kiwi/core/membership.ts";
import type { FoldBase, GuardFloor } from "@kiwi/core/state.ts";

const KEPT_VERSION = 1;

export interface Kept {
  roster: Member[];
  base: FoldBase | null;
  guardFloor: GuardFloor | null;
  roomsFloor: RoomsSetting | null;
  near?: FoldBase | null;
  nearOpened?: boolean;
}

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const member = (x: unknown): x is Member => record(x) && typeof x.name === "string" && typeof x.pk === "string";

export function toKept(k: Kept): object {
  return {
    v: KEPT_VERSION,
    bv: BASE_WIRE_VERSION,
    roster: k.roster,
    base: k.base ? toWire(k.base) : null,
    guardFloor: k.guardFloor,
    roomsFloor: k.roomsFloor,
    ...(k.near ? { near: toWire(k.near) } : {}),
  };
}

export function asKept(x: unknown): Kept | null {
  if (!record(x) || x.v !== KEPT_VERSION || x.bv !== BASE_WIRE_VERSION || !Array.isArray(x.roster) || !x.roster.every(member)) return null;
  const base = x.base === null ? null : baseFromWire(x.base);
  if (x.base !== null && !base) return null;
  const near = x.near === undefined || x.near === null ? null : baseFromWire(x.near);
  return {
    roster: x.roster,
    base,
    ...(near && base && near.n >= base.n ? { near, nearOpened: x.nearOpened === true } : {}),
    guardFloor: record(x.guardFloor) ? (x.guardFloor as unknown as GuardFloor) : null,
    roomsFloor: record(x.roomsFloor) ? (x.roomsFloor as unknown as RoomsSetting) : null,
  };
}

export function nearUsable(kept: Kept | null): FoldBase | null {
  const near = kept?.near ?? null;
  return near && (kept?.nearOpened || !near.secret?.length) ? near : null;
}

export const keptBaseUpTo = (kept: Kept | null, head: number): FoldBase | null => (kept?.base && kept.base.n <= head ? kept.base : null);
