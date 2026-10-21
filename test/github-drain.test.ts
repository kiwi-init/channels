import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { describeEvent } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { isQuiet, type Message } from "@kiwi/core/protocol.ts";
import { fold, prChecks, toRoster, type Roster } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { GITHUB_WEBHOOK_PATH } from "../src/relay/github.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const SECRET = "drain-secret";
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-github-drain-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let owner: Identity;
let ownerCh: Channel;
let memberCh: Channel;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth(), githubSecret: SECRET, githubPush: async (_, token) => ({ ok: true, value: token === "ghu_owner" }) });
  relay = server.url.origin;
  owner = await generateIdentity("alice");
  const member = await generateIdentity("win");
  const made = await Channel.create(relay, owner, { name: "alice", kind: "human" }, [], undefined, "dev:alice");
  ownerCh = new Channel(made.access, relay, owner);
  const ask = await Channel.requestJoin(relay, made.code, member, { name: "win" });
  await ownerCh.approve((await checked(ownerCh, relay, made.code, [{ id: member, requestId: ask.requestId }]))[0]!);
  memberCh = new Channel(made.access, relay, member);
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function hook(event: string, payload: unknown): Promise<number> {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return (await fetch(`${relay}${GITHUB_WEBHOOK_PATH}`, { method: "POST", headers: { "x-github-event": event, "x-hub-signature-256": `sha256=${sig}` }, body })).status;
}

const repository = { full_name: "ojow/channels" };
const sha = "a".repeat(40);

describe("the owner's app drains GitHub's queue into the channel", () => {
  test("a PR and its checks land as one signed event, the started check folded as state but left out of the line; the queue empties", async () => {
    expect(await ownerCh.setGithubRepos(["ojow/channels"], "ghu_owner")).toEqual(["ojow/channels"]);
    await hook("pull_request", {
      action: "opened",
      repository,
      sender: { login: "octocat" },
      pull_request: { number: 7, title: "Drain the queue", html_url: "https://github.com/ojow/channels/pull/7", state: "open", merged: false, head: { ref: "T37", sha } },
    });
    await hook("check_run", { action: "created", repository, check_run: { id: 11, name: "ci-ok", status: "queued", head_sha: sha } });
    await hook("check_run", { action: "completed", repository, check_run: { id: 11, name: "ci-ok", status: "completed", conclusion: "success", head_sha: sha, check_suite: { head_branch: "T37" } } });
    await hook("check_run", { action: "rerequested", repository, check_run: { id: 11, name: "ci-ok", status: "completed", conclusion: "success", head_sha: sha } });
    expect(await memberCh.drainGithub().catch((e: Error) => e.message)).toContain("owner");
    expect(await ownerCh.drainGithub()).toBe(3);
    expect(await ownerCh.drainGithub()).toBe(0);
    const { messages } = await ownerCh.history(0);
    const state = fold(messages, (await ownerCh.members()).map(toRoster));
    const ev = messages.find((m) => m.ev?.op === "github")!;
    expect(describeEvent(ev)).toBe("GitHub: PR ojow/channels#7 “Drain the queue” opened; ci-ok success on T37");
    const pr = state.github.prs.get("ojow/channels#7")!;
    expect(pr).toMatchObject({ number: 7, state: "open", branch: "T37", sha, by: "octocat" });
    expect(prChecks(state.github, pr)).toMatchObject([{ name: "ci-ok", conclusion: "success", run: 11 }]);
    expect(isQuiet(ev)).toBe(false);

    await hook("check_run", { action: "created", repository, check_run: { id: 12, name: "ci-ok", status: "queued", head_sha: sha, check_suite: { head_branch: "T37" } } });
    expect(await ownerCh.drainGithub()).toBe(1);
    const after = (await ownerCh.history(0)).messages;
    const running = after.filter((m) => m.ev?.op === "github").at(-1)!;
    expect(isQuiet(running)).toBe(true);
    expect(describeEvent(running)).toBe("GitHub: ci-ok queued on T37");
    const again = fold(after, (await ownerCh.members()).map(toRoster));
    expect(prChecks(again.github, again.github.prs.get("ojow/channels#7")!)).toEqual([{ name: "ci-ok", status: "queued", run: 12, at: expect.any(Number) }]);
  });
});

