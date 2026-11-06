import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { b64url } from "@kiwi/core/crypto.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import type { Channel } from "@kiwi/core/client.ts";
import { startRelay } from "../src/relay/bun.ts";
import { githubAppFrom } from "../src/relay/github-app.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

const REPO = "ojow/channels";
const TTL_PAST = 121_000;
const shaOf = (c: string) => c.repeat(40);

type Reply = { status: number; body: Record<string, unknown> };
type Arrival = { sha: string; status: string; conclusion?: string; at: number; done?: number };

describe("the kiwi/review fence: a success computed from stale state can't win (T954, #623)", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-fence-relay-"));
  const arrivals: Arrival[] = [];
  let shift = 0;
  let skewNext = false;
  let slowSuccess = false;
  let github: ReturnType<typeof Bun.serve>;
  let server: ReturnType<typeof startRelay>;
  let owner: OwnerSetup;
  let dev: { id: Identity; ch: Channel };
  let rev: { id: Identity; ch: Channel };

  const now = () => {
    if (skewNext) {
      skewNext = false;
      return Date.now() - TTL_PAST;
    }
    return Date.now() + shift;
  };

  const call = async (who: Identity, path: string, payload: Record<string, unknown>): Promise<Reply> => {
    const body = JSON.stringify(payload);
    const auth = await signRequest(who, owner.roomId, "POST", path, body);
    const res = await fetch(new URL(`/v1/rooms/${owner.roomId}${path}`, server.url.origin), { method: "POST", body, headers: { "content-type": "application/json", authorization: `Bearer ${auth}` } });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const check = (who: Identity, sha: string, verdict: "approved" | "waiting" | "rejected", extra: Record<string, unknown> = {}) =>
    call(who, "/github/check", { repo: REPO, sha, verdict, tasks: [7], ...extra });
  const ticketOf = async (who: Identity, sha: string): Promise<string> => {
    const r = await check(who, sha, "waiting");
    expect(r.status).toBe(200);
    expect(typeof r.body.ticket).toBe("string");
    return String(r.body.ticket);
  };
  const send = (who: Identity, tickets: string[] = [], cid?: string) =>
    call(who, "/messages", { iv: "x", ct: "y", e: owner.ownerCh.access.epoch, ...(cid ? { cid } : {}), ...(tickets.length ? { tickets } : {}) });
  const seqOf = async (who: Identity, tickets: string[] = []): Promise<number> => {
    const r = await send(who, tickets);
    expect(r.status).toBe(200);
    return Number(r.body.seq);
  };
  const writesAt = (sha: string) => arrivals.filter((a) => a.sha === sha).map((a) => a.conclusion ?? a.status);

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
          const b = JSON.parse(text) as { head_sha: string; status: string; conclusion?: string };
          const seen: Arrival = { sha: b.head_sha, status: b.status, ...(b.conclusion ? { conclusion: b.conclusion } : {}), at: performance.now() };
          arrivals.push(seen);
          if (slowSuccess && b.conclusion === "success") await Bun.sleep(400);
          if (b.head_sha === shaOf("9") && b.status === "in_progress" && arrivals.filter((a) => a.sha === shaOf("9")).length === 1) skewNext = true;
          seen.done = performance.now();
          return Response.json({ html_url: `https://github.com/${REPO}/runs/${arrivals.length}` }, { status: 201 });
        }
        return new Response("nope", { status: 404 });
      },
    });
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, now, githubApp: githubAppFrom({ appId: "1", privateKey: pem, api: github.url.origin }) });
    owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    await owner.ownerCh.setGithubRepos([REPO], "ghu_owner");
    const computer = await pairComputer(owner.person);
    dev = await joinAgent(owner, "dev", computer);
    rev = await joinAgent(owner, "rev", computer);
  });
  afterAll(() => {
    server.stop(true);
    github.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("a downgrade's ack carries a ticket; a success computed before the ticketed change landed is refused, and one that folded it passes", async () => {
    const sha = shaOf("a");
    const t = await ticketOf(dev.id, sha);
    const before = await seqOf(owner.owner);
    const landed = await seqOf(dev.id, [t]);
    expect(await check(owner.owner, sha, "approved", { upTo: before })).toMatchObject({ status: 412, body: { tag: "Fenced" } });
    expect((await check(owner.owner, sha, "approved", { upTo: landed })).status).toBe(200);
    expect(writesAt(sha)).toEqual(["in_progress", "success"]);
  });

  test("a lower seq, or no upTo once a commit has a fence, is refused; a commit without one still takes an old app's success", async () => {
    expect((await check(owner.owner, shaOf("a"), "approved", { upTo: 1 })).status).toBe(412);
    expect((await check(owner.owner, shaOf("a"), "approved")).status).toBe(412);
    expect((await check(owner.owner, shaOf("b"), "approved")).status).toBe(200);
  });

  test("while a ticket is pending, no success passes, whatever upTo says", async () => {
    await ticketOf(dev.id, shaOf("c"));
    expect(await check(owner.owner, shaOf("c"), "approved", { upTo: 1_000_000 })).toMatchObject({ status: 412, body: { tag: "Fenced" } });
  });

  test("two members: B's change lands first while A's ticket is pending, so the success waits for A's change", async () => {
    const sha = shaOf("d");
    const a = await ticketOf(dev.id, sha);
    const b = await ticketOf(rev.id, sha);
    const bLanded = await seqOf(rev.id, [b]);
    expect((await check(owner.owner, sha, "approved", { upTo: bLanded })).status).toBe(412);
    const aLanded = await seqOf(dev.id, [a]);
    expect((await check(owner.owner, sha, "approved", { upTo: bLanded })).status).toBe(412);
    expect((await check(owner.owner, sha, "approved", { upTo: aLanded })).status).toBe(200);
  });

  test("a ticket is bound to the member who got it and is used once", async () => {
    const t = await ticketOf(dev.id, shaOf("e"));
    expect((await send(rev.id, [t])).status).toBe(412);
    expect((await send(dev.id, [t])).status).toBe(200);
    expect((await send(dev.id, [t])).status).toBe(412);
    expect((await send(dev.id, ["x".repeat(22)])).status).toBe(412);
  });

  test("a crash before delivery: the ticket expires, a late message with it is refused, and the check stayed at the downgrade until the owner's next success", async () => {
    const sha = shaOf("f");
    const t = await ticketOf(dev.id, sha);
    expect((await check(owner.owner, sha, "approved", { upTo: 1_000_000 })).status).toBe(412);
    shift = TTL_PAST;
    try {
      expect(await send(dev.id, [t])).toMatchObject({ status: 412, body: { tag: "Fenced" } });
      expect((await check(owner.owner, sha, "approved", { upTo: await seqOf(owner.owner) })).status).toBe(200);
    } finally {
      shift = 0;
    }
    expect(writesAt(sha)).toEqual(["in_progress", "success"]);
  });

  test("a lost delivery response: the retry with the same send id returns the first seq and stores nothing twice", async () => {
    const t = await ticketOf(dev.id, shaOf("7"));
    const cid = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const first = await send(dev.id, [t], cid);
    expect(first.status).toBe(200);
    const again = await send(dev.id, [t], cid);
    expect(again).toMatchObject({ status: 200, body: { seq: first.body.seq } });
    expect(await seqOf(owner.owner)).toBe(Number(first.body.seq) + 1);
  });

  test("a success whose GitHub write is slow finishes before a later downgrade's write starts, so GitHub's last kiwi/review is the downgrade", async () => {
    const sha = shaOf("8");
    slowSuccess = true;
    try {
      const success = check(owner.owner, sha, "approved");
      await Bun.sleep(50);
      const downgrade = check(dev.id, sha, "waiting");
      expect((await success).status).toBe(200);
      expect((await downgrade).status).toBe(200);
    } finally {
      slowSuccess = false;
    }
    const writes = arrivals.filter((a) => a.sha === sha);
    expect(writes.map((a) => a.conclusion ?? a.status)).toEqual(["success", "in_progress"]);
    expect(writes[1]!.at).toBeGreaterThanOrEqual(writes[0]!.done!);
  });

  test("a client whose ticket ran out before its message arrived posts a fresh downgrade and sends once", async () => {
    const sha = shaOf("9");
    dev.ch.downgradesFor = () => [{ repo: REPO, sha, verdict: "waiting", tasks: [7] }];
    try {
      const seq = await dev.ch.send("tray icon: broken on KDE");
      expect(seq).toBeGreaterThan(0);
    } finally {
      dev.ch.downgradesFor = null;
    }
    expect(writesAt(sha)).toEqual(["in_progress", "in_progress"]);
  });
});
