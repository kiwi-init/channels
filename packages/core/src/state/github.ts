import type { GithubNote } from "../protocol.ts";

export interface GithubCheck {
  name: string;
  status?: string;
  conclusion?: string;
  url?: string;
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
  by?: string;
  at: number;
}

export interface GithubState {
  prs: Map<string, GithubPr>;
  checks: Map<string, Map<string, GithubCheck>>;
}

const MAX_SHAS = 300;

export const prKey = (repo: string, number: number): string => `${repo.toLowerCase()}#${number}`;
const shaKey = (repo: string, sha: string): string => `${repo.toLowerCase()}@${sha}`;

export function applyGithub(g: GithubState, items: readonly GithubNote[]): void {
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
        ...(i.title ? { title: i.title } : {}),
        ...(i.url ? { url: i.url } : {}),
        ...(i.branch ? { branch: i.branch } : {}),
        ...(i.sha ? { sha: i.sha } : {}),
        ...(i.by && !was?.by ? { by: i.by } : {}),
      });
    } else if ((i.event === "check_run" || i.event === "workflow_run") && i.sha && i.name) {
      const key = shaKey(i.repo, i.sha);
      const runs = g.checks.get(key) ?? new Map<string, GithubCheck>();
      g.checks.delete(key);
      runs.set(i.name, { name: i.name, at: i.at, ...(i.status ? { status: i.status } : {}), ...(i.conclusion ? { conclusion: i.conclusion } : {}), ...(i.url ? { url: i.url } : {}) });
      g.checks.set(key, runs);
      while (g.checks.size > MAX_SHAS) g.checks.delete(g.checks.keys().next().value!);
    } else if (i.event === "push" && i.branch && i.sha) {
      for (const [key, pr] of g.prs) if (pr.state === "open" && pr.branch === i.branch && pr.repo.toLowerCase() === i.repo.toLowerCase()) g.prs.set(key, { ...pr, sha: i.sha, at: i.at });
    }
  }
}

export function prChecks(g: GithubState, pr: GithubPr): GithubCheck[] {
  return pr.sha ? [...(g.checks.get(shaKey(pr.repo, pr.sha))?.values() ?? [])] : [];
}
