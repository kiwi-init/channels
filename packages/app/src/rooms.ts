import { GENERAL_ROOM, MAX_ROOMS, type Message } from "@kiwi/core/protocol.ts";
import { MAIN } from "@kiwi/core/state.ts";
import { roomName, roomOfMessage } from "@kiwi/core/state/rooms.ts";
import type { ChannelState, Room } from "@kiwi/core/state/types.ts";

export interface RoomEntry {
  id: string;
  name: string;
}

export const cleanRoomName = (typed: string): string => roomName(typed.replace(/^[#\s]+/, ""));

export type RoomProblem = { kind: "unnamed" } | { kind: "taken"; name: string } | { kind: "full"; max: number };

export function roomProblem(rooms: Iterable<Pick<Room, "id" | "name">>, typed: string, renaming?: string): RoomProblem | null {
  const name = cleanRoomName(typed);
  const all = [...rooms];
  if (!name) return { kind: "unnamed" };
  if (all.some((r) => r.id !== renaming && r.name.toLowerCase() === name.toLowerCase())) return { kind: "taken", name };
  if (!renaming && all.length >= MAX_ROOMS) return { kind: "full", max: MAX_ROOMS };
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
