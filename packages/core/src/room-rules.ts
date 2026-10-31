export const MAX_ROOM_MEMBERS = 200;

export interface RoomMember {
  name: string;
  pk: string;
}

export interface RoomMeta {
  name: string;
  members: RoomMember[];
  prev?: string;
}

export interface RoomSeal {
  id: string;
  n: number;
  keys: string[];
  meta: { iv: string; ct: string };
  proof?: string;
}

export interface RoomLetter {
  room: string;
  n: number;
  iv: string;
  ct: string;
}

export interface RoomNow {
  n: number;
  key?: string;
  meta?: RoomMeta;
}

export const inRoom = (meta: Pick<RoomMeta, "members">, name: string, pk: string | undefined): boolean => !!pk && meta.members.some((m) => m.name === name && m.pk === pk);

export const publicView = <M extends { sealed?: unknown; opened?: unknown; proven?: unknown }>(messages: readonly M[]): M[] =>
  messages.flatMap((m) => (m.sealed ? [] : m.opened || m.proven !== undefined ? [Object.fromEntries(Object.entries(m).filter(([k]) => k !== "opened" && k !== "proven")) as M] : [m]));
