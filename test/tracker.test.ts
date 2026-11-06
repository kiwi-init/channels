import { describe, expect, test } from "bun:test";

import {
  type Api,
  type Ci,
  type Issue,
  type Pr,
  type Section,
  CAP,
  CHECK,
  ciOf,
  daysSince,
  home,
  loadIssues,
  loadPrs,
  place,
  plain,
  publish,
  rankIssues,
  render,
  score,
  STALE_DAYS,
  TRACKER,
} from "../scripts/tracker.ts";

const NOW = new Date("2026-11-06T12:00:00Z");
const ago = (days: number, hours = 0): string => new Date(NOW.getTime() - days * 86_400_000 - hours * 3_600_000).toISOString();

const pr = (number: number, more: Partial<Pr> = {}): Pr => ({
  number,
  title: `PR ${number}`,
  author: "jo",
  draft: false,
  labels: [],
  createdAt: ago(5),
  updatedAt: ago(1),
  ci: "success",
  ...more,
});

const issue = (number: number, more: Partial<Issue> = {}): Issue => ({
  number,
  title: `Issue ${number}`,
  author: "ann",
  labels: [],
  comments: 0,
  thumbsUp: 0,
  reactions: 0,
  createdAt: ago(3),
  updatedAt: ago(2),
  ...more,
});

const numbers = (sections: Section<Pr>[]): Record<string, number[]> => Object.fromEntries(sections.map((s) => [s.title, s.items.map((p) => p.number)]));

const lines = (body: string, heading: string): string[] => {
  const rows = body.split("\n");
  const start = rows.indexOf(`### ${heading}`);
  if (start < 0) return [];
  const end = rows.findIndex((r, i) => i > start && r === "");
  return rows.slice(start + 1, end < 0 ? undefined : end);
};

describe("where a pull request goes", () => {
  test("each lands in one section by its state; quarantine and drafts win over CI", () => {
    const prs = [
      pr(1),
      pr(2, { ci: "pending" }),
      pr(3, { ci: "missing" }),
      pr(4, { ci: "failure" }),
      pr(5, { labels: ["quarantine"], draft: true, ci: "failure" }),
      pr(6, { labels: ["quarantine"], ci: "success" }),
      pr(7, { draft: true, ci: "pending" }),
      pr(8, { draft: true }),
    ];
    expect(numbers(place(prs))).toEqual({
      "Ready to merge": [1],
      "Needs a careful look": [],
      "Waiting on CI": [2, 3],
      "Red CI": [4],
      Quarantined: [5, 6],
      Drafts: [7, 8],
    });
    expect(prs.map(home)).toEqual(["Ready to merge", "Waiting on CI", "Waiting on CI", "Red CI", "Quarantined", "Quarantined", "Drafts", "Drafts"]);
  });

  test("high or critical blast also lists it under a careful look, whatever its state", () => {
    const prs = [pr(1, { labels: ["blast:high"] }), pr(2, { labels: ["blast:critical"], ci: "failure" }), pr(3, { labels: ["blast:medium"] }), pr(4, { labels: ["blast:critical"], draft: true })];
    const got = numbers(place(prs));
    expect(got["Needs a careful look"]).toEqual([1, 2, 4]);
    expect(got["Ready to merge"]).toEqual([3, 1]);
    expect(got["Red CI"]).toEqual([2]);
    expect(got.Drafts).toEqual([4]);
  });

  test("sections run oldest update first; ready ones go lowest blast first, unknown blast last", () => {
    const ready = [
      pr(1, { updatedAt: ago(1), labels: ["blast:high"] }),
      pr(2, { updatedAt: ago(9) }),
      pr(3, { updatedAt: ago(2), labels: ["blast:low"] }),
      pr(4, { updatedAt: ago(8), labels: ["blast:low"] }),
      pr(5, { updatedAt: ago(3), labels: ["blast:medium"] }),
    ];
    const waiting = [pr(6, { ci: "pending", updatedAt: ago(1) }), pr(7, { ci: "pending", updatedAt: ago(4) }), pr(8, { ci: "missing", updatedAt: ago(2) })];
    const got = numbers(place([...ready, ...waiting]));
    expect(got["Ready to merge"]).toEqual([4, 3, 5, 1, 2]);
    expect(got["Waiting on CI"]).toEqual([7, 8, 6]);
  });
});

