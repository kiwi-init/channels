import { isLanding, outgrown, quietMinutes, type Trust } from "./protocol.ts";
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
    (b.landingSteps === undefined || b.landingSteps === null || wellFormedStepSpecs(b.landingSteps))
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
