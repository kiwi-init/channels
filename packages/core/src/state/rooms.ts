import { inlineText } from "../membership.ts";
import { GENERAL_ROOM, MAX_ROOM_NAME, type Message } from "../protocol.ts";
import type { ChannelState, Room } from "./types.ts";

export const roomOfMessage = (state: Pick<ChannelState, "roomOf">, m: Pick<Message, "seq" | "room">): string => state.roomOf.get(m.seq) ?? m.room ?? GENERAL_ROOM;

export function roomName(name: unknown): string {
  return inlineText(name, MAX_ROOM_NAME);
}

export function findRoom(state: ChannelState, nameOrId: string): Room | null {
  const t = nameOrId.trim().replace(/^#/, "");
  return state.rooms.get(t) ?? [...state.rooms.values()].find((r) => r.name.toLowerCase() === t.toLowerCase()) ?? null;
}

export function newRoomId(): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => abc[b % abc.length]).join("");
}