describe("ci-ok on the head commit", () => {
  const run = (status: string, conclusion: string, startedAt: string, name = CHECK): Record<string, string> => ({ name, status, conclusion, startedAt });

  test("success, failure, pending and missing", () => {
    const cases: [unknown[], Ci][] = [
      [[run("COMPLETED", "SUCCESS", ago(1)), run("COMPLETED", "FAILURE", ago(1), "test / unit")], "success"],
      [[run("COMPLETED", "FAILURE", ago(1))], "failure"],
      [[run("COMPLETED", "CANCELLED", ago(1))], "failure"],
      [[run("COMPLETED", "SKIPPED", ago(1))], "success"],
      [[run("IN_PROGRESS", "", ago(1))], "pending"],
      [[{ name: CHECK, status: "QUEUED", conclusion: null, startedAt: null }], "pending"],
      [[{ context: CHECK, state: "PENDING", createdAt: ago(1) }], "pending"],
      [[{ context: CHECK, state: "ERROR", createdAt: ago(1) }], "failure"],
      [[run("COMPLETED", "SUCCESS", ago(1), "repo / static")], "missing"],
      [[], "missing"],
    ];
    for (const [contexts, ci] of cases) expect([contexts, ciOf(contexts)]).toEqual([contexts, ci]);
  });

  test("the newest ci-ok run wins over an older one", () => {
    expect(ciOf([run("COMPLETED", "FAILURE", ago(2)), run("COMPLETED", "SUCCESS", ago(1))])).toBe("success");
    expect(ciOf([run("COMPLETED", "SUCCESS", ago(1)), run("COMPLETED", "FAILURE", ago(2))])).toBe("success");
    expect(ciOf([run("COMPLETED", "SUCCESS", ago(1)), { name: CHECK, status: "QUEUED", startedAt: null }])).toBe("pending");
  });
});

describe("issues", () => {
  test("score is 3 per thumbs up, 1 per other reaction and comment, 5 more for a bug", () => {
    expect(score(issue(1))).toBe(0);
    expect(score(issue(1, { thumbsUp: 2, reactions: 5, comments: 4 }))).toBe(6 + 3 + 4);
    expect(score(issue(1, { labels: ["bug"], comments: 1 }))).toBe(6);
  });

  test("ranked by score, then newest first", () => {
    const ranked = rankIssues([
      issue(1, { comments: 1, createdAt: ago(9) }),
      issue(2, { labels: ["bug"] }),
      issue(3, { comments: 1, createdAt: ago(1) }),
      issue(4, { thumbsUp: 1, reactions: 1 }),
      issue(5),
    ]);
    expect(ranked.map((i) => i.number)).toEqual([2, 4, 3, 1, 5]);
  });
});

