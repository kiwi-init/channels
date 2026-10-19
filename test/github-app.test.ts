import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { appJwt, githubAppFrom, logExcerpt, pkcs8Of, REVIEW_CHECK } from "../src/relay/github-app.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const pem = (label: string, der: Uint8Array) => `-----BEGIN ${label}-----\n${btoa(String.fromCharCode(...der)).replace(/.{64}/g, "$&\n")}\n-----END ${label}-----\n`;

function innerOctets(pkcs8: Uint8Array): Uint8Array {
  let at = 0;
  const len = (): number => {
    const first = pkcs8[at++]!;
    if (first < 0x80) return first;
    let n = 0;
    for (let i = 0; i < (first & 0x7f); i++) n = (n << 8) | pkcs8[at++]!;
    return n;
  };
  const skip = () => {
    const n = len();
    at += n;
  };
  at++;
  len();
  at++;
  skip();
  at++;
  skip();
  at++;
  const n = len();
  return pkcs8.slice(at, at + n);
}

let keys: CryptoKeyPair;
let pkcs8: Uint8Array<ArrayBuffer>;
const calls: { method: string; path: string; auth: string; body: string }[] = [];
let ownerChannel: Channel;
let github: ReturnType<typeof Bun.serve>;
let server: ReturnType<typeof startRelay>;
let relay: string;
let roomId: string;
let owner: Identity;
let member: Identity;
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-github-app-"));
const sha = "c".repeat(40);
const JOB_LOG = [
  "2026-10-18T16:11:00.0000000Z ##[group]Run bun test",
  "2026-10-18T16:11:01.0000000Z bun test v1.4.2",
  "2026-10-18T16:11:02.0000000Z \u001b[31m(fail)\u001b[0m quote > names the sender",
  "2026-10-18T16:11:02.1000000Z error: expect(received).toContain(expected)",
  "2026-10-18T16:11:03.0000000Z ##[endgroup]",
  "2026-10-18T16:11:03.5000000Z ##[error]Process completed with exit code 1.",
  "2026-10-18T16:11:04.0000000Z Post job cleanup.",
].join("\n");

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  github = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const path = new URL(req.url).pathname;
      calls.push({ method: req.method, path, auth: req.headers.get("authorization") ?? "", body: await req.text() });
      if (path === "/repos/ojow/channels/installation") return Response.json({ id: 42 });
      if (path === "/app/installations/42/access_tokens") return Response.json({ token: "ghs_test", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
      if (path === "/repos/ojow/channels") {
        const user = req.headers.get("authorization");
        return Response.json({ default_branch: "main", ...(user === "Bearer ghu_owner" ? { permissions: { push: true } } : user === "Bearer ghu_reader" ? { permissions: { push: false } } : {}) });
      }
      if (path === `/repos/ojow/channels/compare/main...${sha}`) return new Response("diff --git a/x b/x\n+hello\n");
      if (path === "/repos/ojow/channels/check-runs") return Response.json({ html_url: "https://github.com/ojow/channels/runs/1" }, { status: 201 });
      if (path === "/repos/ojow/channels/issues/7/comments") return Response.json({ html_url: "https://github.com/ojow/channels/pull/7#issuecomment-1" }, { status: 201 });
      if (path === "/repos/ojow/channels/issues/12" && req.method === "GET")
        return Response.json({ title: "Copy icons do nothing", body: "On code blocks and the invite.", html_url: "https://github.com/ojow/channels/issues/12", state: "open" });
      if (path === "/repos/ojow/channels/issues/12" && req.method === "PATCH") return Response.json({ html_url: "https://github.com/ojow/channels/issues/12", state: "closed" });
      if (path === "/repos/ojow/channels/issues/12/comments") return Response.json({ html_url: "https://github.com/ojow/channels/issues/12#issuecomment-2" }, { status: 201 });
      if (path === "/repos/ojow/channels/issues/7") return Response.json({ title: "A PR", html_url: "https://github.com/ojow/channels/pull/7", state: "open", pull_request: {} });
      if (path === `/repos/ojow/channels/commits/${sha}/check-runs`) {
        const id = { "test / unit": 77, "repo / static": 78 }[new URL(req.url).searchParams.get("check_name") ?? ""];
        return Response.json({ check_runs: id ? [{ id, html_url: `https://github.com/ojow/channels/actions/runs/9/job/${id}`, output: { title: null, summary: null } }] : [] });
      }
      if (path === "/repos/ojow/channels/actions/jobs/77/logs") return new Response(JOB_LOG);
      if (path === "/repos/ojow/channels/actions/jobs/78/logs") return new Response("forbidden", { status: 403 });
      if (path === "/repos/ojow/channels/check-runs/78/annotations")
        return Response.json([
          { path: "web/src/x.ts", start_line: 3, message: "'cx' is declared but never used", annotation_level: "failure" },
          { path: ".github", message: "Process completed with exit code 1.", annotation_level: "failure" },
          { path: "web/src/y.ts", message: "just a warning", annotation_level: "warning" },
        ]);
      return new Response("nope", { status: 404 });
    },
  });
  const app = githubAppFrom({ appId: "1234", privateKey: pem("PRIVATE KEY", pkcs8), api: github.url.origin });
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth(), githubApp: app });
  relay = server.url.origin;
  owner = await generateIdentity("alice");
  member = await generateIdentity("win");
  const made = await Channel.create(relay, owner, { name: "alice", kind: "human" }, [], undefined, "dev:alice");
  roomId = made.access.roomId;
  const ownerCh = new Channel(made.access, relay, owner);
  const ask = await Channel.requestJoin(relay, made.code, member, { name: "win" });
  await ownerCh.approve((await checked(ownerCh, relay, made.code, [{ id: member, requestId: ask.requestId }]))[0]!);
  await ownerCh.setGithubRepos(["ojow/channels"], "ghu_owner");
  ownerChannel = ownerCh;
});
afterAll(() => {
  server.stop(true);
  github.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function room(method: string, path: string, as: Identity, body?: unknown): Promise<Response> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers = { "content-type": "application/json", authorization: `Bearer ${await signRequest(as, roomId, method, path, text)}` };
  return fetch(`${relay}/v1/rooms/${roomId}${path}`, { method, headers, body: text || undefined });
}

describe("the App's key", () => {
  test("a PKCS#1 key (what GitHub downloads) is the same key as its PKCS#8 form", () => {
    expect(pkcs8Of(pem("RSA PRIVATE KEY", innerOctets(pkcs8)))).toEqual(pkcs8);
    expect(pkcs8Of(pem("PRIVATE KEY", pkcs8))).toEqual(pkcs8);
  });

  test("the App's JWT is RS256, signed by the key, issued by the App, for under 10 minutes", async () => {
    const jwt = await appJwt("1234", pem("RSA PRIVATE KEY", innerOctets(pkcs8)), 1_700_000_000_000);
    const [h, p, s] = jwt.split(".") as [string, string, string];
    const dec = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(dec(h)))).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(new TextDecoder().decode(dec(p)))).toEqual({ iat: 1_699_999_940, exp: 1_700_000_540, iss: "1234" });
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", keys.publicKey, dec(s), new TextEncoder().encode(`${h}.${p}`))).toBe(true);
  });

  test("without an id and a key, there's no App", () => {
    expect(githubAppFrom({ appId: "1", privateKey: "" })).toBeNull();
    expect(githubAppFrom({ appId: "", privateKey: pem("PRIVATE KEY", pkcs8) })).toBeNull();
  });
});

