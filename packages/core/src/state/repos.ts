import { MAX_REPOS, REPO_RE, type Card } from "../protocol.ts";
import type { ChannelState } from "./types.ts";

export function reposOf(list: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of list) {
    if (typeof r !== "string" || !REPO_RE.test(r.trim()) || seen.has(r.trim().toLowerCase())) continue;
    seen.add(r.trim().toLowerCase());
    out.push(r.trim());
  }
  return out.slice(0, MAX_REPOS);
}

export function outsideRepos(state: Pick<ChannelState, "repos">, card: Card | undefined): boolean {
  if (!card?.repo || !state.repos.length) return false;
  const repo = card.repo.toLowerCase();
  return !state.repos.some((r) => r.toLowerCase() === repo);
}
