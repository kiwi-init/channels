import { GENERAL_ROOM } from "../protocol.ts";
import type { RoomMember } from "../room-rules.ts";
import { placeKey } from "../state/places.ts";
import type { Place } from "../state/types.ts";

export type DocWhere = Place | { kind: "room"; room: string };

export const docThread = (w: DocWhere): string => (w.kind === "room" ? (w.room === GENERAL_ROOM ? "main" : `room:${w.room}`) : placeKey(w));

interface KnownRoom {
  members?: readonly RoomMember[];
  dm?: boolean;
}

export interface RoomsHere {
  isPublic: (id: string) => boolean;
  members: (id: string) => KnownRoom | undefined;
  all: () => Iterable<[string, KnownRoom]>;
}

export function privateRoomOf(thread: string, rooms: RoomsHere): string | null {
  const room = /^room:(.+)$/.exec(thread)?.[1];
  if (room) {
    if (rooms.members(room)?.members) return room;
    if (room === GENERAL_ROOM || rooms.isPublic(room)) return null;
    throw new Error(`this app doesn't know room ${room} yet`);
  }
  const pair = /^dm:([^~]+)~([^~]+)$/.exec(thread);
  if (!pair) return null;
  const want = [pair[1]!, pair[2]!].sort().join("~");
  for (const [id, r] of rooms.all()) {
    if (!r.dm || !r.members) continue;
    if (
      r.members
        .map((m) => m.name)
        .sort()
        .join("~") === want
    )
      return id;
  }
  throw new Error(`no direct-message room between ${pair[1]} and ${pair[2]} yet`);
}
