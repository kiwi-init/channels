import { seatRoot } from "@kiwi/core/room-rules.ts";
import { fullyTrusted, type ChannelState } from "@kiwi/core/state.ts";
import type { ChannelLink } from "./channel-ops.ts";

export const PRUNE_AFTER_MS = 60_000;

export function prunePlan(state: Pick<ChannelState, "rooms" | "members">, me: string): { now: string[]; later: string[] } {
  const members = [...state.members.values()];
  const active = new Set(members.filter((m) => m.active).map((m) => m.pk));
  const owner = members.find((m) => m.owner);
  const now: string[] = [];
  const later: string[] = [];
  for (const room of state.rooms.values()) {
    if (!room.members?.some((m) => m.pk === me)) continue;
    const roots = new Set(
      room.members.map((m) => {
        const seat = members.find((x) => x.pk === m.pk);
        return seat ? seatRoot(seat) : m.name;
      }),
    );
    const inIt = new Set(room.members.map((m) => m.pk));
    const newSeat = members.some((s) => s.active && s.kind === "human" && roots.has(seatRoot(s)) && !inIt.has(s.pk));
    if (!newSeat && room.members.every((m) => active.has(m.pk))) continue;
    const managers = room.members.filter((m) => active.has(m.pk) && (m.pk === owner?.pk || fullyTrusted(members.find((x) => x.pk === m.pk))));
    if (!managers.some((m) => m.pk === me)) continue;
    const rotator = managers.find((m) => m.pk === owner?.pk) ?? [...managers].sort((a, b) => (a.pk < b.pk ? -1 : 1))[0];
    (rotator?.pk === me ? now : later).push(room.id);
  }
  return { now, later };
}

const later = new WeakMap<ChannelLink, ReturnType<typeof setTimeout>>();
const busy = new WeakSet<ChannelLink>();

function pruneNow(ch: ChannelLink, ids: readonly string[]): void {
  if (!ids.length || busy.has(ch)) return;
  busy.add(ch);
  ch.pruneRooms(ids)
    .catch(() => [])
    .finally(() => busy.delete(ch));
}

export function prune(ch: ChannelLink, state: () => Pick<ChannelState, "rooms" | "members">): void {
  clearTimeout(later.get(ch));
  const plan = prunePlan(state(), ch.pk);
  if (plan.later.length)
    later.set(
      ch,
      setTimeout(() => pruneNow(ch, prunePlan(state(), ch.pk).later), PRUNE_AFTER_MS),
    );
  pruneNow(ch, plan.now);
}

export function stopPruning(ch: ChannelLink): void {
  clearTimeout(later.get(ch));
}
