import { REVIEW_CHECK } from "./protocol.ts";
import { sameHead } from "./stage.ts";
import type { GithubState } from "./state/github.ts";

export function recordedRuns(github: GithubState, sha: string): number[] {
  const out = new Set<number>();
  for (const [key, checks] of github.checks) {
    const at = key.slice(key.indexOf("@") + 1);
    if (!sameHead(sha, at)) continue;
    for (const c of checks.values()) if (c.name !== REVIEW_CHECK && c.run !== undefined) out.add(c.run);
  }
  return [...out].sort((a, b) => a - b);
}
