import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { cleanGithubNote, type GithubNote } from "@kiwi/core/protocol.ts";
import { fold, prKey, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { applyGithub, type GithubState } from "@kiwi/core/state/github.ts";
import { startRelay } from "../src/relay/bun.ts";
import { githubItem, githubLinks, githubRepos, GITHUB_WEBHOOK_PATH } from "../src/relay/github.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const SECRET = "webhook-secret-for-tests";
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-github-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let roomId: string;
let owner: Identity;
let member: Identity;

beforeAll(async () => {
  server = startRelay({
    port: 0,
    hostname: "127.0.0.1",
    dataDir,
    human: devHumanAuth(),
    githubSecret: SECRET,
    githubPush: async (repo, token) => ({ ok: true, value: token !== "ghu_owner" || !repo.startsWith("ojow/") ? null : repo === "ojow/old-name" ? "Kiwi-Init/Channels" : repo }),
  });
  relay = server.url.origin;
  owner = await generateIdentity("alice");
  member = await generateIdentity("win");
  const made = await Channel.create(relay, owner, { name: "alice", kind: "human" }, [], undefined, "dev:alice");
  roomId = made.access.roomId;
  const ownerCh = new Channel(made.access, relay, owner);
  const ask = await Channel.requestJoin(relay, made.code, member, { name: "win" });
  await ownerCh.approve((await checked(ownerCh, relay, made.code, [{ id: member, requestId: ask.requestId }]))[0]!);
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function room(method: string, path: string, as: Identity, body?: unknown): Promise<Response> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers = { "content-type": "application/json", authorization: `Bearer ${await signRequest(as, roomId, method, path, text)}` };
  return fetch(`${relay}/v1/rooms/${roomId}${path}`, { method, headers, body: text || undefined });
}

async function hook(event: string, payload: unknown, secret = SECRET): Promise<Response> {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return fetch(`${relay}${GITHUB_WEBHOOK_PATH}`, { method: "POST", headers: { "x-github-event": event, "x-hub-signature-256": `sha256=${sig}` }, body });
}

const pr = (repo: string) => ({
  action: "closed",
  repository: { full_name: repo },
  sender: { login: "octocat" },
  pull_request: {
    number: 331,
    title: "Cards follow the branch",
    html_url: `https://github.com/${repo}/pull/331`,
    state: "closed",
    merged: true,
    head: { ref: "T39", sha: "a".repeat(40) },
    additions: 214,
    deletions: 12,
    changed_files: 9,
    body: "x".repeat(5000),
  },
});

type Queue = { repos: string[]; items: ({ id: number } & Record<string, unknown>)[] };

describe("GitHub webhooks into a channel's queue", () => {
  test("without the App's key, connecting a repo still takes the owner's token and push access to it", async () => {
    const no = await room("PUT", "/github/repos", owner, { repos: ["victim/private"] });
    expect(no.status).toBe(403);
    expect(((await no.json()) as { error: string }).error).toBe("link GitHub in Settings to connect a repo");
    const denied = await room("PUT", "/github/repos", owner, { repos: ["ojow/site", "victim/private"], token: "ghu_owner" });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: string }).error).toBe("your linked GitHub account can't push to victim/private");
    expect((await room("PUT", "/github/repos", owner, { repos: ["ojow/site"], token: "ghu_reader" })).status).toBe(403);
    expect(await (await room("PUT", "/github/repos", owner, { repos: [] })).json()).toEqual({ repos: [] });
  });

  test("the owner connects repos; a signed event for one lands, trimmed, in the queue only the owner reads", async () => {
    const set = await room("PUT", "/github/repos", owner, { repos: ["Ojow/Channels", "ojow/site"], token: "ghu_owner" });
    expect(await set.json()).toEqual({ repos: ["ojow/channels", "ojow/site"] });
    expect(await (await hook("pull_request", pr("ojow/channels"))).json()).toEqual({ queued: 1 });
    const q = (await (await room("GET", "/github/queue", owner)).json()) as Queue;
    expect(q.repos).toEqual(["ojow/channels", "ojow/site"]);
    expect(q.items).toHaveLength(1);
    const { id, at, ...item } = q.items[0]!;
    expect(item).toEqual({
      event: "pull_request",
      repo: "ojow/channels",
      action: "closed",
      number: 331,
      title: "Cards follow the branch",
      url: "https://github.com/ojow/channels/pull/331",
      state: "closed",
      merged: true,
      additions: 214,
      deletions: 12,
      files: 9,
      branch: "T39",
      sha: "a".repeat(40),
      by: "octocat",
    });
    expect(typeof at).toBe("number");
    expect((await room("GET", "/github/queue", member)).status).toBe(403);
    expect((await room("POST", "/github/ack", owner, { upTo: id })).status).toBe(200);
    expect(((await (await room("GET", "/github/queue", owner)).json()) as Queue).items).toEqual([]);
  });

  test("a repo connected under its old name is linked under GitHub's current one, so its events still land", async () => {
    const set = await room("PUT", "/github/repos", owner, { repos: ["ojow/old-name"], token: "ghu_owner" });
    expect(await set.json()).toEqual({ repos: ["kiwi-init/channels"] });
    expect(await (await hook("pull_request", pr("kiwi-init/channels"))).json()).toEqual({ queued: 1 });
    const q = (await (await room("GET", "/github/queue", owner)).json()) as Queue;
    expect(q.items.map((i) => i["repo"])).toEqual(["kiwi-init/channels"]);
    expect((await room("POST", "/github/ack", owner, { upTo: q.items[0]!.id })).status).toBe(200);
  });

  test("refused: a bad signature, a repo nobody connected, an event it doesn't take; a ping is fine", async () => {
    expect((await hook("pull_request", pr("ojow/channels"), "wrong")).status).toBe(401);
    expect(await (await hook("pull_request", pr("someone/else"))).json()).toEqual({ queued: 0 });
    expect(await (await hook("star", pr("ojow/channels"))).json()).toEqual({ ignored: "star" });
    expect(await (await hook("issues", pr("ojow/channels"))).json()).toEqual({ ignored: "issues" });
    expect((await hook("ping", { zen: "hi" })).status).toBe(200);
    expect(((await (await room("GET", "/github/queue", owner)).json()) as Queue).items).toEqual([]);
  });

  test("dropping a repo stops its events; closing the channel unlinks the rest", async () => {
    await room("PUT", "/github/repos", owner, { repos: ["ojow/site"], token: "ghu_owner" });
    expect(await (await hook("pull_request", pr("ojow/channels"))).json()).toEqual({ queued: 0 });
    expect(await (await hook("push", { ref: "refs/heads/main", after: "b".repeat(40), repository: { full_name: "ojow/site" } })).json()).toEqual({ queued: 1 });
    expect((await room("PUT", "/github/repos", owner, { repos: ["not a repo"] })).status).toBe(400);
    expect((await room("DELETE", "/", owner)).status).toBe(200);
    expect(await (await hook("push", { ref: "refs/heads/main", repository: { full_name: "ojow/site" } })).json()).toEqual({ queued: 0 });
  });

  test("a relay with neither the App nor a webhook secret takes a repo list as is: no GitHub event ever reaches it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-github-none-"));
    const none = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, human: devHumanAuth(), githubSecret: null, githubApp: null });
    try {
      const o = await generateIdentity("carol");
      const made = await Channel.create(none.url.origin, o, { name: "carol", kind: "human" }, [], undefined, "dev:carol");
      expect(await new Channel(made.access, none.url.origin, o).setGithubRepos(["ojow/site"])).toEqual(["ojow/site"]);
    } finally {
      none.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a relay without the secret has no webhook", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-github-off-"));
    const off = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, githubSecret: null });
    try {
      expect((await fetch(`${off.url.origin}${GITHUB_WEBHOOK_PATH}`, { method: "POST", body: "{}" })).status).toBe(404);
    } finally {
      off.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("what's kept of an event", () => {
  test("checks and workflow runs: name, status, conclusion, commit, branch, and which run (its id, and a workflow's attempt)", () => {
    const run = {
      action: "completed",
      repository: { full_name: "o/r" },
      check_run: {
        id: 41,
        name: "ci-ok",
        status: "completed",
        conclusion: "failure",
        head_sha: "c".repeat(40),
        html_url: "https://github.com/o/r/runs/1",
        check_suite: { head_branch: "T37" },
        output: { text: "x".repeat(9000) },
      },
    };
    expect(githubItem("check_run", run, 5)).toEqual({
      event: "check_run",
      repo: "o/r",
      at: 5,
      action: "completed",
      run: 41,
      name: "ci-ok",
      url: "https://github.com/o/r/runs/1",
      status: "completed",
      conclusion: "failure",
      sha: "c".repeat(40),
      branch: "T37",
    });
    const wf = {
      action: "completed",
      repository: { full_name: "o/r" },
      workflow_run: { id: 77, run_attempt: 2, name: "CI", status: "completed", conclusion: "success", head_sha: "d".repeat(40), head_branch: "main" },
    };
    const item = githubItem("workflow_run", wf, 6);
    expect(item).toMatchObject({ event: "workflow_run", name: "CI", conclusion: "success", branch: "main", run: 77, attempt: 2 });
    expect(cleanGithubNote(item)).toMatchObject({ run: 77, attempt: 2 });
    expect(cleanGithubNote({ ...item, run: -1 })).toBeNull();
    expect(githubItem("pull_request", { repository: { full_name: "not-a-repo" } }, 1)).toBeNull();
  });

  test("a PR's size rides along: a count of zero or more, kept on the PR the channel folds", () => {
    const note = cleanGithubNote({ event: "pull_request", repo: "o/r", number: 7, state: "open", additions: 30, deletions: 0, files: 2, at: 1 });
    expect(note).toMatchObject({ additions: 30, deletions: 0, files: 2 });
    expect(cleanGithubNote({ event: "pull_request", repo: "o/r", additions: -1, at: 1 })).toBeNull();
    expect(cleanGithubNote({ event: "pull_request", repo: "o/r", deletions: 1.5, at: 1 })).toBeNull();
    const g: GithubState = { prs: new Map(), checks: new Map(), issues: new Map(), rules: new Map(), releases: new Map() };
    applyGithub(g, [note!], 5);
    expect(g.prs.get(prKey("o/r", 7))).toMatchObject({ additions: 30, deletions: 0, files: 2 });
  });

  test("a note's link is a plain https link, or the note is dropped", () => {
    const at = { event: "pull_request", repo: "o/r", at: 1 };
    expect(cleanGithubNote({ ...at, url: "https://github.com/o/r/pull/7" })).toMatchObject({ url: "https://github.com/o/r/pull/7" });
    expect(cleanGithubNote({ ...at, url: "javascript:alert(1)" })).toBeNull();
    expect(cleanGithubNote({ ...at, url: "http://github.com/o/r/pull/7" })).toBeNull();
    expect(cleanGithubNote({ ...at, url: "https://user:pw@github.com/o/r" })).toBeNull();
    expect(cleanGithubNote({ ...at, url: "not a url" })).toBeNull();
  });

  test("a snapshot saved before that check keeps its PRs, checks and issues, minus any link that isn't plain https", async () => {
    const lead = await generateIdentity("lead");
    const roster: Roster = [{ name: "lead", pk: lead.pk, owner: true, at: 0, active: true, kind: "human" }];
    const items: GithubNote[] = [
      { event: "pull_request", repo: "o/r", number: 7, state: "open", url: "https://github.com/o/r/pull/7", at: 1 },
      { event: "issues", repo: "o/r", number: 8, state: "open", url: "https://github.com/o/r/issues/8", at: 1 },
      { event: "check_run", repo: "o/r", sha: "a".repeat(40), name: "ci", status: "completed", conclusion: "success", url: "https://github.com/o/r/runs/1", at: 1 },
    ];
    const kept: { base?: FoldBase } = {};
    fold(
      [{ v: 1, id: "m1", from: "lead", pk: lead.pk, sigOk: true, kind: "event", body: "GitHub", ts: 1, rts: 1, seq: 1, ev: { op: "github", items } }],
      roster,
      2,
      null,
      null,
      null,
      (b) => (kept.base = b),
    );
    const base = kept.base;
    if (!base?.github) throw new Error("the fold kept no GitHub state");
    const bad = "javascript:alert(1)";
    const old: FoldBase = {
      ...base,
      github: {
        ...base.github,
        prs: base.github.prs.map((p) => ({ ...p, url: bad })),
        issues: (base.github.issues ?? []).map((i) => ({ ...i, url: bad })),
        checks: base.github.checks.map(([k, runs]) => [k, runs.map((r) => ({ ...r, url: bad }))]),
      },
    };
    const good = fold([], roster, 3, null, null, base).github;
    expect(good.prs.get(prKey("o/r", 7))?.url).toBe("https://github.com/o/r/pull/7");
    const g = fold([], roster, 3, null, null, old).github;
    expect(g.prs.get(prKey("o/r", 7))).toMatchObject({ number: 7, state: "open" });
    expect(g.prs.get(prKey("o/r", 7))?.url).toBeUndefined();
    expect(g.issues.get(prKey("o/r", 8))?.url).toBeUndefined();
    expect([...g.checks.values()].flatMap((runs) => [...runs.values()]).map((r) => r.url)).toEqual([undefined]);
  });

  test("repos are owner/name, lowercased, at most 20; links say what was added and removed", () => {
    expect(githubRepos(["A/B", "a/b", "c/d"])).toEqual(["a/b", "c/d"]);
    expect(githubRepos(["a"])).toBeNull();
    expect(githubRepos(Array.from({ length: 21 }, (_, i) => `o/r${i}`))).toBeNull();
    expect(githubLinks("room1", ["a/b", "c/d"], ["c/d", "e/f"])).toEqual([
      { repo: "e/f", room: "room1", on: true },
      { repo: "a/b", room: "room1", on: false },
    ]);
  });
});
