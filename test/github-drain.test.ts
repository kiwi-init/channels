import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { describeEvent } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Message } from "@kiwi/core/protocol.ts";
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
  test("a PR and its finished check land as one signed event; started checks are left out; the queue empties", async () => {
    expect(await ownerCh.setGithubRepos(["ojow/channels"], "ghu_owner")).toEqual(["ojow/channels"]);
    await hook("pull_request", {
      action: "opened",
      repository,
      sender: { login: "octocat" },
      pull_request: { number: 7, title: "Drain the queue", html_url: "https://github.com/ojow/channels/pull/7", state: "open", merged: false, head: { ref: "T37", sha } },
    });
    await hook("check_run", { action: "created", repository, check_run: { name: "ci-ok", status: "queued", head_sha: sha } });
    await hook("check_run", { action: "completed", repository, check_run: { name: "ci-ok", status: "completed", conclusion: "success", head_sha: sha, check_suite: { head_branch: "T37" } } });
    expect(await memberCh.drainGithub().catch((e: Error) => e.message)).toContain("owner");
    expect(await ownerCh.drainGithub()).toBe(2);
    expect(await ownerCh.drainGithub()).toBe(0);
    const { messages } = await ownerCh.history(0);
    const state = fold(messages, (await ownerCh.members()).map(toRoster));
    const ev = messages.find((m) => m.ev?.op === "github")!;
    expect(describeEvent(ev)).toBe("GitHub: PR ojow/channels#7 “Drain the queue” opened; ci-ok success on T37");
    const pr = state.github.prs.get("ojow/channels#7")!;
    expect(pr).toMatchObject({ number: 7, state: "open", branch: "T37", sha, by: "octocat" });
    expect(prChecks(state.github, pr)).toMatchObject([{ name: "ci-ok", conclusion: "success" }]);
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
});
