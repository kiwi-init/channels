import { isReviewCheck } from "./protocol.ts";
import { sameHead } from "./stage.ts";
import { rulesOf, shaKey, type GithubState } from "./state/github.ts";

export interface RetiredHead {
  repo: string;
  sha: string;
}

const stillRequired = (github: GithubState, repo: string, check: string): boolean | undefined => rulesOf(github, repo)?.required.includes(check);

export function retiredHeads(state: { repos: readonly string[]; github: GithubState }, check: string): RetiredHead[] {
  const connected = new Set(state.repos.map((r) => r.toLowerCase()));
  const out = new Map<string, RetiredHead>();
  for (const pr of state.github.prs.values()) {
    if (pr.state !== "open" || !pr.sha || !connected.has(pr.repo.toLowerCase())) continue;
    if (stillRequired(state.github, pr.repo, check) === false) continue;
    const key = shaKey(pr.repo, pr.sha);
    if (state.github.checks.get(key)?.get(check)?.conclusion !== "success") out.set(key, { repo: pr.repo, sha: pr.sha });
  }
  return [...out.values()].sort((a, b) => a.repo.localeCompare(b.repo) || a.sha.localeCompare(b.sha));
}

export function recordedRuns(github: GithubState, repo: string, sha: string): number[] {
  const out = new Set<number>();
  const prefix = `${repo.toLowerCase()}@`;
  for (const [key, checks] of github.checks) {
    if (!key.startsWith(prefix) || !sameHead(sha, key.slice(prefix.length))) continue;
    for (const c of checks.values()) if (!isReviewCheck(c.name) && c.run !== undefined) out.add(c.run);
  }
  return [...out].sort((a, b) => a - b);
}
