import { inlineText } from "../membership.ts";
import { MAX_ROOM_NAME } from "../protocol.ts";
import type { ChannelState, Room } from "./types.ts";

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