describe("the body", () => {
  test("starts with the date and counts, skips empty sections, one plain line per item", () => {
    const body = render(
      [pr(12, { title: "Fix it", labels: ["blast:high", "size:S", "bug"], updatedAt: ago(3) })],
      [issue(30, { title: "Broken", labels: ["bug"], createdAt: ago(0, 2), updatedAt: ago(0, 1) })],
      NOW,
    );
    expect(body).toBe(
      [
        "Updated 2026-11-06 by kiwi-bus · 1 open PR · 1 open issue",
        "",
        "### Ready to merge",
        "- #12 Fix it · `@jo` · 3d · size:S blast:high",
        "",
        "### Needs a careful look",
        "- #12 Fix it · `@jo` · 3d · size:S blast:high",
        "",
        "### Issues",
        "- #30 Broken · `@ann` · today · bug · new",
      ].join("\n"),
    );
  });

  test("the date has no time, so a second run the same day writes the same body", () => {
    const prs = [pr(1, { updatedAt: ago(2) })];
    expect(render(prs, [], new Date("2026-11-06T00:00:01Z"))).toBe(render(prs, [], new Date("2026-11-06T23:59:59Z")));
    expect(render([], [], NOW)).toBe("Updated 2026-11-06 by kiwi-bus · 0 open PRs · 0 open issues");
  });

  test("each section shows 25 and says how many more", () => {
    const body = render(
      Array.from({ length: 30 }, (_, i) => pr(i + 1, { updatedAt: ago(30 - i) })),
      Array.from({ length: 26 }, (_, i) => issue(100 + i)),
      NOW,
    );
    const ready = lines(body, "Ready to merge");
    expect(ready).toHaveLength(CAP + 1);
    expect(ready[0]).toStartWith("- #1 ");
    expect(ready.at(-1)).toBe("- and 5 more");
    expect(lines(body, "Issues").at(-1)).toBe("- and 1 more");
    expect(body).toStartWith("Updated 2026-11-06 by kiwi-bus · 30 open PRs · 26 open issues");
  });

  test("no update in 14 days is stale; an issue opened in the last 24 hours is new", () => {
    const body = render(
      [pr(1, { updatedAt: ago(STALE_DAYS) }), pr(2, { updatedAt: ago(STALE_DAYS - 1) })],
      [issue(3, { createdAt: ago(0, 23), updatedAt: ago(0, 23) }), issue(4, { createdAt: ago(1, 1), updatedAt: ago(20) })],
      NOW,
    );
    expect(lines(body, "Ready to merge")).toEqual(["- #1 PR 1 · `@jo` · 14d · stale", "- #2 PR 2 · `@jo` · 13d"]);
    expect(lines(body, "Issues")).toEqual(["- #3 Issue 3 · `@ann` · 1d · new", "- #4 Issue 4 · `@ann` · 20d · stale"]);
  });

  test("ages count calendar days in UTC", () => {
    expect(daysSince("2026-11-06T00:00:00Z", NOW)).toBe(0);
    expect(daysSince("2026-11-05T23:59:59Z", new Date("2026-11-06T00:00:01Z"))).toBe(1);
    expect(daysSince("2026-10-23T12:00:00Z", NOW)).toBe(14);
  });

  test("titles can't mention people or bring in markdown and HTML", () => {
    expect(plain("  Thanks @someone-else for *this* <b>[x](y)</b> `z` R&D, not me@mail.com ")).toBe("Thanks `@someone-else` for \\*this\\* \\<b\\>\\[x\\](y)\\</b\\> \\`z\\` R\\&D, not me@mail.com");
  });
});

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

const fake = (rest: Record<string, unknown>, graphql: (variables: Record<string, string>) => unknown = () => null): { api: Api; calls: Call[] } => {
  const calls: Call[] = [];
  const api: Api = {
    rest: async (method, path, body) => {
      calls.push(body === undefined ? { method, path } : { method, path, body });
      return rest[`${method} ${path}`] ?? null;
    },
    graphql: async (_query, variables) => graphql(variables),
  };
  return { api, calls };
};

