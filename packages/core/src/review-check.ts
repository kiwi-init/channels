import type { ReviewCheck } from "./client/github.ts";
import { RelayError } from "./client/relay-errors.ts";
import { sameHead } from "./stage.ts";
import type { GithubState } from "./state/github.ts";

export const REVIEW_CHECK = "kiwi/review";

export function recordedRuns(github: GithubState, sha: string): number[] {
  const out = new Set<number>();
  for (const [key, checks] of github.checks) {
    const at = key.slice(key.indexOf("@") + 1);
    if (!sameHead(sha, at)) continue;
    for (const c of checks.values()) if (c.name !== REVIEW_CHECK && c.run !== undefined) out.add(c.run);
  }
  return [...out].sort((a, b) => a - b);
}

export const downgradeHeld = (err: unknown): boolean => !(err instanceof RelayError) || err.status >= 500 || err.status === 408 || err.status === 429;

export const downgradeRefusal = (c: ReviewCheck, err: unknown): string =>
  `kiwi/review on ${c.repo}@${c.sha.slice(0, 7)} has to turn ${c.verdict} before this goes out, and the relay didn't confirm it (${err instanceof Error && err.message ? err.message : "no answer"}): nothing was sent, try again`;
