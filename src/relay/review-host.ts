import type { GithubAppApi, GithubReply } from "./github-app.ts";

export interface ReviewHost {
  retire(repo: string, sha: string): Promise<GithubReply<{ url: string | null }>>;
}

export const RETIRED = {
  title: "Retired: Kiwi no longer gates merges",
  summary: "This check always passes now. Reviews live in the Kiwi task, and Kiwi no longer blocks a merge. Remove this check from the repository's required checks.",
} as const;

export const githubReviewHost = (app: GithubAppApi, name: string): ReviewHost => ({
  retire: (repo, sha) => app.check(repo, sha, { name, conclusion: "success", ...RETIRED }),
});
