import { GENERAL_ROOM, MAX_ROOMS, type Message } from "@kiwi/core/protocol.ts";
import type { Unread } from "@kiwi/core/standup.ts";
import { MAIN } from "@kiwi/core/state.ts";
import { roomName, roomOfMessage } from "@kiwi/core/state/rooms.ts";
import type { ChannelState, Room } from "@kiwi/core/state/types.ts";
import { visible } from "@kiwi/core/work.ts";

export interface RoomEntry {
  id: string;
  name: string;
}

export const cleanRoomName = (typed: string): string => roomName(typed.replace(/^[#\s]+/, ""));

export function roomProblem(rooms: Iterable<Pick<Room, "id" | "name">>, typed: string, renaming?: string): string | null {
  const name = cleanRoomName(typed);
  const all = [...rooms];
  if (!name) return "A room needs a name";
  if (all.some((r) => r.id !== renaming && r.name.toLowerCase() === name.toLowerCase())) return `A room is already called #${name}`;
  if (!renaming && all.length >= MAX_ROOMS) return `A channel holds at most ${MAX_ROOMS} rooms`;
  return null;
}

export function roomsAfter(rooms: Iterable<Pick<Room, "id" | "name">>, change: RoomEntry): RoomEntry[] {
  const next = new Map([...rooms].map((r) => [r.id, { id: r.id, name: r.name }]));
  next.set(change.id, { id: change.id, name: change.name });
  return [...next.values()];
}

export { roomOfMessage };

export const roomSeenKey = (id: string): string => (id === GENERAL_ROOM ? "main" : `room:${id}`);

const inMain = (state: Pick<ChannelState, "placeOf">, m: Pick<Message, "seq">): boolean => (state.placeOf.get(m.seq) ?? MAIN).kind === "main";

export function roomLast(state: Pick<ChannelState, "placeOf" | "roomOf">, messages: readonly Message[]): Map<string, number> {
  const last = new Map<string, number>();
  for (const m of messages) if (inMain(state, m)) last.set(roomOfMessage(state, m), m.seq);
  return last;
}

export function roomUnread(state: ChannelState, messages: readonly Message[], viewer: string, seen: Readonly<Record<string, number>>, from: number): (id: string) => Unread {
  const counts = new Map<string, number>();
  for (const m of messages) {
    if (m.kind === "event" || m.from === viewer || !inMain(state, m) || !visible(state, m)) continue;
    const id = roomOfMessage(state, m);
    if (m.seq > (seen[roomSeenKey(id)] ?? (id === GENERAL_ROOM ? 0 : from))) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return (id) => {
    const n = counts.get(id) ?? 0;
    return { n, forMe: n > 0 };
  };
}
