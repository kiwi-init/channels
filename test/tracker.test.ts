import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test } from "bun:test";

import { cut } from "../scripts/blast-radius.ts";
import {
  type Api,
  type Calls,
  type Ci,
  type Issue,
  type IssueCall,
  type Merge,
  type Pr,
  type PrCall,
  type Section,
  brief,
  CAP,
  CHECK,
  ciOf,
  daysSince,
  home,
  issueInput,
  judgeAll,
  loadIssues,
  loadPrs,
  merge,
  mergeScore,
  place,
  plain,
  prInput,
  publish,
  rankIssues,
  readIssueCall,
  readPrCall,
  render,
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
  body: "",
  additions: 10,
  deletions: 2,
  files: [],
  closes: [],
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
  body: "",
  recent: [],
  ...more,
});

const judged = (issues: [number, IssueCall][] = [], prs: [number, PrCall][] = []): Calls => ({ issues: new Map(issues), prs: new Map(prs) });

const numbers = (sections: Section<Merge>[]): Record<string, number[]> => Object.fromEntries(sections.map((s) => [s.title, s.items.map((m) => m.pr.number)]));

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
      "Merge first": [1],
      "Merge later, carefully": [],
      "Waiting on CI": [2, 3],
      "Red CI": [4],
      Quarantined: [5, 6],
      Drafts: [7, 8],
    });
    expect(prs.map(home)).toEqual(["Merge first", "Waiting on CI", "Waiting on CI", "Red CI", "Quarantined", "Quarantined", "Drafts", "Drafts"]);
  });

  test("a green pull request with high or critical risk waits under merge later", () => {
    const prs = [pr(1, { labels: ["blast:high"] }), pr(2, { labels: ["blast:medium"] }), pr(3), pr(4, { labels: ["blast:critical"], ci: "failure" })];
    const got = numbers(place(prs, judged([], [[3, { value: "high", risk: "critical", why: "" }]])));
    expect(got["Merge first"]).toEqual([2]);
    expect(got["Merge later, carefully"]).toEqual([3, 1]);
    expect(got["Red CI"]).toEqual([4]);
  });

  test("merge order is twice the value minus the risk, then the oldest update", () => {
    const calls = judged(
      [],
      [
        [1, { value: "low", risk: "low", why: "" }],
        [2, { value: "critical", risk: "medium", why: "" }],
        [3, { value: "high", risk: "low", why: "" }],
        [4, { value: "medium", risk: "low", why: "" }],
        [5, { value: "medium", risk: "low", why: "" }],
      ],
    );
    const prs = [pr(1), pr(2), pr(3), pr(4, { updatedAt: ago(1) }), pr(5, { updatedAt: ago(6) }), pr(6)];
    expect(numbers(place(prs, calls))["Merge first"]).toEqual([2, 3, 5, 4, 6, 1]);
  });
});

