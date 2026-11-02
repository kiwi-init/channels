import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { githubTrouble, type GithubHealth, type GithubStatus } from "@kiwi/core/github-health.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { GITHUB_WEBHOOK_PATH } from "../src/relay/github.ts";
import { githubAppFrom } from "../src/relay/github-app.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const SECRET = "status-secret";

describe("the owner's app learns why GitHub sends a linked repo nothing", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-github-status-"));
  const bareDir = mkdtempSync(join(tmpdir(), "kiwi-github-status-bare-"));
  let github: ReturnType<typeof Bun.serve>;
  let server: ReturnType<typeof startRelay>;
  let bare: ReturnType<typeof startRelay>;
  let ownerCh: Channel;
  let memberCh: Channel;
  let bareCh: Channel;

  beforeAll(async () => {
    const keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8)).replace(/.{64}/g, "$&\n")}\n-----END PRIVATE KEY-----\n`;
    github = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/app") return Response.json({ slug: "kiwi-channels" });
        if (path === "/repos/ojow/channels/installation") return Response.json({ id: 42, events: ["pull_request", "check_run", "push", "workflow_run"] });
        if (path === "/repos/moved/channels/installation") return new Response("not installed", { status: 404 });
        if (path === "/repos/ojow/channels" || path === "/repos/moved/channels")
          return Response.json({ default_branch: "main", ...(req.headers.get("authorization") === "Bearer ghu_owner" ? { permissions: { push: true } } : {}) });
        return new Response("nope", { status: 404 });
      },
    });
    server = startRelay({
      port: 0,
      hostname: "127.0.0.1",
      dataDir,
      human: devHumanAuth(),
      githubSecret: SECRET,
      githubApp: githubAppFrom({ appId: "1234", privateKey: pem, api: github.url.origin }),
    });
    const relay = server.url.origin;
    const owner = await generateIdentity("alice");
    const member = await generateIdentity("win");
    const made = await Channel.create(relay, owner, { name: "alice", kind: "human" }, [], undefined, "dev:alice");
    ownerCh = new Channel(made.access, relay, owner);
    const ask = await Channel.requestJoin(relay, made.code, member, { name: "win" });
    await ownerCh.approve((await checked(ownerCh, relay, made.code, [{ id: member, requestId: ask.requestId }]))[0]!);
    memberCh = new Channel(made.access, relay, member);
    await ownerCh.setGithubRepos(["ojow/channels", "moved/channels"], "ghu_owner");

    bare = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: bareDir, human: devHumanAuth(), githubSecret: null, githubApp: null });
    const bareOwner = await generateIdentity("bob");
    const bareMade = await Channel.create(bare.url.origin, bareOwner, { name: "bob", kind: "human" }, [], undefined, "dev:bob");
    bareCh = new Channel(bareMade.access, bare.url.origin, bareOwner);
    await bareCh.setGithubRepos(["ojow/channels"]);
  });
  afterAll(() => {
    server.stop(true);
    bare.stop(true);
    github.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  });

  const hook = async (repo: string): Promise<number> => {
    const body = JSON.stringify({ ref: "refs/heads/main", after: "a".repeat(40), repository: { full_name: repo }, sender: { login: "ann" } });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    return (await fetch(`${server.url.origin}${GITHUB_WEBHOOK_PATH}`, { method: "POST", headers: { "x-github-event": "push", "x-hub-signature-256": `sha256=${sig}` }, body })).status;
  };

  test("names a repo the App isn't installed on, with the install link, and the events an installed one gets", async () => {
    const s = await ownerCh.githubStatus();
    expect(s.app).toBe(true);
    const by = new Map(s.repos.map((r) => [r.repo, r]));
    expect(by.get("ojow/channels")).toEqual({
      repo: "ojow/channels",
      last: null,
      installed: true,
      events: ["pull_request", "check_run", "push", "workflow_run"],
      install: "https://github.com/apps/kiwi-channels/installations/new",
    });
    expect(by.get("moved/channels")).toEqual({ repo: "moved/channels", last: null, installed: false, events: [], install: "https://github.com/apps/kiwi-channels/installations/new" });
  });

  test("says when GitHub last sent the repo news, per repo", async () => {
    const before = Date.now();
    expect(await hook("ojow/channels")).toBe(202);
    const s = await ownerCh.githubStatus();
    const last = s.repos.find((r) => r.repo === "ojow/channels")?.last;
    expect(last).toBeGreaterThanOrEqual(before);
    expect(s.repos.find((r) => r.repo === "moved/channels")?.last).toBeNull();
  });

  test("a relay with no GitHub App says so; a member can't ask", async () => {
    expect(await bareCh.githubStatus()).toEqual({ app: false, repos: [{ repo: "ojow/channels", last: null, installed: null, events: [], install: null }] });
    expect(await memberCh.githubStatus().catch((e: Error) => e.message)).toContain("owner");
  });
});

describe("what the owner's empty tab says", () => {
  const status = (repos: GithubStatus["repos"], app = true): GithubStatus => ({ app, repos });
  const repo = (name: string, more: Partial<GithubStatus["repos"][number]> = {}) => ({
    repo: name,
    last: null,
    installed: true,
    events: ["pull_request", "check_run", "issues", "push", "workflow_run"],
    install: "https://github.com/apps/kiwi-channels/installations/new",
    ...more,
  });
  const health = (s: GithubStatus | null, more: Partial<GithubHealth> = {}): GithubHealth => ({ status: s, errors: [], syncing: null, ...more });

  test("nothing until the first status comes, unless a chore already failed", () => {
    expect(githubTrouble(health(null), ["o/r"], "prs")).toBeNull();
    expect(githubTrouble(health(null, { errors: [{ what: "drain", message: "relay down", at: 1 }] }), ["o/r"], "prs")).toEqual({ kind: "failed", what: "drain", message: "relay down" });
  });

  test("the relay's missing App comes first, then a repo the App isn't installed on, then the events it doesn't get", () => {
    expect(githubTrouble(health(status([repo("o/r")], false)), ["o/r"], "prs")).toEqual({ kind: "no-app" });
    expect(githubTrouble(health(status([repo("o/r"), repo("moved/r", { installed: false })])), ["o/r", "moved/r"], "prs")).toEqual({
      kind: "not-installed",
      owner: "moved",
      install: "https://github.com/apps/kiwi-channels/installations/new",
    });
    const deaf = repo("o/r", { events: ["pull_request", "push"] });
    expect(githubTrouble(health(status([deaf])), ["o/r"], "prs")).toEqual({ kind: "events", owner: "o", missing: ["check_run"] });
    expect(githubTrouble(health(status([deaf])), ["o/r"], "issues")).toEqual({ kind: "events", owner: "o", missing: ["issues"] });
  });

  test("only the repos on show count: a filter on one repo ignores the others' troubles", () => {
    const s = status([repo("o/r", { last: 5 }), repo("moved/r", { installed: false })]);
    expect(githubTrouble(health(s), ["O/R"], "prs")).toEqual({ kind: "quiet", last: 5 });
    expect(githubTrouble(health(s, { errors: [{ what: "sync", repo: "moved/r", message: "nope", at: 1 }] }), ["o/r"], "prs")).toEqual({ kind: "quiet", last: 5 });
  });

  test("a sync in progress, then a failed chore, then the last news", () => {
    const s = status([repo("o/r", { last: 7 }), repo("o/s", { last: 9 })]);
    expect(githubTrouble(health(s, { syncing: "o/r" }), ["o/r", "o/s"], "issues")).toEqual({ kind: "syncing", repo: "o/r" });
    expect(githubTrouble(health(s, { errors: [{ what: "sync", repo: "o/s", message: "GitHub refused", at: 1 }] }), ["o/r", "o/s"], "prs")).toEqual({
      kind: "failed",
      what: "sync",
      repo: "o/s",
      message: "GitHub refused",
    });
    expect(githubTrouble(health(status([repo("o/r", { installed: null, error: "GitHub refused installation (502)" })])), ["o/r"], "prs")).toEqual({
      kind: "failed",
      what: "status",
      repo: "o/r",
      message: "GitHub refused installation (502)",
    });
    expect(githubTrouble(health(s), ["o/r", "o/s"], "prs")).toEqual({ kind: "quiet", last: 9 });
    expect(githubTrouble(health(status([repo("o/r")])), ["o/r"], "prs")).toEqual({ kind: "quiet", last: null });
  });
});
