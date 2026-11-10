import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import type { Channel } from "@kiwi/core/client.ts";
import { reviewCheckOf } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { githubAppFrom } from "../src/relay/github-app.ts";
import { RETIRED } from "../src/relay/review-host.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

const REPO = "ojow/channels";
const shaOf = (c: string) => c.repeat(40);

type Reply = { status: number; body: Record<string, unknown> };
type Write = { sha: string; name: string; conclusion?: string; title: string };

describe("kiwi/review is retired: the relay answers every head green and gates nothing (#3930 §5, case 15)", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-retired-relay-"));
  const writes: Write[] = [];
  let github: ReturnType<typeof Bun.serve>;
  let server: ReturnType<typeof startRelay>;
  let githubApp: ReturnType<typeof githubAppFrom>;
  let owner: OwnerSetup;
  let dev: { id: Identity; ch: Channel };

  const call = async (who: Identity, path: string, payload: Record<string, unknown>): Promise<Reply> => {
    const body = JSON.stringify(payload);
    const auth = await signRequest(who, owner.roomId, "POST", path, body);
    const res = await fetch(new URL(`/v1/rooms/${owner.roomId}${path}`, server.url.origin), { method: "POST", body, headers: { "content-type": "application/json", authorization: `Bearer ${auth}` } });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const oldCheck = (who: Identity, sha: string, verdict: "approved" | "waiting" | "rejected", extra: Record<string, unknown> = {}) =>
    call(who, "/github/check", { repo: REPO, sha, verdict, tasks: [7], ...extra });
  const send = (who: Identity, tickets: string[] = []) => call(who, "/messages", { iv: "x", ct: "y", e: owner.ownerCh.access.epoch, ...(tickets.length ? { tickets } : {}) });
  const at = (sha: string) => writes.filter((w) => w.sha === sha);
  const retired = (sha: string): Write => ({ sha, name: reviewCheckOf(owner.roomId), conclusion: "success", title: RETIRED.title });

  beforeAll(async () => {
    const keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign"])) as CryptoKeyPair;
    const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
    github = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const path = new URL(req.url).pathname;
        const text = await req.text();
        if (path === `/repos/${REPO}/installation`) return Response.json({ id: 1 });
        if (path === `/repos/${REPO}` && req.method === "GET") return Response.json({ permissions: { push: true } });
        if (path === "/app/installations/1/access_tokens") return Response.json({ token: "ghs_x", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
        if (path === `/repos/${REPO}/check-runs` && req.method === "POST") {
          const b = JSON.parse(text) as { head_sha: string; name: string; conclusion?: string; output: { title: string } };
          writes.push({ sha: b.head_sha, name: b.name, ...(b.conclusion ? { conclusion: b.conclusion } : {}), title: b.output.title });
          return Response.json({ html_url: `https://github.com/${REPO}/runs/${writes.length}` }, { status: 201 });
        }
        return new Response("nope", { status: 404 });
      },
    });
    githubApp = githubAppFrom({ appId: "1", privateKey: pem, api: github.url.origin });
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, githubApp });
    owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    await owner.ownerCh.setGithubRepos([REPO], "ghu_owner");
    dev = await joinAgent(owner, "dev", await pairComputer(owner.person));
  });
  afterAll(() => {
    server.stop(true);
    github.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("the owner's app retires a head: one green check under this channel's name, saying it is retired", async () => {
    const sha = shaOf("a");
    expect(await owner.ownerCh.retireReview({ repo: REPO, sha })).toEqual({ url: `https://github.com/${REPO}/runs/1` });
    expect(at(sha)).toEqual([retired(sha)]);
  });

  test("a head pushed later gets it too", async () => {
    const sha = shaOf("b");
    await owner.ownerCh.retireReview({ repo: REPO, sha });
    expect(at(sha)).toEqual([retired(sha)]);
  });

  test("only the owner's app asks for it", async () => {
    await expect(dev.ch.retireReview({ repo: REPO, sha: shaOf("c") })).rejects.toThrow();
    expect(at(shaOf("c"))).toEqual([]);
  });

  test("an older owner's app posting a success, or a failure, gets the retired green: no task's verdict reaches GitHub", async () => {
    const sha = shaOf("d");
    expect((await oldCheck(owner.owner, sha, "approved", { note: "Looks right.", upTo: 3 })).status).toBe(200);
    expect((await oldCheck(owner.owner, sha, "rejected")).status).toBe(200);
    expect((await oldCheck(owner.owner, sha, "waiting")).status).toBe(200);
    expect(at(sha)).toEqual([retired(sha), retired(sha), retired(sha)]);
  });

  test("an older member's downgrade is answered with no status and no ticket, so its send goes on without one", async () => {
    const sha = shaOf("e");
    const waiting = await oldCheck(dev.id, sha, "waiting");
    const rejected = await oldCheck(dev.id, sha, "rejected");
    expect(waiting).toEqual({ status: 200, body: { url: null } });
    expect(rejected).toEqual({ status: 200, body: { url: null } });
    expect(at(sha)).toEqual([]);
    const sent = await send(dev.id);
    expect(sent.status).toBe(200);
    expect(Number(sent.body.seq)).toBeGreaterThan(0);
  });

  test("a send still carrying a ticket from before the relay changed is stored, and nothing fences the green", async () => {
    const sha = shaOf("f");
    const sent = await send(dev.id, ["t".repeat(22)]);
    expect(sent.status).toBe(200);
    expect(Number(sent.body.seq)).toBeGreaterThan(0);
    expect((await oldCheck(owner.owner, sha, "approved")).status).toBe(200);
    expect(at(sha)).toEqual([retired(sha)]);
  });

  test("a relay restarted over a room that held a pending ticket drops the table and answers green", async () => {
    const sha = shaOf("9");
    server.stop(true);
    const file = new Database(join(dataDir, `${owner.roomId}.sqlite`));
    file.run("CREATE TABLE review_tickets (id TEXT PRIMARY KEY, key TEXT NOT NULL, holder TEXT NOT NULL, issued INTEGER NOT NULL, seq INTEGER)");
    file.run("INSERT INTO review_tickets (id, key, holder, issued, seq) VALUES (?, ?, ?, ?, NULL)", ["p".repeat(22), `${REPO}@${sha}`, dev.id.pk, Date.now()]);
    file.close();
    server = startRelay({ port: server.url.port ? Number(server.url.port) : 0, hostname: "127.0.0.1", dataDir, githubApp });
    expect((await send(dev.id, ["p".repeat(22)])).status).toBe(200);
    expect((await oldCheck(owner.owner, sha, "approved", { upTo: 0 })).status).toBe(200);
    expect(at(sha)).toEqual([retired(sha)]);
    const after = new Database(join(dataDir, `${owner.roomId}.sqlite`), { readonly: true });
    expect(after.query("SELECT name FROM sqlite_master WHERE name = 'review_tickets'").all()).toEqual([]);
    after.close();
  });

  test("a commit or a repo the channel doesn't hold is refused", async () => {
    expect((await call(owner.owner, "/github/check", { repo: "other/repo", sha: shaOf("a") })).status).toBe(400);
    expect((await call(owner.owner, "/github/check", { repo: REPO, sha: "nope" })).status).toBe(400);
  });
});
