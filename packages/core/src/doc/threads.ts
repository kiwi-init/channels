import { GENERAL_ROOM } from "../protocol.ts";
import type { RoomMember } from "../room-rules.ts";
import { placeKey } from "../state/places.ts";
import type { Place } from "../state/types.ts";
import type { ThreadKeys } from "./hub.ts";

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

export interface RoomKeysHere {
  rooms: RoomsHere;
  keyed: (room: string) => boolean;
  roomKeys: (room: string) => string[];
  epoch: () => number;
}

export function docKeysFor(thread: string, here: RoomKeysHere, channel: ThreadKeys): ThreadKeys {
  const room = privateRoomOf(thread, here.rooms);
  if (!room) return channel;
  if (!here.keyed(room))
    return {
      ...channel,
      current: async () => {
        if (here.keyed(room)) throw new Error(`room ${room} has its own key now; open its doc again`);
        return channel.current();
      },
    };
  return {
    sealed: true,
    current: async () => {
      const key = here.roomKeys(room)[0];
      if (!key) throw new Error(`no key for room ${room} on this computer`);
      return { key, e: here.epoch() };
    },
    opening: async () => here.roomKeys(room),
  };
}
