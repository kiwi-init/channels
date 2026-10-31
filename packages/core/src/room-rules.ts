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

export interface Seat {
  name: string;
  pk: string;
  kind?: string;
  active: boolean;
  sponsor?: { handle?: string };
}

export const seatRoot = (m: Pick<Seat, "name" | "kind" | "sponsor">): string => (m.kind === "human" && m.sponsor?.handle ? m.sponsor.handle : m.name);

export function withSeats<P extends { name: string; pk: string }, S extends Seat>(seats: readonly S[], picked: readonly P[], pickOf: (s: S) => P): P[] {
  const byPk = new Map(seats.map((s) => [s.pk, s]));
  const roots = new Set(
    picked.map((p) => {
      const s = byPk.get(p.pk);
      return s ? seatRoot(s) : p.name;
    }),
  );
  const out = new Map(picked.map((p) => [p.pk, p]));
  for (const s of seats) if (s.active && s.kind === "human" && roots.has(seatRoot(s)) && !out.has(s.pk)) out.set(s.pk, pickOf(s));
  return [...out.values()];
}

export const inRoom = (meta: Pick<RoomMeta, "members">, name: string, pk: string | undefined): boolean => !!pk && meta.members.some((m) => m.name === name && m.pk === pk);

export const publicView = <M extends { sealed?: unknown; opened?: unknown; proven?: unknown }>(messages: readonly M[]): M[] =>
  messages.flatMap((m) => (m.sealed ? [] : m.opened || m.proven !== undefined ? [Object.fromEntries(Object.entries(m).filter(([k]) => k !== "opened" && k !== "proven")) as M] : [m]));

export type RoomReadiness = "ready" | "old" | "unseen";

export function roomReadiness(signed: Readonly<Record<string, number>> | undefined, live: readonly number[], needs: number): RoomReadiness {
  if (live.some((v) => v >= needs)) return "ready";
  const known = Object.values(signed ?? {}).filter((v) => v > 0);
  if (known.some((v) => v < needs)) return "old";
  return known.length ? "ready" : "unseen";
}
