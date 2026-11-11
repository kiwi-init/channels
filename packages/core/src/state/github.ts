import { omit } from "../omit.ts";
import { handoffUrl, type GithubNote, type MergeMethod } from "../protocol.ts";

export interface GithubCheck {
  name: string;
  status?: string;
  conclusion?: string;
  url?: string;
  run?: number;
  attempt?: number;
  at: number;
  completedAt?: number;
  attempts?: RunAttempt[];
}

export interface RunAttempt {
  run: number;
  attempt: number;
  started?: number;
  conclusion?: string;
  completed?: number;
}

export interface GithubPr {
  repo: string;
  number: number;
  title?: string;
  url?: string;
  state: "open" | "closed" | "merged";
  branch?: string;
  sha?: string;
  merge?: string;
  by?: string;
  additions?: number;
  deletions?: number;
  files?: number;
  at: number;
  happened?: number;
  mergedAt?: number;
  seq: number;
}

export interface GithubIssue {
  repo: string;
  number: number;
  title?: string;
  url?: string;
  state: "open" | "closed";
  reason?: string;
  by?: string;
  at: number;
  happened?: number;
  seq: number;
}

export interface GithubRules {
  repo: string;
  branch: string;
  required: string[];
  merge: MergeMethod[];
  seq: number;
}

export interface GithubRelease {
  repo: string;
  tag: string;
  at: number;
  shas: string[];
  prs: number[];
  seq: number;
}

export interface GithubRun {
  repo: string;
  run: number;
  title?: string;
  started: number;
  attempt?: number;
  conclusion?: string;
}

export interface GithubState {
  prs: Map<string, GithubPr>;
  checks: Map<string, Map<string, GithubCheck>>;
  issues: Map<string, GithubIssue>;
  rules: Map<string, GithubRules>;
  releases: Map<string, GithubRelease[]>;
  runs: Map<string, GithubRun>;
  runsSince: number | null;
  runsForgotten: number | null;
}

const MAX_RELEASES = 30;

const MAX_SHAS = 300;

const MAX_RUNS = 500;

export const prKey = (repo: string, number: number): string => `${repo.toLowerCase()}#${number}`;
export const shaKey = (repo: string, sha: string): string => `${repo.toLowerCase()}@${sha}`;
export const runKey = (repo: string, run: number): string => `${repo.toLowerCase()}/${run}`;

function addRun(g: GithubState, i: GithubNote, seq: number): void {
  if (i.event !== "workflow_run" || !i.run || i.started === undefined) return;
  const key = runKey(i.repo, i.run);
  const was = g.runs.get(key);
  const title = was?.title ?? i.title;
  const attempt = Math.max(i.attempt ?? 1, was?.attempt ?? 1);
  const rerun = (i.attempt ?? 1) > (was?.attempt ?? 1);
  const conclusion = (i.attempt ?? 1) < (was?.attempt ?? 1) ? was?.conclusion : (i.conclusion ?? (rerun ? undefined : was?.conclusion));
  g.runsSince ??= seq;
  g.runs.delete(key);
  g.runs.set(key, {
    repo: i.repo,
    run: i.run,
    started: Math.min(i.started, was?.started ?? i.started),
    ...(title ? { title } : {}),
    ...(attempt > 1 ? { attempt } : {}),
    ...(conclusion ? { conclusion } : {}),
  });
  for (const old of [...g.runs.values()].slice(0, Math.max(0, g.runs.size - MAX_RUNS))) {
    g.runs.delete(runKey(old.repo, old.run));
    g.runsForgotten = Math.max(g.runsForgotten ?? old.started, old.started);
  }
}

export const runsUnknownSince = (g: GithubState, task: { id: number; createdRts?: number }): boolean =>
  task.createdRts === undefined || g.runsSince === null || g.runsSince > task.id || (g.runsForgotten !== null && g.runsForgotten >= task.createdRts);

export function runStart(g: GithubState, id: string, since: number): GithubRun | undefined {
  let first: GithubRun | undefined;
  for (const r of g.runs.values()) if ((r.title === id || String(r.run) === id) && r.started >= since && (!first || r.started < first.started)) first = r;
  return first;
}

function behind(i: GithubNote, was: GithubCheck): boolean {
  const order = i.run && was.run ? i.run - was.run || (i.attempt ?? 1) - (was.attempt ?? 1) : 0;
  return order < 0 || (order === 0 && !!was.conclusion && !i.conclusion);
}