describe("talking to GitHub", () => {
  test("loadIssues leaves out pull requests and the tracker itself, and pages through", async () => {
    const raw = (number: number, more: Record<string, unknown> = {}): Record<string, unknown> => ({
      number,
      title: `T${number}`,
      user: { login: "ann" },
      labels: [{ name: "bug" }],
      comments: 2,
      reactions: { "+1": 1, "-1": 0, heart: 2, total_count: 3 },
      created_at: ago(2),
      updated_at: ago(1),
      ...more,
    });
    const first = [raw(TRACKER), raw(1831, { pull_request: { url: "x" } }), ...Array.from({ length: 98 }, (_, i) => raw(i + 1))];
    const { api, calls } = fake({
      "GET /issues?state=open&per_page=100&page=1": first,
      "GET /issues?state=open&per_page=100&page=2": [raw(500, { user: null, reactions: null })],
    });
    const issues = await loadIssues(api);
    expect(calls.map((c) => c.path)).toEqual(["/issues?state=open&per_page=100&page=1", "/issues?state=open&per_page=100&page=2"]);
    expect(issues).toHaveLength(99);
    expect(issues.map((i) => i.number)).not.toContain(TRACKER);
    expect(issues.map((i) => i.number)).not.toContain(1831);
    expect(issues[0]).toEqual({ number: 1, title: "T1", author: "ann", labels: ["bug"], comments: 2, thumbsUp: 1, reactions: 3, createdAt: ago(2), updatedAt: ago(1) });
    expect(issues.at(-1)).toMatchObject({ number: 500, author: "ghost", thumbsUp: 0, reactions: 0 });
  });

  test("loadIssues fails rather than report an empty list", async () => {
    await expect(loadIssues(fake({}).api)).rejects.toThrow("GET /issues did not answer with a list");
  });

  test("loadPrs reads every page with ci-ok from the head commit's rollup", async () => {
    const node = (number: number, contexts: unknown[] | null): Record<string, unknown> => ({
      number,
      title: `P${number}`,
      isDraft: number === 2,
      createdAt: ago(3),
      updatedAt: ago(1),
      author: number === 3 ? null : { login: "jo" },
      labels: { nodes: [{ name: "size:S" }] },
      commits: { nodes: [{ commit: { statusCheckRollup: contexts === null ? null : { contexts: { nodes: contexts } } } }] },
    });
    const seen: Record<string, string>[] = [];
    const { api } = fake({}, (variables) => {
      seen.push(variables);
      const page = variables.after
        ? { pageInfo: { hasNextPage: false, endCursor: "c2" }, nodes: [node(3, null)] }
        : { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [node(1, [{ name: CHECK, status: "COMPLETED", conclusion: "FAILURE", startedAt: ago(1) }]), node(2, [])] };
      return { repository: { pullRequests: page } };
    });
    const prs = await loadPrs(api, "kiwi-init/channels");
    expect(seen).toEqual([
      { owner: "kiwi-init", name: "channels" },
      { owner: "kiwi-init", name: "channels", after: "c1" },
    ]);
    expect(prs).toEqual([
      { number: 1, title: "P1", author: "jo", draft: false, labels: ["size:S"], createdAt: ago(3), updatedAt: ago(1), ci: "failure" },
      { number: 2, title: "P2", author: "jo", draft: true, labels: ["size:S"], createdAt: ago(3), updatedAt: ago(1), ci: "missing" },
      { number: 3, title: "P3", author: "ghost", draft: false, labels: ["size:S"], createdAt: ago(3), updatedAt: ago(1), ci: "missing" },
    ]);
  });

  test("loadPrs fails rather than report no pull requests", async () => {
    await expect(loadPrs(fake({}, () => ({ repository: null })).api, "kiwi-init/channels")).rejects.toThrow("no pull requests");
  });

  test("publish patches the tracker only when its body changed", async () => {
    const body = render([pr(1)], [issue(2)], NOW);
    const unchanged = fake({ [`GET /issues/${TRACKER}`]: { number: TRACKER, body: `${body.replaceAll("\n", "\r\n")}\r\n` } });
    expect(await publish(unchanged.api, body)).toBe(false);
    expect(unchanged.calls).toEqual([{ method: "GET", path: `/issues/${TRACKER}` }]);

    const changed = fake({ [`GET /issues/${TRACKER}`]: { number: TRACKER, body: null } });
    expect(await publish(changed.api, body)).toBe(true);
    expect(changed.calls).toEqual([
      { method: "GET", path: `/issues/${TRACKER}` },
      { method: "PATCH", path: `/issues/${TRACKER}`, body: { body } },
    ]);
  });

  test("publish refuses to write when the tracker can't be read", async () => {
    const { api, calls } = fake({});
    await expect(publish(api, "x")).rejects.toThrow(`#${TRACKER}`);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});
