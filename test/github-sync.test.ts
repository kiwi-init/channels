import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { GITHUB_SYNCED, isQuiet, type GithubNote } from "@kiwi/core/protocol.ts";
import { fold, githubNews, prChecks, prKey, toRoster, type ChannelState } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { githubAppFrom } from "../src/relay/github-app.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const DAY = 86_400_000;
const iso = (ago: number) => new Date(Date.now() - ago).toISOString();

const pr = (number: number, state: "OPEN" | "CLOSED" | "MERGED", ago: number, more: Record<string, unknown> = {}) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/ojow/channels/pull/${number}`,
  state,
  mergeCommit: state === "MERGED" ? { oid: "m".repeat(40) } : null,
  headRefName: `T${number}-work`,
  headRefOid: `${number}`.padStart(40, "a"),
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  author: { login: "ann" },
  updatedAt: iso(ago),
  closedAt: state === "OPEN" ? null : iso(ago),
  ...more,
});

const issue = (number: number, state: "OPEN" | "CLOSED", ago: number) => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/ojow/channels/issues/${number}`,
  state,
  stateReason: state === "CLOSED" ? "NOT_PLANNED" : null,
  author: { login: "win" },
  updatedAt: iso(ago),
  closedAt: state === "OPEN" ? null : iso(ago),
});

const checks = (names: [string, string, string | null][]) => ({
  commits: {
    nodes: [
      {
        commit: {
          checkSuites: {
            nodes: [
              { checkRuns: { nodes: names.map(([name]) => ({ databaseId: 1, name, status: "COMPLETED", conclusion: "CANCELLED", url: "https://github.com/ojow/channels/runs/1" })) } },
              {
                checkRuns: {
                  nodes: names.map(([name, status, conclusion], i) => ({
                    databaseId: 100 + i,
                    name,
                    status,
                    conclusion,
                    url: `https://github.com/ojow/channels/runs/${100 + i}`,
                    startedAt: iso(DAY),
                  })),
                },
              },
            ],
          },
        },
      },
    ],
  },
});