const older = (i: GithubNote, was: { happened?: number } | undefined): boolean => i.happened !== undefined && was?.happened !== undefined && i.happened < was.happened;

const MAX_ATTEMPTS = 8;

function attemptsWith(attempts: readonly RunAttempt[] | undefined, i: GithubNote): RunAttempt[] | undefined {
  if (!i.run) return attempts ? [...attempts] : undefined;
  const attempt = i.attempt ?? 1;
  const was = attempts?.find((a) => a.run === i.run && a.attempt === attempt);
  const next: RunAttempt = { ...(was ?? { run: i.run, attempt }) };
  if (i.conclusion) {
    next.conclusion = i.conclusion;
    if (i.happened !== undefined) next.completed = i.happened;
  } else if (i.happened !== undefined && (next.started === undefined || i.happened < next.started)) next.started = i.happened;
  return [...(attempts ?? []).filter((a) => a !== was), next].sort((a, b) => a.run - b.run || a.attempt - b.attempt).slice(-MAX_ATTEMPTS);
}

export function succeededBy(check: GithubCheck, run: number, x: number): boolean {
  const attempts =
    check.attempts ??
    (check.run !== undefined
      ? [{ run: check.run, attempt: check.attempt ?? 1, ...(check.conclusion ? { conclusion: check.conclusion } : {}), ...(check.completedAt !== undefined ? { completed: check.completedAt } : {}) }]
      : []);
  const current = attempts.filter((a) => a.started === undefined || a.started <= x).at(-1);
  return current?.run === run && current.conclusion === "success" && current.completed !== undefined && current.completed <= x;
}

const stalePr = (i: GithubNote, was: GithubPr | undefined): boolean => (was?.state === "merged" && !i.merged) || older(i, was);

export function applyGithub(g: GithubState, items: readonly GithubNote[], seq: number): void {
  for (const i of items) {
    addRun(g, i, seq);
    if (i.event === "pull_request" && i.number) {
      const key = prKey(i.repo, i.number);
      const was = g.prs.get(key);
      if (stalePr(i, was)) continue;
      const state = i.merged ? "merged" : i.state === "closed" ? "closed" : i.state === "open" ? "open" : (was?.state ?? "open");
      const happened = i.happened ?? was?.happened;
      const mergedAt = i.merged ? (i.happened ?? was?.mergedAt) : undefined;
      g.prs.set(key, {
        ...was,
        repo: i.repo,
        number: i.number,
        state,
        at: i.at,
        seq: was?.seq ?? seq,
        ...(happened !== undefined ? { happened } : {}),
        ...(mergedAt !== undefined ? { mergedAt } : {}),
        ...(i.title ? { title: i.title } : {}),
        ...(i.url ? { url: i.url } : {}),
        ...(i.branch ? { branch: i.branch } : {}),
        ...(i.sha ? { sha: i.sha } : {}),
        ...(i.merge && i.merged ? { merge: i.merge } : {}),
        ...(i.by && !was?.by ? { by: i.by } : {}),
        ...(i.additions !== undefined ? { additions: i.additions } : {}),
        ...(i.deletions !== undefined ? { deletions: i.deletions } : {}),
        ...(i.files !== undefined ? { files: i.files } : {}),
      });
    } else if ((i.event === "check_run" || i.event === "workflow_run") && i.sha && i.name) {
      const key = shaKey(i.repo, i.sha);
      const runs = g.checks.get(key) ?? new Map<string, GithubCheck>();
      g.checks.delete(key);
      const was = runs.get(i.name);
      const attempts = attemptsWith(was?.attempts, i);
      if (!was || !behind(i, was))
        runs.set(i.name, {
          name: i.name,
          at: i.at,
          ...(i.status ? { status: i.status } : {}),
          ...(i.conclusion ? { conclusion: i.conclusion } : {}),
          ...(i.url ? { url: i.url } : {}),
          ...(i.run ? { run: i.run } : {}),
          ...(i.attempt ? { attempt: i.attempt } : {}),
          ...(i.conclusion && i.happened !== undefined ? { completedAt: i.happened } : {}),
          ...(attempts ? { attempts } : {}),
        });
      else if (attempts) runs.set(i.name, { ...was, attempts });
      g.checks.set(key, runs);
      while (g.checks.size > MAX_SHAS) g.checks.delete(g.checks.keys().next().value!);
    } else if (i.event === "issues" && i.number) {
      const key = prKey(i.repo, i.number);
      const was = g.issues.get(key);
      if (older(i, was)) continue;
      const state = i.state === "closed" ? "closed" : i.state === "open" ? "open" : (was?.state ?? "open");
      const same = !!was && was.state === state;
      const by = same ? was.by : i.by;
      const reason = state === "closed" ? (same ? was.reason : i.reason) : undefined;
      const title = i.title ?? was?.title;
      const url = i.url ?? was?.url;
      const happened = i.happened ?? was?.happened;
      g.issues.set(key, {
        repo: i.repo,
        number: i.number,
        state,
        at: i.at,
        seq: same ? was.seq : seq,
        ...(title ? { title } : {}),
        ...(url ? { url } : {}),
        ...(reason ? { reason } : {}),
        ...(by ? { by } : {}),
        ...(happened !== undefined ? { happened } : {}),
      });
    } else if (i.event === "push" && i.branch && i.sha) {
      for (const [key, pr] of g.prs)
        if (pr.state === "open" && pr.branch === i.branch && pr.repo.toLowerCase() === i.repo.toLowerCase() && !older(i, pr))
          g.prs.set(key, { ...pr, sha: i.sha, at: i.at, ...(i.happened !== undefined ? { happened: i.happened } : {}) });
    }
  }
}

