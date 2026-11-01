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

export interface GithubState {
  prs: Map<string, GithubPr>;
  checks: Map<string, Map<string, GithubCheck>>;
  issues: Map<string, GithubIssue>;
  rules: Map<string, GithubRules>;
  releases: Map<string, GithubRelease[]>;
}

const MAX_RELEASES = 30;

const MAX_SHAS = 300;

export const prKey = (repo: string, number: number): string => `${repo.toLowerCase()}#${number}`;
const shaKey = (repo: string, sha: string): string => `${repo.toLowerCase()}@${sha}`;

function behind(i: GithubNote, was: GithubCheck): boolean {
  const order = i.run && was.run ? i.run - was.run || (i.attempt ?? 1) - (was.attempt ?? 1) : 0;
  return order < 0 || (order === 0 && !!was.conclusion && !i.conclusion);
}

export function applyGithub(g: GithubState, items: readonly GithubNote[], seq: number): void {
  for (const i of items) {
    if (i.event === "pull_request" && i.number) {
      const key = prKey(i.repo, i.number);
      const was = g.prs.get(key);
      const state = i.merged ? "merged" : i.state === "closed" ? "closed" : i.state === "open" ? "open" : (was?.state ?? "open");
      g.prs.set(key, {
        ...was,
        repo: i.repo,
        number: i.number,
        state,
        at: i.at,
        seq: was?.seq ?? seq,
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
      if (!was || !behind(i, was))
        runs.set(i.name, {
          name: i.name,
          at: i.at,
          ...(i.status ? { status: i.status } : {}),
          ...(i.conclusion ? { conclusion: i.conclusion } : {}),
          ...(i.url ? { url: i.url } : {}),
          ...(i.run ? { run: i.run } : {}),
          ...(i.attempt ? { attempt: i.attempt } : {}),
        });
      g.checks.set(key, runs);
      while (g.checks.size > MAX_SHAS) g.checks.delete(g.checks.keys().next().value!);
    } else if (i.event === "issues" && i.number) {
      const key = prKey(i.repo, i.number);
      const was = g.issues.get(key);
      const state = i.state === "closed" ? "closed" : i.state === "open" ? "open" : (was?.state ?? "open");
      const same = !!was && was.state === state;
      const by = same ? was.by : i.by;
      const reason = state === "closed" ? (same ? was.reason : i.reason) : undefined;
      const title = i.title ?? was?.title;
      const url = i.url ?? was?.url;
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
      });
    } else if (i.event === "push" && i.branch && i.sha) {
      for (const [key, pr] of g.prs) if (pr.state === "open" && pr.branch === i.branch && pr.repo.toLowerCase() === i.repo.toLowerCase()) g.prs.set(key, { ...pr, sha: i.sha, at: i.at });
    }
  }
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
