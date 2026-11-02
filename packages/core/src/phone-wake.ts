import { mentionsOf } from "./changes.ts";
import { GENERAL_ROOM } from "./protocol.ts";
import { MAX_WAKE } from "./push.ts";
import { isPerson, personOf, rootOf } from "./room-rules.ts";
import { answersDecisions } from "./state/people.ts";
import { dmPlace, MAIN } from "./state/places.ts";
import type { ChannelState, Place } from "./state/types.ts";

export interface WakeSend {
  to?: readonly string[];
  room?: string;
  dm?: boolean;
  esc?: boolean;
  kind?: string;
  task?: number;
  re?: readonly number[];
  ev?: unknown;
  permission?: unknown;
  handoff?: unknown;
  step?: unknown;
}

export function wakeList(state: Pick<ChannelState, "members" | "lead" | "roomOf" | "placeOf">, me: string, body: string, s: WakeSend): string[] {
  if (s.kind === "event" || s.ev !== undefined) return [];
  const { members } = state;
  const parent = s.re?.[0];
  const room = (parent !== undefined ? state.roomOf.get(parent) : undefined) ?? s.room ?? GENERAL_ROOM;
  const to = s.to?.length === 1 ? s.to[0] : undefined;
  const pair = s.dm && to && members.has(to) ? ([rootOf(me, members), rootOf(to, members)] as const) : null;
  const place: Place =
    (parent !== undefined ? state.placeOf.get(parent) : undefined) ?? (s.task !== undefined ? { kind: "task", task: s.task } : pair && pair[0] !== pair[1] ? dmPlace(pair[0], pair[1]) : MAIN);
  const named = new Set<string>();
  if (place.kind === "main" && room === GENERAL_ROOM) for (const n of [...(s.to ?? []), ...mentionsOf(body)]) named.add(n);
  const lead = state.lead ? rootOf(state.lead, members) : null;
  if (place.kind === "dm" && lead && place.with.includes(lead)) for (const n of place.with) if (n !== lead) named.add(n);
  if (s.esc) {
    for (const n of s.to ?? []) named.add(n);
    if (!s.handoff && !s.permission && !s.step) for (const m of members.values()) if (answersDecisions(members, m.name)) named.add(m.name);
  }
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
