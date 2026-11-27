import { isLanding, outgrown, quietMinutes, type Trust } from "./protocol.ts";
import { DUTY_SAID_MAX } from "./state/duty-notes.ts";
import { wellFormedStepSpecs } from "./steps.ts";
import type { FoldBase, Place } from "./state.ts";
import type { GithubCheck, RunAttempt } from "./state/github.ts";

export const BASE_WIRE_VERSION = 8;

export const readableWire = (v: unknown): boolean => v === 7 || v === BASE_WIRE_VERSION;

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

type WireCheck = Omit<GithubCheck, "attempts"> & { wf?: number; attempts?: RunAttempt[]; once?: { started?: number } };

type BaseGithub = NonNullable<FoldBase["github"]>;

type Wire = Omit<FoldBase, "trust" | "threadOf" | "roomOf" | "placeOf" | "oldSent" | "github"> & {
  trust: Column<Trust>;
  threadOf: Column<number>;
  roomOf: Column<string>;
  placeOf: Column<Place>;
  oldSent?: Column<number>;
  github?: Omit<BaseGithub, "checks"> & { checks: [string, WireCheck[]][] };
};

const jobUrl = (repo: string, wf: number, job: number): string => `https://github.com/${repo}/actions/runs/${wf}/job/${job}`;

const JOB_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)\/job\/(\d+)$/;

function onlyAttempt(c: GithubCheck): RunAttempt | undefined {
  const a = c.attempts?.length === 1 ? c.attempts[0] : undefined;
  if (!a || c.run === undefined || a.run !== c.run || a.attempt !== (c.attempt ?? 1) || a.conclusion !== c.conclusion || a.completed !== c.completedAt) return undefined;
  return Object.keys(a).every((k) => k === "run" || k === "attempt" || k === "started" || k === "conclusion" || k === "completed") ? a : undefined;
}

function checkToWire(repo: string, check: GithubCheck): WireCheck {
  const { url, attempts, ...c } = check;
  const m = url ? JOB_URL.exec(url) : null;
  const wf = m && m[1] === repo && c.run !== undefined && m[3] === String(c.run) && m[2] === String(Number(m[2])) ? Number(m[2]) : undefined;
  const one = onlyAttempt(check);
  return {
    ...c,
    ...(wf !== undefined ? { wf } : url !== undefined ? { url } : {}),
    ...(one ? { once: one.started !== undefined ? { started: one.started } : {} } : attempts ? { attempts } : {}),
  };
}

function checkFromWire(repo: string, { wf, once, ...c }: WireCheck): GithubCheck {
  const run = c.run;
  return {
    ...c,
    ...(wf !== undefined && run !== undefined ? { url: jobUrl(repo, wf, run) } : {}),
    ...(once && run !== undefined
      ? {
          attempts: [
            {
              run,
              attempt: c.attempt ?? 1,
              ...(once.started !== undefined ? { started: once.started } : {}),
              ...(c.conclusion !== undefined ? { conclusion: c.conclusion } : {}),
              ...(c.completedAt !== undefined ? { completed: c.completedAt } : {}),
            },
          ],
        }
      : {}),
  };
}

const repoOfSha = (key: string): string => key.slice(0, key.lastIndexOf("@"));

const githubToWire = (g: BaseGithub): Wire["github"] => ({ ...g, checks: g.checks.map(([k, runs]) => [k, runs.map((c) => checkToWire(repoOfSha(k), c))]) });

const githubFromWire = (g: NonNullable<Wire["github"]>): BaseGithub => ({ ...g, checks: g.checks.map(([k, runs]) => [k, runs.map((c) => checkFromWire(repoOfSha(k), c))]) });

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

export const toWire = ({ oldSent, github, ...b }: FoldBase): Wire => ({
  ...b,
  ...(github ? { github: githubToWire(github) } : {}),
  trust: column(b.trust),
  threadOf: column(b.threadOf.map(([seq, root]): [number, number] => [seq, seq - root])),
  roomOf: column(b.roomOf),
  placeOf: column(b.placeOf),
  ...(oldSent ? { oldSent: column(oldSent) } : {}),
});

export function fromWire({ oldSent, github, ...w }: Wire): FoldBase {
  return {
    ...w,
    ...(github ? { github: githubFromWire(github) } : {}),
    trust: pairs(w.trust),
    threadOf: pairs(w.threadOf).map(([seq, back]): [number, number] => [seq, seq - back]),
    roomOf: pairs(w.roomOf),
    placeOf: pairs(w.placeOf),
    ...(oldSent ? { oldSent: pairs(oldSent) } : {}),
  };
}

