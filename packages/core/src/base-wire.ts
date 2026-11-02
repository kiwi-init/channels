import { outgrown, type Trust } from "./protocol.ts";
import type { FoldBase, Place } from "./state.ts";

export const BASE_WIRE_VERSION = 7;

const LISTS = [
  "members",
  "scopesByKey",
  "scopeSets",
  "roleSets",
  "tasks",
  "facts",
  "leases",
  "reactions",
  "reactSeqs",
  "chatBy",
  "edits",
  "deleted",
  "rejected",
  "asks",
  "answered",
  "threadPeople",
  "rooms",
] as const;

interface Column<V> {
  d: number[];
  v: V[];
}

type Wire = Omit<FoldBase, "trust" | "threadOf" | "roomOf" | "placeOf" | "oldSent"> & {
  trust: Column<Trust>;
  threadOf: Column<number>;
  roomOf: Column<string>;
  placeOf: Column<Place>;
  oldSent?: Column<number>;
};

function column<V>(pairs: [number, V][]): Column<V> {
  let last = 0;
  return {
    d: pairs.map(([k]) => {
      const step = k - last;
      last = k;
      return step;
    }),
    v: pairs.map(([, v]) => v),
  };
}

function pairs<V>(c: Column<V>): [number, V][] {
  if (!Array.isArray(c?.d) || !Array.isArray(c.v) || c.d.length !== c.v.length) throw new Error("bad column");
  let last = 0;
  return c.d.map((step, i): [number, V] => {
    last += step;
    return [last, c.v[i]!];
  });
}

export const toWire = ({ oldSent, ...b }: FoldBase): Wire => ({
  ...b,
  trust: column(b.trust),
  threadOf: column(b.threadOf.map(([seq, root]): [number, number] => [seq, seq - root])),
  roomOf: column(b.roomOf),
  placeOf: column(b.placeOf),
  ...(oldSent ? { oldSent: column(oldSent) } : {}),
});

export function fromWire({ oldSent, ...w }: Wire): FoldBase {
  return {
    ...w,
    trust: pairs(w.trust),
    threadOf: pairs(w.threadOf).map(([seq, back]): [number, number] => [seq, seq - back]),
    roomOf: pairs(w.roomOf),
    placeOf: pairs(w.placeOf),
    ...(oldSent ? { oldSent: pairs(oldSent) } : {}),
  };
}

export function wellFormedWire(x: unknown, n: number): x is Wire {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  return (
    b.n === n &&
    LISTS.every((k) => Array.isArray(b[k])) &&
    (b.lead === null || typeof b.lead === "string") &&
    (b.charter === null || typeof b.charter === "object") &&
    (b.repos === undefined || Array.isArray(b.repos)) &&
    (b.hold === null || typeof b.hold === "object") &&
    (b.voice === undefined || typeof b.voice === "boolean") &&
    (b.rules === undefined || typeof b.rules === "number") &&
    (b.githubWrite === undefined || b.githubWrite === null || typeof b.githubWrite === "number") &&
    (b.branchPrefix === undefined || b.branchPrefix === null || typeof b.branchPrefix === "string")
  );
}

export function baseFromWire(x: unknown): FoldBase | null {
  const n = x && typeof x === "object" ? (x as { n?: unknown }).n : undefined;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0 || !wellFormedWire(x, n)) return null;
  try {
    const base = fromWire(x);
    return outgrown(base) ? null : base;
  } catch {
    // A column whose lengths don't match: not a base this build wrote.
    return null;
  }
}
