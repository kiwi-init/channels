import type { RoomsSetting } from "@kiwi/core/client.ts"
import type { Member } from "@kiwi/core/membership.ts"
import type { FoldBase, GuardFloor } from "@kiwi/core/state.ts"

export interface Kept {
  roster: Member[]
  base: FoldBase | null
  guardFloor: GuardFloor | null
  roomsFloor: RoomsSetting | null
}

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)
const member = (x: unknown): x is Member => record(x) && typeof x.name === "string" && typeof x.pk === "string"

export function asKept(x: unknown): Kept | null {
  if (!record(x) || !Array.isArray(x.roster) || !x.roster.every(member)) return null
  const base = x.base === null ? null : record(x.base) && Number.isSafeInteger(x.base.n) && Array.isArray(x.base.members) ? (x.base as unknown as FoldBase) : undefined
  if (base === undefined) return null
  return {
    roster: x.roster,
    base,
    guardFloor: record(x.guardFloor) ? (x.guardFloor as unknown as GuardFloor) : null,
    roomsFloor: record(x.roomsFloor) ? (x.roomsFloor as unknown as RoomsSetting) : null,
  }
}
