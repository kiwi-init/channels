import { describe, expect, test } from "bun:test";
import type { GithubAppApi } from "../src/relay/github-app.ts";
import { githubReviewHost, reviewStatus } from "../src/relay/review-host.ts";

describe("kiwi/review goes through a host adapter (#623 §6)", () => {
  test("the status is host-neutral, and the GitHub adapter maps it onto a check run", async () => {
    const seen: unknown[] = [];
    const app = { check: async (...a: unknown[]) => (seen.push(a), { ok: true, value: { url: null } }) } as unknown as GithubAppApi;
    const host = githubReviewHost(app);
    expect(reviewStatus("waiting", [4, 5], "")).toEqual({ verdict: "waiting", title: "T4, T5: waiting in Kiwi", summary: "Not ready to ship yet." });
    await host.post("o/r", "s1", reviewStatus("approved", [4], "Looks right."));
    await host.post("o/r", "s1", reviewStatus("waiting", [4], ""));
    await host.post("o/r", "s1", reviewStatus("rejected", [4], ""));
    expect(seen).toEqual([
      ["o/r", "s1", { conclusion: "success", title: "T4 approved in Kiwi", summary: "Looks right." }],
      ["o/r", "s1", { conclusion: null, title: "T4: waiting in Kiwi", summary: "Not ready to ship yet." }],
      ["o/r", "s1", { conclusion: "failure", title: "T4: changes requested in Kiwi", summary: "Changes requested." }],
    ]);
  });
});
