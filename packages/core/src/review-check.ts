import { isReviewCheck } from "./protocol.ts";
import { sameHead } from "./stage.ts";
import type { GithubState } from "./state/github.ts";

export function recordedRuns(github: GithubState, repo: string, sha: string): number[] {
  const out = new Set<number>();
  const prefix = `${repo.toLowerCase()}@`;
  for (const [key, checks] of github.checks) {
    if (!key.startsWith(prefix) || !sameHead(sha, key.slice(prefix.length))) continue;
    for (const c of checks.values()) if (!isReviewCheck(c.name) && c.run !== undefined) out.add(c.run);
  }
  return [...out].sort((a, b) => a - b);
}