describe("diffs and review checks through the relay", () => {
  test("a member reads the diff of a commit in a connected repo, against the default branch", async () => {
    const res = await room("GET", `/github/diff?repo=ojow/channels&sha=${sha}`, member);
    expect(await res.json()).toEqual({ diff: "diff --git a/x b/x\n+hello\n", base: "main", truncated: false });
    expect(calls.find((c) => c.path === "/app/installations/42/access_tokens")?.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(calls.find((c) => c.path.startsWith("/repos/ojow/channels/compare"))?.auth).toBe("Bearer ghs_test");
    expect((await room("GET", `/github/diff?repo=someone/else&sha=${sha}`, member)).status).toBe(400);
    expect((await room("GET", "/github/diff?repo=ojow/channels&sha=nope", member)).status).toBe(400);
  });

  test("only the owner posts the kiwi/review check, with the verdict as its conclusion", async () => {
    const body = { repo: "ojow/channels", sha, verdict: "approved", task: 45, note: "Looks right." };
    expect((await room("POST", "/github/check", member, body)).status).toBe(403);
    expect(await (await room("POST", "/github/check", owner, body)).json()).toEqual({ url: "https://github.com/ojow/channels/runs/1" });
    const posted = JSON.parse(calls.filter((c) => c.path === "/repos/ojow/channels/check-runs").at(-1)!.body) as Record<string, unknown>;
    expect(posted).toEqual({ name: REVIEW_CHECK, head_sha: sha, status: "completed", conclusion: "success", output: { title: "T45 approved in Kiwi", summary: "Looks right." } });
    await room("POST", "/github/check", owner, { ...body, verdict: "rejected", note: "" });
    expect(JSON.parse(calls.filter((c) => c.path === "/repos/ojow/channels/check-runs").at(-1)!.body)).toMatchObject({
      conclusion: "failure",
      output: { title: "T45: changes requested in Kiwi", summary: "Changes requested." },
    });
    expect((await room("POST", "/github/check", owner, { ...body, verdict: "maybe" })).status).toBe(400);
  });

  test("only the owner comments on a PR of a connected repo (the link back to its task)", async () => {
    const body = { repo: "ojow/channels", number: 7, body: "Kiwi task T72: Branch PRs" };
    expect((await room("POST", "/github/comment", member, body)).status).toBe(403);
    expect((await room("POST", "/github/comment", owner, { ...body, repo: "someone/else" })).status).toBe(400);
    expect(await (await room("POST", "/github/comment", owner, body)).json()).toEqual({ url: "https://github.com/ojow/channels/pull/7#issuecomment-1" });
    expect(JSON.parse(calls.filter((c) => c.path === "/repos/ojow/channels/issues/7/comments").at(-1)!.body)).toEqual({ body: "Kiwi task T72: Branch PRs" });
  });

  test("a member reads an issue of a connected repo, to import it as a task; a PR's number isn't an issue", async () => {
    expect(await (await room("GET", "/github/issue?repo=ojow/channels&number=12", member)).json()).toEqual({
      repo: "ojow/channels",
      number: 12,
      title: "Copy icons do nothing",
      body: "On code blocks and the invite.",
      url: "https://github.com/ojow/channels/issues/12",
      state: "open",
    });
    const pr = await room("GET", "/github/issue?repo=ojow/channels&number=7", member);
    expect(pr.status).toBe(400);
    expect(((await pr.json()) as { error: string }).error).toBe("ojow/channels#7 is a pull request, not an issue");
    expect((await room("GET", "/github/issue?repo=someone/else&number=12", member)).status).toBe(400);
    expect((await room("GET", "/github/issue?repo=ojow/channels&number=x", member)).status).toBe(400);
    expect((await room("GET", "/github/issue?repo=ojow/channels&number=99", member)).status).toBe(404);
  });

  test("only the owner closes an issue: a comment saying why, then closed with GitHub's reason", async () => {
    const body = { repo: "ojow/channels", number: 12, reason: "not_planned", body: "Kiwi task T9 cancelled: duplicate" };
    expect((await room("POST", "/github/issue/close", member, body)).status).toBe(403);
    expect((await room("POST", "/github/issue/close", owner, { ...body, reason: "done" })).status).toBe(400);
    expect((await room("POST", "/github/issue/close", owner, { ...body, repo: "someone/else" })).status).toBe(400);
    const before = calls.length;
    expect(await (await room("POST", "/github/issue/close", owner, body)).json()).toEqual({ url: "https://github.com/ojow/channels/issues/12" });
    const made = calls.slice(before).filter((c) => c.path.startsWith("/repos/ojow/channels/issues/12"));
    expect(made.map((c) => [c.method, c.path, JSON.parse(c.body)])).toEqual([
      ["POST", "/repos/ojow/channels/issues/12/comments", { body: "Kiwi task T9 cancelled: duplicate" }],
      ["PATCH", "/repos/ojow/channels/issues/12", { state: "closed", state_reason: "not_planned" }],
    ]);
  });

  test("connecting a repo takes the owner's linked GitHub token, and push access to it", async () => {
    expect(ownerChannel.setGithubRepos(["ojow/channels"])).rejects.toThrow(/link GitHub in Settings/);
    expect(ownerChannel.setGithubRepos(["ojow/channels"], "ghu_reader")).rejects.toThrow(/can't push to ojow\/channels/);
    expect(await ownerChannel.setGithubRepos(["ojow/channels"], "ghu_owner")).toEqual(["ojow/channels"]);
  });

  test("the owner's token is used for that one check and nothing else", () => {
    const used = calls.filter((c) => c.auth.startsWith("Bearer ghu_"));
    expect(used.length).toBeGreaterThan(0);
    expect(used.every((c) => c.method === "GET" && c.path === "/repos/ojow/channels")).toBe(true);
  });

  test("a relay without the App answers 404", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-github-app-off-"));
    const off = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, human: devHumanAuth(), githubApp: null });
    try {
      const o = await generateIdentity("bob");
      const made = await Channel.create(off.url.origin, o, { name: "bob", kind: "human" }, [], undefined, "dev:bob");
      const ch = new Channel(made.access, off.url.origin, o);
      await ch.setGithubRepos(["ojow/channels"]);
      const path = `/github/diff?repo=ojow/channels&sha=${sha}`;
      const res = await fetch(`${off.url.origin}/v1/rooms/${made.access.roomId}${path}`, { headers: { authorization: `Bearer ${await signRequest(o, made.access.roomId, "GET", path, "")}` } });
      expect(res.status).toBe(404);
    } finally {
      off.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a red check's log, for the task CI red becomes", () => {
  test("the excerpt is the lines before the first error, without timestamps, colours or group markers", () => {
    expect(logExcerpt(JOB_LOG)).toBe("bun test v1.4.2\n(fail) quote > names the sender\nerror: expect(received).toContain(expected)\n##[error]Process completed with exit code 1.");
    expect(logExcerpt("all good\nnothing failed")).toBe("");
  });

  test("only the owner reads it; from the job's log, else from the check's failure annotations", async () => {
    const q = (name: string) => `/github/check-log?repo=ojow/channels&sha=${sha}&name=${encodeURIComponent(name)}`;
    expect((await room("GET", q("test / unit"), member)).status).toBe(403);
    expect(await (await room("GET", q("test / unit"), owner)).json()).toEqual({
      excerpt: "bun test v1.4.2\n(fail) quote > names the sender\nerror: expect(received).toContain(expected)\n##[error]Process completed with exit code 1.",
      url: "https://github.com/ojow/channels/actions/runs/9/job/77",
      from: "log",
    });
    expect(await (await room("GET", q("repo / static"), owner)).json()).toEqual({
      excerpt: "web/src/x.ts:3: 'cx' is declared but never used\nProcess completed with exit code 1.",
      url: "https://github.com/ojow/channels/actions/runs/9/job/78",
      from: "annotations",
    });
    expect((await room("GET", q("no such check"), owner)).status).toBe(404);
    expect((await room("GET", `/github/check-log?repo=someone/else&sha=${sha}&name=x`, owner)).status).toBe(400);
    expect((await room("GET", `/github/check-log?repo=ojow/channels&sha=${sha}`, owner)).status).toBe(400);
  });
});