describe("value and risk", () => {
  test("risk never drops below the blast label; value never below the worst issue it closes", () => {
    const severity = new Map([
      [10, "critical" as const],
      [11, "low" as const],
    ]);
    const call: PrCall = { value: "low", risk: "low", why: "w" };
    expect(merge(pr(1, { labels: ["blast:high"], closes: [10, 11, 99] }), call, severity)).toMatchObject({ value: "critical", risk: "high", why: "w" });
    expect(merge(pr(1, { labels: ["blast:low"] }), { value: "high", risk: "critical", why: "" }, severity)).toMatchObject({ value: "high", risk: "critical" });
  });

  test("without a judgment the blast label and closed issues still count, and the rest is unknown", () => {
    const severity = new Map([[10, "high" as const]]);
    expect(merge(pr(1, { labels: ["blast:medium"], closes: [10] }), null, severity)).toMatchObject({ value: "high", risk: "medium", why: "" });
    expect(merge(pr(1), null, severity)).toMatchObject({ value: null, risk: null });
  });

  test("unknown value and risk score as medium", () => {
    expect(mergeScore(merge(pr(1), null, new Map()))).toBe(1);
    expect(mergeScore(merge(pr(1), { value: "critical", risk: "low", why: "" }, new Map()))).toBe(6);
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
  test("ranked by severity, then the smaller fix, then thumbs up, then comments", () => {
    const calls = judged([
      [1, { severity: "medium", effort: "small", why: "" }],
      [2, { severity: "critical", effort: "large", why: "" }],
      [3, { severity: "medium", effort: "large", why: "" }],
      [4, { severity: "medium", effort: "small", why: "" }],
      [5, { severity: "low", effort: "small", why: "" }],
    ]);
    const ranked = rankIssues([issue(1, { comments: 3 }), issue(2), issue(3, { thumbsUp: 9 }), issue(4, { thumbsUp: 1 }), issue(5, { thumbsUp: 20 })], calls);
    expect(ranked.map((i) => i.number)).toEqual([2, 4, 1, 3, 5]);
  });

  test("without the model a bug counts as medium and the rest as low", () => {
    const ranked = rankIssues([issue(1, { thumbsUp: 5 }), issue(2, { labels: ["bug"] }), issue(3, { comments: 2 }), issue(4)]);
    expect(ranked.map((i) => i.number)).toEqual([2, 1, 3, 4]);
  });
});

describe("the body", () => {
  test("opens with the date, counts and what to do next; numbered lines with the verdict and why", () => {
    const calls = judged([[30, { severity: "high", effort: "small", why: "Sign-in fails for @everyone on https://x.y Linux." }]], [[12, { value: "high", risk: "low", why: "Fixes *the* crash." }]]);
    const body = render(
      [pr(12, { title: "Fix it", labels: ["size:S", "bug"], updatedAt: ago(3), closes: [30] }), pr(13, { title: "Wip", draft: true, labels: ["blast:high"] })],
      [issue(30, { title: "Broken", labels: ["bug"], thumbsUp: 2, createdAt: ago(0, 2), updatedAt: ago(0, 1) })],
      NOW,
      calls,
    );
    expect(body).toBe(
      [
        "Updated 2026-11-06 by kiwi-bus · 2 open PRs · 1 open issue",
        "**Next:** merge #12, then fix #30.",
        "",
        "### Merge first",
        "1. #12 Fix it · **high value, low risk** · Fixes \\*the\\* crash. · `@jo` · 3d · size:S",
        "",
        "### Fix first",
        "1. #30 Broken · **high, small fix** · Sign-in fails for `@everyone` on Linux. · `@ann` · today · bug 👍 2 · new",
        "",
        "### Drafts",
        "1. #13 Wip · **high risk** · `@jo` · 1d",
        "",
        "<sub>Value, risk, severity and effort judged by claude-haiku-5-5; risk never goes below a PR's blast label, and a PR's value never below the issues it closes.</sub>",
      ].join("\n"),
    );
  });

  test("a risky green pull request is not the next merge", () => {
    const body = render([pr(1, { labels: ["blast:critical"] })], [], NOW);
    expect(lines(body, "Merge later, carefully")).toEqual(["1. #1 PR 1 · **critical risk** · `@jo` · 1d"]);
    expect(body).not.toContain("**Next:**");
  });

  test("without judgments it still ranks, with no verdicts and no model note", () => {
    const body = render([pr(1, { updatedAt: ago(2) })], [issue(2, { labels: ["bug"] }), issue(3)], NOW);
    expect(body).toBe(
      [
        "Updated 2026-11-06 by kiwi-bus · 1 open PR · 2 open issues",
        "**Next:** merge #1, then fix #2.",
        "",
        "### Merge first",
        "1. #1 PR 1 · `@jo` · 2d",
        "",
        "### Fix first",
        "1. #2 Issue 2 · `@ann` · 2d · bug",
        "2. #3 Issue 3 · `@ann` · 2d",
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
    const first = lines(body, "Merge first");
    expect(first).toHaveLength(CAP + 1);
    expect(first[0]).toStartWith("1. #1 ");
    expect(first.at(-1)).toBe("- and 5 more");
    expect(lines(body, "Fix first").at(-1)).toBe("- and 1 more");
    expect(body).toStartWith("Updated 2026-11-06 by kiwi-bus · 30 open PRs · 26 open issues");
  });

  test("no update in 14 days is stale; an issue opened in the last 24 hours is new", () => {
    const body = render(
      [pr(1, { updatedAt: ago(STALE_DAYS) }), pr(2, { updatedAt: ago(STALE_DAYS - 1) })],
      [issue(3, { createdAt: ago(0, 23), updatedAt: ago(0, 23) }), issue(4, { createdAt: ago(1, 1), updatedAt: ago(20) })],
      NOW,
    );
    expect(lines(body, "Merge first")).toEqual(["1. #1 PR 1 · `@jo` · 14d · stale", "2. #2 PR 2 · `@jo` · 13d"]);
    expect(lines(body, "Fix first")).toEqual(["1. #3 Issue 3 · `@ann` · 1d · new", "2. #4 Issue 4 · `@ann` · 20d · stale"]);
  });

  test("ages count calendar days in UTC", () => {
    expect(daysSince("2026-11-06T00:00:00Z", NOW)).toBe(0);
    expect(daysSince("2026-11-05T23:59:59Z", new Date("2026-11-06T00:00:01Z"))).toBe(1);
    expect(daysSince("2026-10-23T12:00:00Z", NOW)).toBe(14);
  });

  test("titles can't mention people or bring in markdown and HTML", () => {
    expect(plain("  Thanks @someone-else for *this* <b>[x](y)</b> `z` R&D, not me@mail.com ")).toBe("Thanks `@someone-else` for \\*this\\* \\<b\\>\\[x\\](y)\\</b\\> \\`z\\` R\\&D, not me@mail.com");
  });

  test("the model's why loses links, mentions and markdown, and is cut on a word", () => {
    expect(brief("See https://evil.example/x and ping @jow <img src=x>")).toBe("See and ping `@jow` \\<img src=x\\>");
    const long = brief(`${"word ".repeat(60)}end`);
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long).toEndWith("word…");
  });

  test("cut keeps short text and ends long text on a whole word", () => {
    expect(cut("short", 10)).toBe("short");
    expect(cut("one two three four", 12)).toBe("one two…");
    expect(cut("abcdefghijklmnop", 8)).toBe("abcdefg…");
    expect(cut("one two, three", 10)).toBe("one two…");
  });
});

describe("asking the model", () => {
  const reply = (text: string): Response =>
    new Response(
      JSON.stringify({
        id: "m",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "text", text }],
      }),
      { headers: { "content-type": "application/json" } },
    );

  test("reads only well-formed judgments", () => {
    expect(readIssueCall('{"severity":"high","effort":"small","why":"w"}')).toEqual({ severity: "high", effort: "small", why: "w" });
    expect(readIssueCall('{"severity":"urgent","effort":"small","why":"w"}')).toBeNull();
    expect(readIssueCall("nope")).toBeNull();
    expect(readPrCall('{"value":"low","risk":"critical","why":""}')).toEqual({ value: "low", risk: "critical", why: "" });
    expect(readPrCall('{"value":"low"}')).toBeNull();
  });

  test("the input keeps untrusted text in tags and gives the facts as JSON", () => {
    const text = issueInput(issue(5, { body: "x".repeat(5000), recent: ["first", "second"], thumbsUp: 3 }), NOW);
    expect(text).toStartWith('<facts>\n{"number":5,"labels":[],"thumbsUp":3,"reactions":0,"comments":0,"ageDays":3}\n</facts>');
    expect(text).toContain("<comment>\nsecond\n</comment>");
    expect(text).not.toContain("x".repeat(4001));
    const severity = new Map([[7, "critical" as const]]);
    const p = prInput(pr(6, { labels: ["blast:medium"], closes: [7, 8], files: ["a.ts", "b.ts"] }), severity, new Map([[7, issue(7, { title: "Keys leak" })]]));
    expect(p).toContain('"blast":"medium"');
    expect(p).toContain('"closes":[{"number":7,"title":"Keys leak","severity":"critical"},{"number":8,"title":"","severity":"unknown"}]');
    expect(p).toContain("<files>\na.ts\nb.ts\n</files>");
  });

  test("judges issues first, then pull requests with the severity of what they close", async () => {
    const sent: Record<string, unknown>[] = [];
    const client = new Anthropic({
      apiKey: "test",
      maxRetries: 0,
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        sent.push(body);
        const content = String(body.messages[0].content);
        if (content.includes("<files>")) return reply('{"value":"medium","risk":"low","why":"Small fix."}');
        if (content.includes('"number":2,')) return new Response('{"type":"error","error":{"type":"overloaded_error","message":"busy"}}', { status: 529 });
        return reply('{"severity":"critical","effort":"small","why":"Keys leak."}');
      },
    });
    const calls = await judgeAll(client, [pr(9, { closes: [1] })], [issue(1), issue(2)], NOW);
    expect([...calls.issues]).toEqual([[1, { severity: "critical", effort: "small", why: "Keys leak." }]]);
    expect([...calls.prs]).toEqual([[9, { value: "medium", risk: "low", why: "Small fix." }]]);
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "low", format: { type: "json_schema" } } });
    expect(JSON.stringify(sent.at(-1))).toContain('\\"severity\\":\\"critical\\"');
    expect(merge(pr(9, { closes: [1] }), calls.prs.get(9) ?? null, new Map([[1, "critical"]])).value).toBe("critical");
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
  test("loadIssues reads every page, counts reactions and leaves out the tracker", async () => {
    const node = (number: number, more: Record<string, unknown> = {}): Record<string, unknown> => ({
      number,
      title: `T${number}`,
      body: "b",
      createdAt: ago(2),
      updatedAt: ago(1),
      author: { login: "ann" },
      labels: { nodes: [{ name: "bug" }] },
      reactionGroups: [
        { content: "THUMBS_UP", reactors: { totalCount: 2 } },
        { content: "HEART", reactors: { totalCount: 1 } },
      ],
      comments: { totalCount: 4, nodes: [{ body: "c1" }, { body: "c2" }] },
      ...more,
    });
    const seen: Record<string, string>[] = [];
    const { api } = fake({}, (variables) => {
      seen.push(variables);
      const page = variables.after
        ? { pageInfo: { hasNextPage: false, endCursor: "c2" }, nodes: [node(3, { author: null, reactionGroups: null, comments: null, body: null })] }
        : { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [node(1), node(TRACKER)] };
      return { repository: { issues: page } };
    });
    const issues = await loadIssues(api, "kiwi-init/channels");
    expect(seen).toEqual([
      { owner: "kiwi-init", name: "channels" },
      { owner: "kiwi-init", name: "channels", after: "c1" },
    ]);
    expect(issues).toEqual([
      { number: 1, title: "T1", author: "ann", labels: ["bug"], comments: 4, thumbsUp: 2, reactions: 3, createdAt: ago(2), updatedAt: ago(1), body: "b", recent: ["c1", "c2"] },
      { number: 3, title: "T3", author: "ghost", labels: ["bug"], comments: 0, thumbsUp: 0, reactions: 0, createdAt: ago(2), updatedAt: ago(1), body: "", recent: [] },
    ]);
  });

  test("loadIssues fails rather than report an empty list", async () => {
    await expect(loadIssues(fake({}, () => ({ repository: null })).api, "kiwi-init/channels")).rejects.toThrow("no issues");
  });

  test("loadPrs reads every page with ci-ok from the head commit's rollup, the files and what it closes", async () => {
    const node = (number: number, contexts: unknown[] | null): Record<string, unknown> => ({
      number,
      title: `P${number}`,
      body: number === 3 ? null : "why",
      isDraft: number === 2,
      createdAt: ago(3),
      updatedAt: ago(1),
      additions: 5,
      deletions: 1,
      author: number === 3 ? null : { login: "jo" },
      labels: { nodes: [{ name: "size:S" }] },
      files: { nodes: [{ path: "a.ts" }] },
      closingIssuesReferences: { nodes: number === 1 ? [{ number: 40 }] : [] },
      commits: { nodes: [{ commit: { statusCheckRollup: contexts === null ? null : { contexts: { nodes: contexts } } } }] },
    });
    const { api } = fake({}, (variables) => {
      const page = variables.after
        ? { pageInfo: { hasNextPage: false, endCursor: "c2" }, nodes: [node(3, null)] }
        : { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [node(1, [{ name: CHECK, status: "COMPLETED", conclusion: "FAILURE", startedAt: ago(1) }]), node(2, [])] };
      return { repository: { pullRequests: page } };
    });
    const prs = await loadPrs(api, "kiwi-init/channels");
    const base = { labels: ["size:S"], createdAt: ago(3), updatedAt: ago(1), additions: 5, deletions: 1, files: ["a.ts"] };
    expect(prs).toEqual([
      { ...base, number: 1, title: "P1", author: "jo", draft: false, ci: "failure", body: "why", closes: [40] },
      { ...base, number: 2, title: "P2", author: "jo", draft: true, ci: "missing", body: "why", closes: [] },
      { ...base, number: 3, title: "P3", author: "ghost", draft: false, ci: "missing", body: "", closes: [] },
    ]);
  });

  test("loadPrs fails rather than report no pull requests", async () => {
    await expect(loadPrs(fake({}, () => ({ repository: null })).api, "kiwi-init/channels")).rejects.toThrow("no pullRequests");
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
