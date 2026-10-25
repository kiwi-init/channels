import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { describeEvent, formatTask, formatTasks } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { isQuiet, PROTOCOL_VERSION, wellFormed, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { fold, releaseOf, toRoster, type ChannelState, type Roster } from "@kiwi/core/state.ts";
import { needsYou, statusOf, statusWord, versionName } from "@kiwi/core/status.ts";
import { startRelay } from "../src/relay/bun.ts";
import { githubItem } from "../src/relay/github.ts";
import { githubAppFrom, releaseFrom } from "../src/relay/github-app.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { checked } from "./check.ts";

const T0 = 1_760_000_000_000;
const R = "o/r";
const MERGE = "ab".repeat(20);

async function setup() {
  const ids: Record<string, Identity> = { jow: await generateIdentity("jow"), ann: await generateIdentity("ann") };
  const roster: Roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: 0, active: true, kind: "agent" },
  ];
  const log: Message[] = [];
  const say = async (from: string, kind: Kind, body: string, more: Partial<Payload> = {}): Promise<number> => {
    const seq = log.length + 1;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: T0 + seq * 1_000, ...more };
    const p = await sign(ids[from]!, payload);
    log.push({ ...p, seq, rts: T0 + seq * 1_000, sigOk: await verify(p) });
    return seq;
  };
  const ev = (from: string, e: Event, re?: number[]) => say(from, "event", "event", { ev: e, ...(re ? { re } : {}) });
  const github = (items: Record<string, unknown>[]) => ev("jow", { op: "github", items: items.map((i) => ({ repo: R, at: T0 + log.length * 1_000, ...i })) } as Event);
  const state = (): ChannelState => fold(log, roster, T0 + 3_600_000);
  const word = (id: number): string => {
    const s = state();
    return statusWord(statusOf(s, s.tasks.get(id)!));
  };
  await ev("jow", { op: "branch.prefix.set", prefix: "T" });
  const ask = await say("jow", "msg", "ship the docs");
  const add = (title: string, owner?: string) => ev("ann", { op: "task.add", title, ...(owner ? { owner } : {}) }, [ask]);
  return { log, say, ev, github, state, word, add };
}

describe("a task's status, in the words people use", () => {
  test("planned, working, needs you while an ask holds it, done once merged, shipped in the release that holds its merge commit", async () => {
    const { say, ev, github, state, word, add } = await setup();
    const t = await add("Write the docs");
    expect(word(t)).toBe("planned");
    await ev("ann", { op: "task.update", task: t, owner: "ann", state: "doing" });
    expect(word(t)).toBe("working");
    const q = await say("ann", "blocking", "Which tone for the docs?", { to: ["jow"], esc: true, holds: [t] });
    expect(word(t)).toBe("needs you");
    expect(needsYou(state(), t)).toBe(true);
    await say("jow", "msg", "plain", { re: [q] });
    expect(word(t)).toBe("working");
    await github([{ event: "pull_request", action: "opened", number: 9, state: "open", branch: `T${t}-docs`, sha: "c1" }]);
    expect(word(t)).toBe("working");
    await github([{ event: "pull_request", action: "closed", number: 9, state: "closed", merged: true, merge: MERGE }]);
    expect(word(t)).toBe("done");
    expect(state().tasks.get(t)!.state).toBe("doing");
    await ev("jow", { op: "github.release", repo: R, tag: "v1.0.0", at: T0, shas: ["cd".repeat(6)], prs: [3] });
    expect(word(t)).toBe("done");
    await ev("jow", { op: "github.release", repo: R, tag: "v1.1.0", at: T0 + 1, shas: [MERGE.slice(0, 12)], prs: [] });
    await ev("jow", { op: "github.release", repo: R, tag: "v1.2.0", at: T0 + 2, shas: [MERGE.slice(0, 12)], prs: [] });
    expect(word(t)).toBe("shipped in 1.1.0");
    const s = state();
    expect(formatTask(s, s.tasks.get(t)!, T0)).toContain("  status: shipped in 1.1.0 (doing) · owner: ann");
    expect(formatTasks(s)).toContain(`  T${t}    shipped in 1.1.0 @ann Write the docs`);
  });

  test("a release names a squashed or merged PR by number when its merge commit is unknown; a cancelled task says cancelled", async () => {
    const { ev, github, word, add } = await setup();
    const t = await add("Old work", "ann");
    await github([{ event: "pull_request", action: "closed", number: 4, state: "closed", merged: true, branch: `T${t}-old` }]);
    await ev("jow", { op: "github.release", repo: R, tag: "2026.10", at: T0, shas: [], prs: [4] });
    expect(word(t)).toBe("shipped in 2026.10");
    const c = await add("Not needed");
    await ev("ann", { op: "task.update", task: c, state: "cancelled" });
    expect(word(c)).toBe("cancelled");
    expect(["v1.2.3", "2026.10.0", "release-7", "vNext"].map(versionName)).toEqual(["1.2.3", "2026.10.0", "release-7", "vNext"]);
  });

  test("only the owner's app posts releases; the event is quiet, says what it holds, and the same tag posted again replaces the first", async () => {
    const { log, ev, github, state, add } = await setup();
    const forged = await ev("ann", { op: "github.release", repo: R, tag: "v9", at: T0, shas: [], prs: [1] });
    expect(state().rejected.get(forged)).toContain("owner");
    await ev("jow", { op: "github.release", repo: R, tag: "v1", at: T0, shas: ["ab12cd34ef56"], prs: [1, 2] });
    expect(describeEvent(log.at(-1)!)).toBe("o/r released v1: 2 PRs, 1 commit");
    expect(isQuiet(log.at(-1)!)).toBe(true);
    await ev("jow", { op: "github.release", repo: R, tag: "v1", at: T0, shas: [], prs: [] });
    expect(state().github.releases.get(R)).toHaveLength(1);
    const t = await add("x", "ann");
    await github([{ event: "pull_request", action: "closed", number: 1, state: "closed", merged: true, branch: `T${t}` }]);
    expect(releaseOf(state().github, state().github.prs.get("o/r#1")!)).toBeUndefined();
    const base = { v: PROTOCOL_VERSION, id: "x", from: "jow", kind: "event", body: "", ts: T0 };
    expect(wellFormed({ ...base, ev: { op: "github.release", repo: R, tag: "v1", at: T0, shas: ["abc1234"], prs: [1] } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "github.release", repo: R, tag: "v1", at: T0, shas: ["not-a-sha"], prs: [] } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "github.release", repo: R, tag: "v1\n2", at: T0, shas: [], prs: [] } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "github.release", repo: R, tag: "v1", at: T0, shas: [], prs: [0] } })).toBe(false);
  });

  test("the relay keeps a merged PR's merge commit, and a release's commits name their PRs by GitHub's own squash and merge messages", () => {
    const item = githubItem(
      "pull_request",
      { action: "closed", repository: { full_name: R }, pull_request: { number: 9, state: "closed", merged: true, merge_commit_sha: MERGE, head: { ref: "T7", sha: "c".repeat(40) } } },
      T0,
    );
    expect(item).toMatchObject({ number: 9, merged: true, merge: MERGE });
    expect(
      githubItem("pull_request", { action: "opened", repository: { full_name: R }, pull_request: { number: 9, state: "open", merged: false, merge_commit_sha: MERGE } }, T0)?.merge,
    ).toBeUndefined();
    expect(
      releaseFrom("v2", T0, [
        { sha: "a".repeat(40), commit: { message: "Fix the thing (#12)\n\nbody" } },
        { sha: "b".repeat(40), commit: { message: "Merge pull request #13 from o/branch\n\nTitle" } },
        { sha: "c".repeat(40), commit: { message: "A plain commit mentioning (#14) midway" } },
        { sha: "nope", commit: { message: "bad sha (#15)" } },
      ]),
    ).toEqual({ tag: "v2", at: T0, shas: ["a".repeat(12), "b".repeat(12), "c".repeat(12)], prs: [12, 13, 15] });
  });
});

