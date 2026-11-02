export const MAX_ROOM_MEMBERS = 200;

export interface RoomMember {
  name: string;
  pk: string;
}

export interface RoomMeta {
  name: string;
  members: RoomMember[];
  prev?: string;
  dm?: true;
  self?: true;
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
  owner?: boolean;
  active: boolean;
  sponsor?: { user?: string; handle?: string };
}

const isPerson = (s: Pick<Seat, "kind" | "owner">): boolean => s.owner === true || s.kind === "human";

export function personOf(s: Seat, seats: readonly Seat[]): string {
  if (!isPerson(s)) return `seat:${s.pk}`;
  if (s.sponsor?.user) return `person:${s.sponsor.user}`;
  const device = s.owner ? seats.find((x) => !x.owner && x.kind === "human" && x.sponsor?.user && x.sponsor.handle === s.name) : undefined;
  return device?.sponsor?.user ? `person:${device.sponsor.user}` : `seat:${s.pk}`;
}

function rootName(s: Seat, seats: readonly Seat[]): string {
  const handle = isPerson(s) ? s.sponsor?.handle : undefined;
  if (!handle || handle === s.name) return s.name;
  const base = seats.find((x) => x.name === handle);
  const person = personOf(s, seats);
  return base && person.startsWith("person:") && personOf(base, seats) === person ? handle : s.name;
}

export function rootOf(name: string, members: ReadonlyMap<string, Seat>): string {
  const seat = members.get(name);
  return seat ? rootName(seat, [...members.values()]) : name;
}

export function leaveSeal(known: { n: number; meta?: RoomMeta; leaving?: string[] } | undefined, opened: RoomMeta, n: number, members: ReadonlyMap<string, Seat>): boolean {
  if (!known?.meta || !known.leaving?.length || known.meta.dm || known.meta.self || opened.dm || opened.self) return false;
  if (n !== known.n + 1 || opened.name !== known.meta.name) return false;
  const staying = known.meta.members.filter((m) => !known.leaving?.includes(rootOf(m.name, members)));
  if (staying.length === known.meta.members.length || staying.length !== opened.members.length) return false;
  return staying.every((m) => opened.members.some((o) => o.name === m.name && o.pk === m.pk));
}

export function dmPair(meta: Pick<RoomMeta, "members">, sender: string, members: ReadonlyMap<string, Seat>): boolean {
  const seats = [...members.values()];
  const people = new Set<string>();
  for (const m of meta.members) {
    const seat = members.get(m.name);
    if (!seat || seat.pk !== m.pk || !isPerson(seat)) return false;
    people.add(rootName(seat, seats));
  }
  return people.size === 2 && people.has(rootOf(sender, members));
}

export function selfOnly(meta: Pick<RoomMeta, "members">, sender: string, members: ReadonlyMap<string, Seat>): boolean {
  const seats = [...members.values()];
  const mine = rootOf(sender, members);
  return (
    meta.members.length > 0 &&
    meta.members.every((m) => {
      const seat = members.get(m.name);
      return !!seat && seat.pk === m.pk && isPerson(seat) && rootName(seat, seats) === mine;
    })
  );
}

export function withSeats<P extends { name: string; pk: string }, S extends Seat>(seats: readonly S[], picked: readonly P[], pickOf: (s: S) => P): P[] {
  const byPk = new Map(seats.map((s) => [s.pk, s]));
  const people = new Set(
    picked.map((p) => {
      const s = byPk.get(p.pk);
      return s ? personOf(s, seats) : `seat:${p.pk}`;
    }),
  );
  const out = new Map(picked.map((p) => [p.pk, p]));
  for (const s of seats) if (s.active && isPerson(s) && people.has(personOf(s, seats)) && !out.has(s.pk)) out.set(s.pk, pickOf(s));
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
