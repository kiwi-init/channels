import { BASE_WIRE_VERSION, baseFromWire, readableWire, toWire } from "@kiwi/core/base-wire.ts";
import type { RoomsSetting } from "@kiwi/core/client.ts";
import type { Member } from "@kiwi/core/membership.ts";
import type { FoldBase, GuardFloor } from "@kiwi/core/state.ts";

const KEPT_VERSION = 1;
const DOC_LINES = 40;
const DOC_THREADS = 30;

export interface DocLine {
  id: string;
  author: string;
  at: number;
  text: string;
}

export type DocLines = Readonly<Record<string, readonly DocLine[]>>;

export interface Kept {
  roster: Member[];
  base: FoldBase | null;
  guardFloor: GuardFloor | null;
  roomsFloor: RoomsSetting | null;
  docLines: DocLines;
}

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const member = (x: unknown): x is Member => record(x) && typeof x.name === "string" && typeof x.pk === "string";
const docLine = (x: unknown): x is DocLine => record(x) && typeof x.id === "string" && typeof x.author === "string" && Number.isFinite(x.at) && typeof x.text === "string";
const bare = (l: DocLine): DocLine => ({ id: l.id, author: l.author, at: l.at, text: l.text });

export function docLinesOf(x: unknown): DocLines {
  if (!record(x)) return {};
  return Object.fromEntries(
    Object.entries(x)
      .slice(0, DOC_THREADS)
      .flatMap(([thread, lines]) => (Array.isArray(lines) && lines.every(docLine) && lines.length ? [[thread, lines.slice(-DOC_LINES).map(bare)]] : [])),
  );
}

const sameLine = (x: DocLine, y: DocLine | undefined): boolean => !!y && x.id === y.id && x.author === y.author && x.at === y.at && x.text === y.text;
const sameLines = (a: readonly DocLine[], b: readonly DocLine[]): boolean => a.length === b.length && a.every((x, i) => sameLine(x, b[i]));

export function withDocLines(all: DocLines, thread: string, lines: readonly DocLine[]): DocLines {
  const next = lines.slice(-DOC_LINES).map(bare);
  const was = all[thread];
  if (was ? sameLines(was, next) : !next.length) return all;
  const rest = Object.entries(all).filter(([t]) => t !== thread);
  return Object.fromEntries((next.length ? [[thread, next] as const, ...rest] : rest).slice(0, DOC_THREADS));
}

export function toKept(k: Kept): object {
  return { v: KEPT_VERSION, bv: BASE_WIRE_VERSION, roster: k.roster, base: k.base ? toWire(k.base) : null, guardFloor: k.guardFloor, roomsFloor: k.roomsFloor, docLines: k.docLines };
}

export function asKept(x: unknown): Kept | null {
  if (!record(x) || x.v !== KEPT_VERSION || !readableWire(x.bv) || !Array.isArray(x.roster) || !x.roster.every(member)) return null;
  const base = x.base === null ? null : baseFromWire(x.base);
  if (x.base !== null && !base) return null;
  return {
    roster: x.roster,
    base,
    guardFloor: record(x.guardFloor) ? (x.guardFloor as unknown as GuardFloor) : null,
    roomsFloor: record(x.roomsFloor) ? (x.roomsFloor as unknown as RoomsSetting) : null,
    docLines: docLinesOf(x.docLines),
  };
}

export const keptBaseUpTo = (kept: Kept | null, head: number): FoldBase | null => (kept?.base && kept.base.n <= head ? kept.base : null);
