import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { appJwt, githubAppFrom, pkcs8Of, REVIEW_CHECK } from "../src/relay/github-app.ts";
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
let github: ReturnType<typeof Bun.serve>;
let server: ReturnType<typeof startRelay>;
let relay: string;
let roomId: string;
let owner: Identity;
let member: Identity;
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-github-app-"));
const sha = "c".repeat(40);

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
      if (path === "/repos/ojow/channels") return Response.json({ default_branch: "main" });
      if (path === `/repos/ojow/channels/compare/main...${sha}`) return new Response("diff --git a/x b/x\n+hello\n");
      if (path === "/repos/ojow/channels/check-runs") return Response.json({ html_url: "https://github.com/ojow/channels/runs/1" }, { status: 201 });
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
  await ownerCh.setGithubRepos(["ojow/channels"]);
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
