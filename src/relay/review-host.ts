import type { GithubAppApi, GithubReply } from "./github-app.ts";

export type ReviewVerdict = "approved" | "waiting" | "rejected";

export interface ReviewStatus {
  verdict: ReviewVerdict;
  title: string;
  summary: string;
}

export interface ReviewHost {
  post(repo: string, sha: string, status: ReviewStatus): Promise<GithubReply<{ url: string | null }>>;
}

export function reviewStatus(verdict: ReviewVerdict, tasks: readonly number[], note: string): ReviewStatus {
  if (!tasks.length) return { verdict, title: "No Kiwi task claims this PR", summary: note || "No task in this channel holds this PR, so Kiwi doesn't gate it." };
  const named = tasks.map((t) => `T${t}`).join(", ");
  const shown = {
    approved: { title: `${named} approved in Kiwi`, summary: "Approved." },
    waiting: { title: `${named}: waiting in Kiwi`, summary: "Not ready to ship yet." },
    rejected: { title: `${named}: changes requested in Kiwi`, summary: "Changes requested." },
  }[verdict];
  return { verdict, title: shown.title, summary: note || shown.summary };
}

const CONCLUSION: Record<ReviewVerdict, "success" | "failure" | null> = { approved: "success", waiting: null, rejected: "failure" };

export const githubReviewHost = (app: GithubAppApi, name: string): ReviewHost => ({
  post: (repo, sha, s) => app.check(repo, sha, { name, conclusion: CONCLUSION[s.verdict], title: s.title, summary: s.summary }),
});