describe("the owner's app fills the GitHub tab with what a linked repo already has", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-github-sync-"));
  let github: ReturnType<typeof Bun.serve>;
  let server: ReturnType<typeof startRelay>;
  let ownerCh: Channel;
  let memberCh: Channel;
  const asked: { list: string; after: unknown; since: unknown }[] = [];
  let openPrs: unknown[] = [];

  beforeAll(async () => {
    const keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8)).replace(/.{64}/g, "$&\n")}\n-----END PRIVATE KEY-----\n`;
    openPrs = [
      pr(
        7,
        "OPEN",
        DAY,
        checks([
          ["ci-ok", "COMPLETED", "SUCCESS"],
          ["perf", "IN_PROGRESS", null],
        ]),
      ),
    ];
    github = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/repos/ojow/channels/installation") return Response.json({ id: 42 });
        if (path === "/repos/elsewhere/gone/installation") return new Response("not installed", { status: 404 });
        if (path === "/app/installations/42/access_tokens") return Response.json({ token: "ghs_test", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
        if (path === "/repos/ojow/channels" || path === "/repos/elsewhere/gone")
          return Response.json({ default_branch: "main", ...(req.headers.get("authorization") === "Bearer ghu_owner" ? { permissions: { push: true } } : {}) });
        if (path !== "/graphql") return new Response("nope", { status: 404 });
        const { query, variables } = (await req.json()) as { query: string; variables: { after: unknown; since?: unknown } };
        const list = query.includes("pullRequests(states: OPEN")
          ? "open-prs"
          : query.includes("pullRequests(states: [CLOSED, MERGED]")
            ? "closed-prs"
            : query.includes("issues(states: OPEN")
              ? "open-issues"
              : "closed-issues";
        asked.push({ list, after: variables.after, since: variables.since });
        const page = (nodes: unknown[], next: string | null) =>
          Response.json({ data: { repository: { nameWithOwner: "ojow/Channels", list: { nodes, pageInfo: { hasNextPage: !!next, endCursor: next } } } } });
        if (list === "open-prs") return page(openPrs, null);
        if (list === "closed-prs")
          return variables.after === null ? page([pr(6, "MERGED", 2 * DAY), pr(5, "CLOSED", 3 * DAY)], "p2") : page([pr(4, "MERGED", 29 * DAY), pr(3, "MERGED", 40 * DAY)], "p3");
        if (list === "open-issues") return page([issue(9, "OPEN", 50 * DAY)], null);
        return page([issue(8, "CLOSED", 5 * DAY)], null);
      },
    });
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth(), githubApp: githubAppFrom({ appId: "1234", privateKey: pem, api: github.url.origin }) });
    const relay = server.url.origin;
    const owner = await generateIdentity("alice");
    const member = await generateIdentity("win");
    const made = await Channel.create(relay, owner, { name: "alice", kind: "human" }, [], undefined, "dev:alice");
    ownerCh = new Channel(made.access, relay, owner);
    const ask = await Channel.requestJoin(relay, made.code, member, { name: "win" });
    await ownerCh.approve((await checked(ownerCh, relay, made.code, [{ id: member, requestId: ask.requestId }]))[0]!);
    memberCh = new Channel(made.access, relay, member);
    await ownerCh.setGithubRepos(["ojow/channels", "elsewhere/gone"], "ghu_owner");
  });
  afterAll(() => {
    server.stop(true);
    github.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  const folded = async (): Promise<ChannelState> => fold((await ownerCh.history(0)).messages, (await ownerCh.members()).map(toRoster));

  test("posts open PRs with their checks, open issues, and what closed in the last 30 days, quietly; a second sync posts nothing", async () => {
    expect(await ownerCh.syncGithub("ojow/channels", (await folded()).github)).toBe(8);
    expect(asked.filter((a) => a.list === "closed-prs").map((a) => a.after)).toEqual([null, "p2"]);
    expect(asked.find((a) => a.list === "closed-issues")?.since).toBeString();
    const s = await folded();
    const g = s.github;
    expect([...g.prs.values()].map((p) => [p.number, p.state]).sort()).toEqual([
      [4, "merged"],
      [5, "closed"],
      [6, "merged"],
      [7, "open"],
    ]);
    const open = g.prs.get(prKey("ojow/channels", 7))!;
    expect(open).toMatchObject({ repo: "ojow/Channels", title: "PR 7", branch: "T7-work", by: "ann", additions: 10, deletions: 2, files: 3 });
    expect(prChecks(g, open).map((c) => [c.name, c.status, c.conclusion])).toEqual([
      ["ci-ok", "completed", "success"],
      ["perf", "in_progress", undefined],
    ]);
    expect(g.prs.get(prKey("ojow/channels", 6))?.merge).toBe("m".repeat(40));
    expect([...g.issues.values()].map((i) => [i.number, i.state, i.reason]).sort()).toEqual([
      [8, "closed", "not_planned"],
      [9, "open", undefined],
    ]);
    const posted = (await ownerCh.history(0)).messages.filter((m) => m.ev?.op === "github");
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((m) => isQuiet(m))).toBe(true);
    expect(await ownerCh.syncGithub("ojow/channels", s.github)).toBe(0);
  });

  test("posts again only what changed: a new check result and a PR that merged", async () => {
    openPrs = [pr(7, "MERGED", 0), pr(10, "OPEN", 0, checks([["ci-ok", "COMPLETED", "FAILURE"]]))];
    expect(await ownerCh.syncGithub("ojow/channels", (await folded()).github)).toBe(3);
    const g = (await folded()).github;
    expect(g.prs.get(prKey("ojow/channels", 7))?.state).toBe("merged");
    expect(prChecks(g, g.prs.get(prKey("ojow/channels", 10))!).map((c) => c.conclusion)).toEqual(["failure"]);
  });

  test("refuses a member, a repo the channel hasn't linked, and says when the App isn't installed", async () => {
    expect(await memberCh.syncGithub("ojow/channels", (await folded()).github).catch((e: Error) => e.message)).toContain("owner");
    expect(await ownerCh.syncGithub("ojow/other", (await folded()).github).catch((e: Error) => e.message)).toContain("connected repos");
    expect(await ownerCh.syncGithub("elsewhere/gone", (await folded()).github).catch((e: Error) => e.message)).toContain("installed");
  });
});

describe("what a sync adds to what the channel already knows", () => {
  const empty = (): ChannelState["github"] => ({ prs: new Map(), checks: new Map(), issues: new Map(), rules: new Map(), releases: new Map(), runs: new Map(), runsSince: null, runsForgotten: null });
  const note = (n: Partial<GithubNote>): GithubNote => ({ event: "pull_request", repo: "o/r", at: 1, action: GITHUB_SYNCED, ...n });

  test("keeps what's new or different, drops what's the same, and never steps back to an older run", () => {
    const g = empty();
    g.prs.set(prKey("o/r", 1), { repo: "o/r", number: 1, title: "One", state: "merged", at: 1, seq: 1 });
    g.prs.set(prKey("o/r", 2), { repo: "o/r", number: 2, title: "Two", state: "open", sha: "a".repeat(40), at: 1, seq: 1 });
    g.issues.set(prKey("o/r", 3), { repo: "o/r", number: 3, title: "Three", state: "open", at: 1, seq: 1 });
    g.checks.set(`o/r@${"a".repeat(40)}`, new Map([["ci", { name: "ci", status: "completed", conclusion: "success", run: 5, at: 1 }]]));
    const same = [
      note({ number: 1, title: "One", state: "closed", merged: true }),
      note({ number: 2, title: "Two", state: "open", sha: "a".repeat(40) }),
      note({ event: "issues", number: 3, title: "Three", state: "open" }),
      note({ event: "check_run", name: "ci", sha: "a".repeat(40), run: 5, status: "completed", conclusion: "success" }),
      note({ event: "check_run", name: "ci", sha: "a".repeat(40), run: 4, status: "completed", conclusion: "failure" }),
    ];
    expect(githubNews(g, same)).toEqual([]);
    const changed = [
      note({ number: 2, title: "Two", state: "open", sha: "b".repeat(40) }),
      note({ event: "issues", number: 3, title: "Three", state: "closed" }),
      note({ event: "check_run", name: "ci", sha: "a".repeat(40), run: 6, status: "in_progress" }),
      note({ number: 4, title: "Four", state: "open" }),
    ];
    expect(githubNews(g, changed)).toEqual(changed);
  });
});