export function githubNews(g: GithubState, notes: readonly GithubNote[]): GithubNote[] {
  return notes.filter((i) => {
    if (i.event === "pull_request" && i.number) {
      const was = g.prs.get(prKey(i.repo, i.number));
      if (stalePr(i, was)) return false;
      const state = i.merged ? "merged" : i.state === "closed" ? "closed" : "open";
      return !was || was.state !== state || (!!i.title && was.title !== i.title) || (state === "open" && !!i.sha && was.sha !== i.sha);
    }
    if (i.event === "issues" && i.number) {
      const was = g.issues.get(prKey(i.repo, i.number));
      if (older(i, was)) return false;
      return !was || was.state !== (i.state === "closed" ? "closed" : "open") || (!!i.title && was.title !== i.title);
    }
    if ((i.event === "check_run" || i.event === "workflow_run") && i.sha && i.name) {
      const was = g.checks.get(shaKey(i.repo, i.sha))?.get(i.name);
      return !was || (!behind(i, was) && (was.status !== i.status || was.conclusion !== i.conclusion));
    }
    return false;
  });
}

export const repoKey = (repo: string): string => repo.toLowerCase();

export function rulesOf(g: GithubState, repo: string): GithubRules | undefined {
  return g.rules.get(repoKey(repo));
}

export function linkSafe<T extends { url?: string }>(x: T): Omit<T, "url"> & { url?: string } {
  return x.url === undefined || handoffUrl(x.url) ? x : omit(x, "url");
}

export function releasesFrom(list: readonly GithubRelease[] | undefined): Map<string, GithubRelease[]> {
  const g = { releases: new Map<string, GithubRelease[]>() };
  for (const r of list ?? []) addRelease(g, r);
  return g.releases;
}

export function addRelease(g: Pick<GithubState, "releases">, r: GithubRelease): void {
  const key = repoKey(r.repo);
  const kept = (g.releases.get(key) ?? []).filter((x) => x.tag !== r.tag);
  kept.push(r);
  kept.sort((a, b) => a.at - b.at);
  g.releases.set(key, kept.slice(-MAX_RELEASES));
}

export function dropRelease(g: Pick<GithubState, "releases">, repo: string, tag: string): void {
  const key = repoKey(repo);
  const kept = (g.releases.get(key) ?? []).filter((x) => x.tag !== tag);
  if (kept.length) g.releases.set(key, kept);
  else g.releases.delete(key);
}

const sameCommit = (a: string, b: string): boolean => a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));

export function releaseOf(g: GithubState, pr: GithubPr): GithubRelease | undefined {
  if (pr.state !== "merged") return undefined;
  return g.releases.get(repoKey(pr.repo))?.find((r) => r.prs.includes(pr.number) || (!!pr.merge && r.shas.some((s) => sameCommit(s, pr.merge!))));
}

export function issueOf(g: GithubState, ref: { repo: string; number: number }): GithubIssue | undefined {
  return g.issues.get(prKey(ref.repo, ref.number));
}

export function prChecks(g: GithubState, pr: GithubPr): GithubCheck[] {
  return pr.sha ? [...(g.checks.get(shaKey(pr.repo, pr.sha))?.values() ?? [])] : [];
}
