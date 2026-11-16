import { inlineText } from "./membership.ts";

export const SNAPSHOT_DIRTY_SHOWN = 20;
const PATH_MAX = 500;
const BRANCH_MAX = 255;
const SUBJECT_MAX = 200;
const FILE_MAX = 300;

export interface SnapshotFacts {
  path: string;
  branch: string | null;
  head: string;
  subject: string;
  dirty: string[];
  more?: number;
  base?: { name: string; ahead: number; behind: number };
}

export interface TaskSnapshot extends SnapshotFacts {
  seq: number;
  by: string;
  ts: number;
}

const str = (x: unknown, max: number): x is string => typeof x === "string" && x.length <= max;
const count = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

export function wellFormedSnapshot(e: Record<string, unknown>): boolean {
  const base = e.base as Record<string, unknown> | undefined;
  return (
    str(e.path, PATH_MAX) &&
    e.path.startsWith("/") &&
    (e.branch === null || (str(e.branch, BRANCH_MAX) && e.branch.length > 0)) &&
    typeof e.head === "string" &&
    /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(e.head) &&
    str(e.subject, SUBJECT_MAX) &&
    Array.isArray(e.dirty) &&
    e.dirty.length <= SNAPSHOT_DIRTY_SHOWN &&
    e.dirty.every((f) => str(f, FILE_MAX) && f.length > 0) &&
    (e.more === undefined || (count(e.more) && e.more > 0)) &&
    (base === undefined || (!!base && typeof base === "object" && str(base.name, BRANCH_MAX) && base.name.length > 0 && count(base.ahead) && count(base.behind)))
  );
}

export function sameFacts(a: SnapshotFacts, b: SnapshotFacts): boolean {
  return (
    a.path === b.path &&
    a.branch === b.branch &&
    a.head === b.head &&
    a.subject === b.subject &&
    (a.more ?? 0) === (b.more ?? 0) &&
    a.dirty.length === b.dirty.length &&
    a.dirty.every((f, i) => f === b.dirty[i]) &&
    a.base?.name === b.base?.name &&
    a.base?.ahead === b.base?.ahead &&
    a.base?.behind === b.base?.behind
  );
}

const files = (s: SnapshotFacts): string => {
  const named = s.dirty.map((f) => inlineText(f, 80));
  const rest = s.more ? ` and ${s.more} more` : "";
  return `${named.join(", ")}${rest}`;
};

export function snapshotLines(s: SnapshotFacts): string[] {
  const at = `${s.branch ? `branch ${inlineText(s.branch, 80)}` : "detached HEAD"} at ${s.head.slice(0, 9)} “${inlineText(s.subject, 100)}”`;
  const base = s.base ? `, ${s.base.ahead} ahead and ${s.base.behind} behind ${inlineText(s.base.name, 60)}` : "";
  return [`${at}${base}`, s.dirty.length ? `uncommitted in that checkout, which may hold others' edits too: ${files(s)}` : "nothing uncommitted in that checkout"];
}
