import { MAX_WAKE } from "./push.ts";
import { isPerson, personOf } from "./room-rules.ts";
import { answersDecisions } from "./state/people.ts";
import type { ChannelState } from "./state/types.ts";

export interface WakeSend {
  to?: readonly string[];
  esc?: boolean;
  kind?: string;
  ev?: unknown;
  permission?: unknown;
  handoff?: unknown;
  step?: unknown;
}

export function wakeList(state: Pick<ChannelState, "members">, me: string, s: WakeSend): string[] {
  if (!s.esc || s.kind === "event" || s.ev !== undefined) return [];
  const { members } = state;
  const named = new Set<string>(s.to ?? []);
  if (!s.handoff && !s.permission && !s.step) for (const m of members.values()) if (answersDecisions(members, m.name)) named.add(m.name);
  const seats = [...members.values()];
  const mine = members.get(me);
  const people = new Set<string>();
  for (const name of named) {
    const seat = members.get(name);
    if (seat?.active && isPerson(seat)) people.add(personOf(seat, seats));
  }
  if (mine) people.delete(personOf(mine, seats));
  return seats
    .filter((x) => x.active && isPerson(x) && x.name !== me && people.has(personOf(x, seats)))
    .map((x) => x.pk)
    .slice(0, MAX_WAKE);
}
