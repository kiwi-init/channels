import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import type { CheckArtifact } from "@kiwi/core/checks.ts";
import type { Event } from "@kiwi/core/protocol.ts";
import { shipGate } from "@kiwi/core/ship-gate.ts";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { startRelay } from "../src/relay/bun.ts";
import { githubAppFrom } from "../src/relay/github-app.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

const REPO = "ojow/channels";
const SHA = "a".repeat(40);
const ON_PR: CheckArtifact = { kind: "pr", repo: REPO, pr: 9, sha: SHA };

describe("rule 1: an agent's gate-shutting change goes out only after kiwi/review turned non-green (#623)", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-gate-relay-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-gate-home-"));
  const was = process.env.KIWI_HOME;
  const posted: Record<string, unknown>[] = [];
  let checks: "up" | "down" | "refused" = "up";
  let github: ReturnType<typeof Bun.serve>;
  let server: ReturnType<typeof startRelay>;
  let owner: OwnerSetup;
  let dev: AgentSession;
  let rev: AgentSession;
  let task = 0;
  const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
  const refusal = (p: Promise<unknown>) =>
    p.then(
      () => "",
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
  const event = (ev: Event) => owner.ownerCh.send("", { kind: "event", ev });
  const askCheck = (body: string) =>
    run(dev.escalate(body, undefined, undefined, { choices: ["A: it works on KDE", "B: it's broken there"], holds: [task], check: { phase: "pre-ship", decider: "jon", artifact: ON_PR } }));
  const gate = async () => {
    const { state } = await run(dev.state());
    return shipGate(state, state.tasks.get(task)!);
  };

  beforeAll(async () => {
    process.env.KIWI_HOME = home;
    const keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign"])) as CryptoKeyPair;
    const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
    github = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const path = new URL(req.url).pathname;
        const body = await req.text();
        if (path === `/repos/${REPO}/installation`) return Response.json({ id: 1 });
        if (path === `/repos/${REPO}` && req.method === "GET") return Response.json({ permissions: { push: true } });
        if (path === "/app/installations/1/access_tokens") return Response.json({ token: "ghs_x", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
        if (path === `/repos/${REPO}/check-runs` && req.method === "POST") {
          if (checks === "down") return new Response("unicorn", { status: 503 });
          if (checks === "refused") return new Response("no", { status: 403 });
          posted.push(JSON.parse(body) as Record<string, unknown>);
          return Response.json({ html_url: `https://github.com/${REPO}/runs/${posted.length}` }, { status: 201 });
        }
        return new Response("nope", { status: 404 });
      },
    });
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, githubApp: githubAppFrom({ appId: "1", privateKey: pem, api: github.url.origin }) });
    owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    await event({ op: "repos.set", repos: [REPO] });
    await owner.ownerCh.setGithubRepos([REPO], "ghu_owner");
    await event({ op: "branch.prefix.set", prefix: "T" });
    await event({ op: "landing.set", then: "merge" });
    const computer = await pairComputer(owner.person);
    const a = await joinAgent(owner, "dev", computer);
    const b = await joinAgent(owner, "rev", computer);
    dev = new AgentSession("gate", { ...a.ch.access, relay: owner.relay, code: owner.code }, a.id, () => {});
    rev = new AgentSession("gate", { ...b.ch.access, relay: owner.relay, code: owner.code }, b.id, () => {});
    task = await event({ op: "task.add", title: "tray icon", owner: "dev", review: "rev" });
    await event({ op: "github", items: [{ repo: REPO, at: Date.now(), event: "pull_request", action: "opened", number: 9, state: "open", branch: `T${task}-tray`, sha: SHA }] } as Event);
    await run(dev.taskUpdate(task, { state: "review", at: SHA }));
    await run(rev.taskUpdate(task, { state: "done", verdict: "approved", round: 1, at: SHA }));
    expect(posted).toMatchObject([{ status: "in_progress" }]);
    posted.length = 0;
  });
  afterAll(() => {
    server.stop(true);
    github.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  test("with the approval at the PR's head the gate is open, and nothing was posted yet", async () => {
    expect(await gate()).toEqual({ open: true });
    expect(posted).toEqual([]);
  });

  test("with GitHub unreachable, reopening the approved task for review isn't sent either", async () => {
    checks = "down";
    expect(await refusal(run(dev.taskUpdate(task, { state: "review", at: SHA })))).toMatch(/has to turn waiting before this goes out, .*nothing was sent, try again$/);
    const { state } = await run(dev.state());
    expect(state.tasks.get(task)!.state).toBe("landing");
    expect(await gate()).toEqual({ open: true });
  });

  test("with GitHub unreachable a new pre-ship check isn't sent, and the agent is told so", async () => {
    expect(await refusal(askCheck("Does the tray icon work on KDE?"))).toMatch(new RegExp(`^kiwi/review on ${REPO}@aaaaaaa has to turn waiting before this goes out, .*nothing was sent, try again$`));
    expect(await gate()).toEqual({ open: true });
    expect(posted).toEqual([]);
  });

  test("with no owner app online, the asking agent alone turns kiwi/review waiting, then its check lands", async () => {
    checks = "up";
    await askCheck("Does the tray icon work on KDE?");
    expect(posted).toEqual([{ name: "kiwi/review", head_sha: SHA, status: "in_progress", output: { title: `T${task}: waiting in Kiwi`, summary: `T${task}: a pre-ship check isn't passed` } }]);
    expect(await gate()).toMatchObject({ open: false, rejected: false });
  });

  test("opening a new round posts waiting first; a reviewer's rejection then posts failure before the verdict goes out", async () => {
    const before = posted.length;
    await run(dev.taskUpdate(task, { state: "review", at: SHA }));
    expect(posted.slice(before)).toMatchObject([{ status: "in_progress" }]);
    await run(rev.taskUpdate(task, { state: "doing", verdict: "rejected", note: "the icon is blurry", round: 2 }));
    expect(posted.at(-1)).toMatchObject({ status: "completed", conclusion: "failure", output: { title: `T${task}: changes requested in Kiwi`, summary: `T${task}: changes requested` } });
    expect(await gate()).toMatchObject({ open: false, rejected: true });
  });

  test("a member can't turn kiwi/review green; after a green post, a refused downgrade (403) still holds the change", async () => {
    expect(await refusal(dev.ch.postReviewCheck({ repo: REPO, sha: SHA, verdict: "approved", tasks: [task] }))).toBe("only the channel owner can do that");
    await owner.ownerCh.postReviewCheck({ repo: REPO, sha: SHA, verdict: "approved", tasks: [task], upTo: (await run(dev.state())).state.head });
    expect(posted.at(-1)).toMatchObject({ conclusion: "success" });
    checks = "refused";
    expect(await refusal(askCheck("And on GNOME?"))).toMatch(
      /has to turn waiting before this goes out, and the relay didn't confirm it \(GitHub won't take the check from the App \(403\).*nothing was sent, try again$/,
    );
    const { state } = await run(dev.state());
    expect([...state.checks.values()].filter((c) => c.holds.includes(task))).toHaveLength(1);
  });
});
