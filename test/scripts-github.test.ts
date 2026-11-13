import { describe, expect, spyOn, test } from "bun:test";
import { github as sizeGithub } from "../scripts/pr-size.ts";
import { github as quarantineGithub } from "../scripts/quarantine.ts";
import { github as trackerGithub } from "../scripts/tracker.ts";
import { github as blastGithub } from "../scripts/blast-radius.ts";
import type { Rest } from "../scripts/github.ts";
import * as baseline from "./fixtures/github-clients.ts";

const REPO = "owner/repo";
const PATH = "/issues/7?per_page=100&page=2";

type Reply = { kind: "http"; status: number; body: string | null } | { kind: "network" };
const JSON_REPLY: Reply = { kind: "http", status: 200, body: '{"ok":true}' };

async function observe(run: () => Promise<unknown>, reply: Reply, root: string | undefined) {
  const previous = process.env.GITHUB_API_URL;
  if (root === undefined) delete process.env.GITHUB_API_URL;
  else process.env.GITHUB_API_URL = root;
  const calls: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];
  const logs: string[] = [];
  const logging = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  const fetching = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (...[input, init]: Parameters<typeof fetch>) => {
        calls.push({ method: init?.method ?? "GET", url: input instanceof Request ? input.url : String(input), headers: Object.fromEntries(new Headers(init?.headers)), body: init?.body });
        if (reply.kind === "network") throw new Error("connection failed");
        return new Response(reply.body, { status: reply.status });
      },
      { preconnect: () => {} },
    ),
  );
  try {
    try {
      return { calls, logs, outcome: { kind: "returned", value: await run() } };
    } catch (error) {
      return { calls, logs, outcome: { kind: "threw", message: error instanceof Error ? error.message : String(error) } };
    }
  } finally {
    fetching.mockRestore();
    logging.mockRestore();
    if (previous === undefined) delete process.env.GITHUB_API_URL;
    else process.env.GITHUB_API_URL = previous;
  }
}

interface RestCaller {
  name: string;
  before: (dry: boolean, read: string, write: string) => Rest;
  after: (dry: boolean, read: string, write: string) => Rest;
}

const callers: RestCaller[] = [
  { name: "pr-size", before: (dry, read) => baseline.prSize(REPO, read, dry), after: (dry, read) => sizeGithub(REPO, read, dry) },
  { name: "quarantine", before: (dry, read) => baseline.quarantine(REPO, read, dry).rest, after: (dry, read) => quarantineGithub(REPO, read, dry).rest },
  { name: "tracker", before: (dry, read, write) => baseline.tracker(REPO, read, write, dry).rest, after: (dry, read, write) => trackerGithub(REPO, read, write, dry).rest },
  { name: "blast-radius", before: (dry, read) => baseline.blastRadius(REPO, read, dry).rest, after: (dry, read) => blastGithub(REPO, read, dry).rest },
];

interface RestCase {
  name: string;
  method: string;
  body?: unknown;
  dry: boolean;
  reply: Reply;
}

