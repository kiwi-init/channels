import type { Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type GuardFloor, type Roster } from "@kiwi/core/state.ts";
import type { RoomsSetting } from "@kiwi/core/client.ts";

const slackOf = (keep: number): number => Math.max(50, keep >> 2);

export function trimmed(
  messages: readonly Message[],
  roster: Roster,
  now: number,
  rooms: RoomsSetting | null,
  guard: GuardFloor | null,
  base: FoldBase | null,
  keep: number,
  slack = slackOf(keep),
): FoldBase | null {
  if (messages.length <= keep + slack) return null;
  let next: FoldBase | null = null;
  fold(messages.slice(0, messages.length - keep), roster, now, rooms, guard, base, (b) => (next = b));
  return next;
}