const seqOk = (x: unknown): boolean => Number.isSafeInteger(x) && (x as number) >= 0;

const nameOk = (x: unknown): boolean => typeof x === "string" && x.length > 0 && x.length <= 64;

function wellFormedDuty(x: unknown): boolean {
  if (x === undefined || x === null) return true;
  if (typeof x !== "object") return false;
  const d = x as Record<string, unknown>;
  return nameOk(d.lead) && seqOk(d.since) && nameOk(d.by);
}

function wellFormedCheckpoint(x: unknown): boolean {
  if (x === undefined || x === null) return true;
  if (typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  return typeof c.text === "string" && c.text.length > 0 && nameOk(c.by) && seqOk(c.seq) && Number.isFinite(c.at);
}

function wellFormedDutyNote(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const n = x as Record<string, unknown>;
  if (!seqOk(n.seq)) return false;
  if (n.kind === "answer") return seqOk(n.ask) && nameOk(n.by) && typeof n.said === "string" && n.said.length <= DUTY_SAID_MAX;
  if (n.kind === "hold") return seqOk(n.task) && typeof n.step === "string" && nameOk(n.by) && typeof n.reason === "string";
  if (n.kind === "unhold") return seqOk(n.task) && typeof n.step === "string" && nameOk(n.by);
  return n.kind === "ticked" && seqOk(n.ask) && typeof n.boxes === "number" && Number.isSafeInteger(n.boxes) && n.boxes > 0;
}

function wellFormedOffDuty(x: unknown): boolean {
  if (x === undefined || x === null) return true;
  if (typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    Array.isArray(o.left) && o.left.length > 0 && o.left.every((e) => Array.isArray(e) && e.length === 2 && nameOk(e[0]) && seqOk(e[1])) && Array.isArray(o.notes) && o.notes.every(wellFormedDutyNote)
  );
}

function wellFormedStandbys(x: unknown): boolean {
  if (x === undefined) return true;
  return (
    Array.isArray(x) &&
    x.every((e) => {
      if (!Array.isArray(e) || e.length !== 2 || !nameOk(e[0]) || !e[1] || typeof e[1] !== "object") return false;
      const s = e[1] as Record<string, unknown>;
      return seqOk(s.since) && nameOk(s.by);
    })
  );
}

function wellFormedPairs(x: unknown, value: (v: Record<string, unknown>) => boolean): boolean {
  if (x === undefined) return true;
  return Array.isArray(x) && x.every((e) => Array.isArray(e) && e.length === 2 && seqOk(e[0]) && !!e[1] && typeof e[1] === "object" && value(e[1] as Record<string, unknown>));
}

const wellFormedLeadAsk = (a: Record<string, unknown>): boolean =>
  nameOk(a.sentTo) &&
  nameOk(a.from) &&
  typeof a.plain === "boolean" &&
  (a.answer === undefined || (!!a.answer && typeof a.answer === "object" && nameOk((a.answer as Record<string, unknown>).by) && seqOk((a.answer as Record<string, unknown>).seq)));

const wellFormedLeadOwned = (o: Record<string, unknown>): boolean =>
  nameOk(o.author) &&
  Array.isArray(o.to) &&
  o.to.length > 0 &&
  o.to.every(nameOk) &&
  typeof o.esc === "boolean" &&
  typeof o.plain === "boolean" &&
  (o.answer === undefined ||
    (!!o.answer &&
      typeof o.answer === "object" &&
      nameOk((o.answer as Record<string, unknown>).by) &&
      seqOk((o.answer as Record<string, unknown>).seq) &&
      nameOk((o.answer as Record<string, unknown>).to)));

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
    (b.branchPrefix === undefined || b.branchPrefix === null || typeof b.branchPrefix === "string") &&
    (b.quietMs === undefined || (typeof b.quietMs === "number" && quietMinutes(b.quietMs / 60_000))) &&
    (b.landing === undefined || b.landing === null || isLanding(b.landing)) &&
    (b.landingSteps === undefined || b.landingSteps === null || wellFormedStepSpecs(b.landingSteps)) &&
    wellFormedDuty(b.duty) &&
    wellFormedCheckpoint(b.checkpoint) &&
    wellFormedOffDuty(b.offDuty) &&
    wellFormedStandbys(b.standbys) &&
    wellFormedPairs(b.leadAsks, wellFormedLeadAsk) &&
    wellFormedPairs(b.leadOwned, wellFormedLeadOwned)
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
