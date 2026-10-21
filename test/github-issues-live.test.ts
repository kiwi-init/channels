import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { issuesToClose } from "@kiwi/core/work.ts";
import { startRelay } from "../src/relay/bun.ts";
import { githubAppFrom } from "../src/relay/github-app.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

describe("kiwi task add --issue on a live channel", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-issues-relay-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-issues-home-"));
  const was = process.env.KIWI_HOME;
  const calls: { method: string; path: string; body: string }[] = [];
  let github: ReturnType<typeof Bun.serve>;
  let server: ReturnType<typeof startRelay>;
  let owner: OwnerSetup;
  let dev: AgentSession;
  const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
  const refusal = (e: Effect.Effect<unknown, unknown, unknown>) =>
    run(e).then(
      () => "",
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );

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
        calls.push({ method: req.method, path, body: await req.text() });
        if (path === "/repos/ojow/channels/installation") return Response.json({ id: 1 });
        if (path === "/repos/ojow/channels" && req.method === "GET") return Response.json({ permissions: { push: req.headers.get("authorization") === "Bearer ghu_owner" } });
        if (path === "/app/installations/1/access_tokens") return Response.json({ token: "ghs_x", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
        if (path === "/repos/ojow/channels/issues/12" && req.method === "GET")
          return Response.json({ title: "Copy icons do nothing", body: "On code blocks and the invite.", html_url: "https://github.com/ojow/channels/issues/12", state: "open" });
        if (path === "/repos/ojow/channels/issues/14") return Response.json({ title: "Old", body: null, html_url: "https://github.com/ojow/channels/issues/14", state: "closed" });
        if (path === "/repos/ojow/channels/issues/7") return Response.json({ title: "A PR", html_url: "https://github.com/ojow/channels/pull/7", state: "open", pull_request: {} });
        if (path === "/repos/ojow/channels/issues/12/comments") return Response.json({ html_url: "https://github.com/ojow/channels/issues/12#c" }, { status: 201 });
        if (path === "/repos/ojow/channels/issues/12" && req.method === "PATCH") return Response.json({ html_url: "https://github.com/ojow/channels/issues/12" });
        return new Response("nope", { status: 404 });
      },
    });
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, githubApp: githubAppFrom({ appId: "1", privateKey: pem, api: github.url.origin }) });
    owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    await owner.ownerCh.send("repos: ojow/channels", { kind: "event", ev: { op: "repos.set", repos: ["ojow/channels"] } });
    await owner.ownerCh.setGithubRepos(["ojow/channels"], "ghu_owner");
    const computer = await pairComputer(owner.person);
    const { id, ch } = await joinAgent(owner, "dev", computer);
    dev = new AgentSession("issues", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
  });
  afterAll(() => {
    server.stop(true);
    github.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  test("an issue becomes a task titled after it, with its text and link, and only once", async () => {
    const made = await run(dev.taskFromIssue("12"));
    expect(made).toMatchObject({ title: "Copy icons do nothing", issue: "ojow/channels#12" });
    const { state } = await run(dev.state());
    expect(state.tasks.get(made.id)).toMatchObject({
      title: "Copy icons do nothing",
      detail: "On code blocks and the invite.\n\nhttps://github.com/ojow/channels/issues/12",
      issue: { repo: "ojow/channels", number: 12 },
    });
    expect(await refusal(dev.taskFromIssue("https://github.com/ojow/channels/issues/12"))).toBe(`ojow/channels#12 is already T${made.id}: Copy icons do nothing`);
  });

  test("a closed issue, a pull request and a repo the channel doesn't have are refused with the reason", async () => {
    expect(await refusal(dev.taskFromIssue("14"))).toBe("ojow/channels#14 is closed on GitHub: reopen it first, or add the task without --issue");
    expect(await refusal(dev.taskFromIssue("7"))).toBe("ojow/channels#7 is a pull request, not an issue");
    expect(await refusal(dev.taskFromIssue("someone/else#1"))).toBe("someone/else isn't one of the channel's repos (ojow/channels)");
  });

  test("the owner's app closes the issue when the task is done, only with Write to GitHub on", async () => {
    const { state } = await run(dev.state());
    const t = [...state.tasks.values()].find((x) => x.issue?.number === 12)!;
    await owner.ownerCh.send("turned on Write to GitHub", { kind: "event", ev: { op: "github.write.set", on: true } });
    await owner.ownerCh.send(`T${t.id} done`, { kind: "event", ev: { op: "task.update", task: t.id, state: "done", note: "fixed in #370" } });
    const { state: after } = await run(dev.state());
    const due = issuesToClose(after, 0);
    expect(due).toMatchObject([{ repo: "ojow/channels", number: 12, reason: "completed", body: `Kiwi task T${t.id} done` }]);
    expect(await owner.ownerCh.closeIssue(due[0]!)).toEqual({ url: "https://github.com/ojow/channels/issues/12" });
    expect(calls.filter((c) => c.method === "PATCH").map((c) => JSON.parse(c.body))).toEqual([{ state: "closed", state_reason: "completed" }]);
  });
});