const restCases: RestCase[] = [
  { name: "GET JSON", method: "GET", dry: false, reply: JSON_REPLY },
  { name: "GET body", method: "GET", body: { ignoredByTracker: true }, dry: false, reply: JSON_REPLY },
  { name: "POST JSON", method: "POST", body: { title: "a change" }, dry: false, reply: JSON_REPLY },
  { name: "PATCH null", method: "PATCH", body: null, dry: false, reply: JSON_REPLY },
  { name: "DELETE empty", method: "DELETE", dry: false, reply: { kind: "http", status: 204, body: null } },
  { name: "GET 404", method: "GET", dry: false, reply: { kind: "http", status: 404, body: "missing" } },
  { name: "DELETE 404", method: "DELETE", dry: false, reply: { kind: "http", status: 404, body: "missing" } },
  { name: "POST 404", method: "POST", body: {}, dry: false, reply: { kind: "http", status: 404, body: "missing" } },
  { name: "GET 500", method: "GET", dry: false, reply: { kind: "http", status: 500, body: "upstream failed" } },
  { name: "POST 403", method: "POST", body: {}, dry: false, reply: { kind: "http", status: 403, body: "forbidden" } },
  { name: "invalid JSON", method: "GET", dry: false, reply: { kind: "http", status: 200, body: "{" } },
  { name: "network failure", method: "GET", dry: false, reply: { kind: "network" } },
  { name: "dry GET", method: "GET", dry: true, reply: JSON_REPLY },
  { name: "dry POST with body", method: "POST", body: { labels: ["size:S"] }, dry: true, reply: JSON_REPLY },
  { name: "dry PATCH without body", method: "PATCH", dry: true, reply: JSON_REPLY },
  { name: "dry PATCH null", method: "PATCH", body: null, dry: true, reply: JSON_REPLY },
  { name: "dry DELETE", method: "DELETE", dry: true, reply: JSON_REPLY },
];

describe(`script transport equivalence with original callers at ${baseline.GITHUB_CLIENT_BASE}`, () => {
  for (const caller of callers) {
    for (const scenario of restCases) {
      test(`${caller.name}: ${scenario.name}`, async () => {
        for (const root of [undefined, "http://github.invalid/api/v3"]) {
          for (const [read, write] of [
            ["read-token", "write-token"],
            ["", ""],
            ["", "write-only"],
            ["read-only", ""],
          ]) {
            const before = await observe(() => caller.before(scenario.dry, read ?? "", write ?? "")(scenario.method, PATH, scenario.body), scenario.reply, root);
            const after = await observe(() => caller.after(scenario.dry, read ?? "", write ?? "")(scenario.method, PATH, scenario.body), scenario.reply, root);
            expect(after).toEqual(before);
            expect(after.calls.length).toBe(scenario.dry && scenario.method !== "GET" ? 0 : 1);
          }
        }
      });
    }
  }
});

const graphqlCallers = [
  { name: "quarantine", before: (dry: boolean, read: string) => baseline.quarantine(REPO, read, dry), after: (dry: boolean, read: string) => quarantineGithub(REPO, read, dry) },
  { name: "tracker", before: (dry: boolean, read: string) => baseline.tracker(REPO, read, "write-token", dry), after: (dry: boolean, read: string) => trackerGithub(REPO, read, "write-token", dry) },
];

const queries = [
  "mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { clientMutationId } }",
  "query($id: ID!) { repository(name: $id) { id } }",
  "query { viewer { login } }",
];
const graphReplies: Reply[] = [
  { kind: "http", status: 200, body: '{"data":{"id":"PR_7"}}' },
  { kind: "http", status: 200, body: '{"errors":[{"message":"no permission"}]}' },
  { kind: "http", status: 200, body: '{"data":null,"errors":[]}' },
  { kind: "http", status: 204, body: null },
  { kind: "http", status: 404, body: "missing" },
  { kind: "http", status: 500, body: "upstream failed" },
  { kind: "network" },
];

describe("GraphQL policy equivalence", () => {
  for (const caller of graphqlCallers) {
    for (const [index, reply] of graphReplies.entries()) {
      for (const dry of [false, true]) {
        test(`${caller.name}: response ${index}, dry ${dry}`, async () => {
          for (const root of [undefined, "http://github.invalid/api/v3"]) {
            for (const token of ["read-token", ""]) {
              for (const query of queries) {
                const variables = { id: "PR_7" };
                const before = await observe(() => caller.before(dry, token).graphql(query, variables), reply, root);
                const after = await observe(() => caller.after(dry, token).graphql(query, variables), reply, root);
                expect(after).toEqual(before);
                expect(after.calls.length).toBe(dry && caller.name === "quarantine" ? 0 : 1);
              }
            }
          }
        });
      }
    }
  }
});
