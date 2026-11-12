export type SharedWork = { kind: "review"; task: number; round: number } | { kind: "doing"; task: number };

export interface SharedWith {
  room: string;
  alias: string;
  agent: string;
  work: SharedWork[];
}

export interface SharedSeat {
  room: string;
  alias: string;
  agent: string;
  with: SharedWith[];
}

const ROOM_ID = /^[0-9a-f]{32}$/;
const named = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

function readWork(x: unknown): SharedWork | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (r.kind === "review" && count(r.task) && count(r.round)) return { kind: "review", task: r.task, round: r.round };
  if (r.kind === "doing" && count(r.task)) return { kind: "doing", task: r.task };
  return null;
}

function readWith(x: unknown): SharedWith | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.room !== "string" || !ROOM_ID.test(r.room) || !named(r.alias) || !named(r.agent)) return null;
  const work = Array.isArray(r.work)
    ? r.work
        .slice(0, 20)
        .map(readWork)
        .filter((w): w is SharedWork => w !== null)
    : [];
  return { room: r.room, alias: r.alias, agent: r.agent, work };
}

export function readSharedSeat(x: unknown): SharedSeat | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.room !== "string" || !ROOM_ID.test(r.room) || !named(r.alias) || !named(r.agent) || !Array.isArray(r.with)) return null;
  const others = r.with.map(readWith).filter((w): w is SharedWith => w !== null);
  return others.length ? { room: r.room, alias: r.alias, agent: r.agent, with: others } : null;
}