describe("folding GitHub's news", () => {
  test("only the owner's events count; a merge, a push to the branch and a later check move the PR", async () => {
    const ids: Record<string, Identity> = { jon: await generateIdentity("jon"), mac: await generateIdentity("mac") };
    const roster: Roster = [
      { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
      { name: "mac", pk: ids.mac!.pk, owner: false, at: 1, active: true, kind: "agent" },
    ];
    let seq = 0;
    const ev = async (from: string, items: unknown[]): Promise<Message> => {
      seq++;
      const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: { op: "github", items } as Message["ev"] });
      return { ...p, seq, rts: seq, sigOk: await verify(p) };
    };
    const r = "o/r";
    const log = [
      await ev("jon", [{ event: "pull_request", repo: r, action: "opened", number: 1, state: "open", branch: "b", sha: "1", at: 1 }]),
      await ev("mac", [{ event: "pull_request", repo: r, action: "closed", number: 1, state: "closed", merged: true, at: 2 }]),
      await ev("jon", [{ event: "push", repo: r, branch: "b", sha: "2", at: 3 }]),
      await ev("jon", [{ event: "check_run", repo: r, action: "completed", name: "ci", conclusion: "failure", sha: "2", at: 4 }]),
    ];
    let s = fold(log, roster);
    expect(s.rejected.get(2)).toBe("only the owner's app posts GitHub's news");
    expect(s.github.prs.get("o/r#1")).toMatchObject({ state: "open", sha: "2" });
    expect(prChecks(s.github, s.github.prs.get("o/r#1")!)).toMatchObject([{ name: "ci", conclusion: "failure" }]);
    s = fold([...log, await ev("jon", [{ event: "pull_request", repo: r, action: "closed", number: 1, state: "closed", merged: true, at: 5 }])], roster);
    expect(s.github.prs.get("o/r#1")!.state).toBe("merged");
  });

  test("a running check is state: a late start of the same run or an older run never covers a result, a newer run or attempt does, and without run ids a result stays", async () => {
    const jon = await generateIdentity("jon");
    const roster: Roster = [{ name: "jon", pk: jon.pk, owner: true, at: 0, active: true, kind: "human" }];
    let seq = 0;
    const ev = async (items: unknown[]): Promise<Message> => {
      seq++;
      const p = await sign(jon, { v: 1 as const, id: crypto.randomUUID(), from: "jon", kind: "event" as const, body: "", ts: seq, ev: { op: "github", items } as Message["ev"] });
      return { ...p, seq, rts: seq, sigOk: await verify(p) };
    };
    const r = "o/r";
    const check = (over: Record<string, unknown>) => ({ event: "check_run", repo: r, name: "ci", sha: "1", at: seq + 1, ...over });
    const flow = (over: Record<string, unknown>) => ({ event: "workflow_run", repo: r, name: "build", sha: "1", at: seq + 1, ...over });
    const log = [await ev([{ event: "pull_request", repo: r, action: "opened", number: 1, state: "open", branch: "T1-x", sha: "1", at: 1 }])];
    const runs = async (items: unknown[]) => {
      log.push(await ev(items));
      const s = fold(log, roster);
      return prChecks(s.github, s.github.prs.get("o/r#1")!).map((c) => [c.name, c.conclusion ?? c.status, c.run ?? null, c.attempt ?? null]);
    };
    expect(await runs([check({ action: "created", status: "queued", run: 5 }), flow({ action: "requested", status: "queued", run: 9, attempt: 1 })])).toEqual([
      ["ci", "queued", 5, null],
      ["build", "queued", 9, 1],
    ]);
    expect(isQuiet(log.at(-1)!)).toBe(true);
    expect(
      await runs([check({ action: "completed", status: "completed", conclusion: "success", run: 5 }), flow({ action: "completed", status: "completed", conclusion: "failure", run: 9, attempt: 1 })]),
    ).toEqual([
      ["ci", "success", 5, null],
      ["build", "failure", 9, 1],
    ]);
    expect(await runs([check({ action: "in_progress", status: "in_progress", run: 5 }), check({ action: "created", status: "queued", run: 4 })])).toEqual([
      ["ci", "success", 5, null],
      ["build", "failure", 9, 1],
    ]);
    expect(await runs([flow({ action: "in_progress", status: "in_progress", run: 9, attempt: 2 }), check({ action: "created", status: "queued", run: 6 })])).toEqual([
      ["ci", "queued", 6, null],
      ["build", "in_progress", 9, 2],
    ]);
    expect(
      await runs([flow({ action: "completed", status: "completed", conclusion: "success", run: 9, attempt: 2 }), check({ action: "completed", status: "completed", conclusion: "success", run: 6 })]),
    ).toEqual([
      ["ci", "success", 6, null],
      ["build", "success", 9, 2],
    ]);
    const legacy = [check({ name: "old", action: "completed", status: "completed", conclusion: "success" })];
    expect((await runs(legacy)).at(-1)).toEqual(["old", "success", null, null]);
    expect((await runs([check({ name: "old", action: "created", status: "queued" })])).at(-1)).toEqual(["old", "success", null, null]);
    expect(describeEvent(log.at(-1)!)).toBe("GitHub: old queued");
  });
});