describe("the owner's app posts a connected repo's new releases", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-github-releases-"));
  let github: ReturnType<typeof Bun.serve>;
  let server: ReturnType<typeof startRelay>;
  let ownerCh: Channel;
  let memberCh: Channel;
  const releases = [
    { tag_name: "v0.2.0", published_at: "2026-10-02T00:00:00Z", draft: false },
    { tag_name: "v0.3.0-draft", published_at: null, draft: true },
    { tag_name: "v0.1.0", published_at: "2026-10-01T00:00:00Z", draft: false },
  ];

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
        const url = new URL(req.url);
        const path = url.pathname;
        if (path === "/repos/ojow/channels/installation") return Response.json({ id: 42 });
        if (path === "/app/installations/42/access_tokens") return Response.json({ token: "ghs_test", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
        if (path === "/repos/ojow/channels") return Response.json({ default_branch: "main", ...(req.headers.get("authorization") === "Bearer ghu_owner" ? { permissions: { push: true } } : {}) });
        if (path === "/repos/ojow/channels/releases") return Response.json(releases);
        if (path === "/repos/ojow/channels/compare/v0.1.0...v0.2.0") return Response.json({ commits: [{ sha: "2".repeat(40), commit: { message: "Second (#2)" } }] });
        if (path === "/repos/ojow/channels/commits" && url.searchParams.get("sha") === "v0.1.0") return Response.json([{ sha: "1".repeat(40), commit: { message: "First (#1)" } }]);
        return new Response("nope", { status: 404 });
      },
    });
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth(), githubApp: githubAppFrom({ appId: "1234", privateKey: pem, api: github.url.origin }) });
    const relay = server.url.origin;
    const owner = await generateIdentity("alice");
    const member = await generateIdentity("win");
    const made = await Channel.create(relay, owner, { name: "alice", kind: "human" }, [], undefined, "dev:alice");
    ownerCh = new Channel(made.access, relay, owner);
    const ask = await Channel.requestJoin(relay, made.code, member, { name: "win" });
    await ownerCh.approve((await checked(ownerCh, relay, made.code, [{ id: member, requestId: ask.requestId }]))[0]!);
    memberCh = new Channel(made.access, relay, member);
    await ownerCh.setGithubRepos(["ojow/channels"], "ghu_owner");
  });
  afterAll(() => {
    server.stop(true);
    github.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  const folded = async () => fold((await ownerCh.history(0)).messages, (await ownerCh.members()).map(toRoster));

  test("posts each published release oldest first, skips drafts and the ones it has, and refuses a member", async () => {
    expect(await ownerCh.syncGithubReleases(["ojow/channels"], [])).toBe(2);
    const s = await folded();
    expect(s.github.releases.get("ojow/channels")?.map((r) => [r.tag, r.prs, r.shas])).toEqual([
      ["v0.1.0", [1], ["1".repeat(12)]],
      ["v0.2.0", [2], ["2".repeat(12)]],
    ]);
    expect(await ownerCh.syncGithubReleases(["ojow/channels"], [...s.github.releases.values()].flat())).toBe(0);
    expect(await memberCh.syncGithubReleases(["ojow/channels"], []).catch((e: Error) => e.message)).toContain("owner");
  });
});
