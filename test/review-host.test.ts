import { describe, expect, test } from "bun:test";
import type { GithubAppApi } from "../src/relay/github-app.ts";
import { githubReviewHost, RETIRED } from "../src/relay/review-host.ts";

describe("kiwi/review goes through a host adapter (#3930 §5)", () => {
  test("retiring a head is one successful check run that says the check is retired", async () => {
    const seen: unknown[] = [];
    const app = { check: async (...a: unknown[]) => (seen.push(a), { ok: true, value: { url: null } }) } as unknown as GithubAppApi;
    await githubReviewHost(app, "kiwi/review/room").retire("o/r", "s1");
    expect(seen).toEqual([["o/r", "s1", { name: "kiwi/review/room", conclusion: "success", title: RETIRED.title, summary: RETIRED.summary }]]);
    expect(RETIRED.title).toContain("Retired");
    expect(RETIRED.summary).toContain("required checks");
  });
});
