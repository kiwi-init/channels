import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { describeEvent, formatTask } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { isQuiet, PROTOCOL_VERSION, wellFormed, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { checksOf, taskPr } from "@kiwi/core/prs.ts";
import { stageOf, stageText } from "@kiwi/core/stage.ts";
import { fold, rulesOf, toRoster, type ChannelState, type Roster } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { githubAppFrom, rulesFrom } from "../src/relay/github-app.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const T0 = 1_760_000_000_000;
const R = "o/r";

async function setup() {
  const ids: Record<string, Identity> = { jow: await generateIdentity("jow"), ann: await generateIdentity("ann") };
  const roster: Roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: 0, active: true, kind: "agent", scopes: ["post", "tasks", "facts"] },
  ];
  const log: Message[] = [];
  const say = async (from: string, kind: Kind, body: string, ev?: Event, re?: number[]): Promise<number> => {
    const seq = log.length + 1;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: T0 + seq * 1_000, ...(ev ? { ev } : {}), ...(re ? { re } : {}) };
    const p = await sign(ids[from]!, payload);
    log.push({ ...p, seq, rts: T0 + seq * 1_000, sigOk: await verify(p) });
    return seq;
  };
  const github = (items: Record<string, unknown>[]) => say("jow", "event", "GitHub", { op: "github", items: items.map((i) => ({ repo: R, at: T0 + log.length * 1_000, ...i })) } as Event);
  const rules = (from: string, required: string[], merge: ("merge" | "squash" | "rebase")[]) => say(from, "event", "GitHub rules", { op: "github.rules", repo: R, branch: "main", required, merge });
  const state = (): ChannelState => fold(log, roster, T0 + 3_600_000);
  const stage = (id: number): string => {
    const s = state();
    return stageText(s, stageOf(s, s.tasks.get(id)!));
  };
  const check = (name: string, conclusion?: string) => ({
    event: "check_run",
    action: conclusion ? "completed" : "created",
    name,
    sha: "s1",
    run: name.length,
    ...(conclusion ? { status: "completed", conclusion } : { status: "queued" }),
  });
  const task = async () => {
    await say("jow", "event", "set the branch prefix", { op: "branch.prefix.set", prefix: "T" });
    const ask = await say("jow", "msg", "ship it");
    const t = await say("ann", "event", "added a task", { op: "task.add", title: "Ship it", owner: "ann" }, [ask]);
    await github([{ event: "pull_request", action: "opened", number: 9, state: "open", branch: `T${t}-ship`, sha: "s1", url: "https://github.com/o/r/pull/9" }]);
    return t;
  };
  return { log, say, github, rules, state, stage, check, task };
}

describe("a repo's own merge rules decide a task's checks", () => {
  test("rulesets and classic protection both name required checks; the repo's merge settings and a ruleset's allowed methods narrow the merge methods", () => {
    expect(
      rulesFrom(
        { default_branch: "trunk", allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: true },
        [
          { type: "deletion" },
          { type: "required_status_checks", parameters: { required_status_checks: [{ context: "ci-ok" }, { context: " " }] } },
          { type: "pull_request", parameters: { allowed_merge_methods: ["squash", "merge"] } },
        ],
        { protection: { required_status_checks: { contexts: ["lint"], checks: [{ context: "ci-ok" }, { context: "build" }] } } },
      ),
    ).toEqual({ branch: "trunk", required: ["ci-ok", "lint", "build"], merge: ["squash"] });
    expect(rulesFrom({ default_branch: "master", allow_merge_commit: null, allow_squash_merge: null, allow_rebase_merge: null }, [], {})).toEqual({
      branch: "master",
      required: [],
      merge: ["merge", "squash", "rebase"],
    });
  });

  test("with no rules read, every check counts, as before: a failed side check turns the task red", async () => {
    const { github, stage, check, task } = await setup();
    const t = await task();
    await github([check("ci-ok", "success"), check("perf", "failure")]);
    expect(stage(t)).toBe("red: #9 failed perf");
  });

  test("with the owner's rules, only the required checks count: waiting on one, green when it passes though a side check failed, red when it fails", async () => {
    const { github, rules, stage, state, check, task } = await setup();
    const t = await task();
    await rules("jow", ["ci-ok"], ["squash"]);
    expect(stage(t)).toBe("proving: #9 waiting on ci-ok");
    await github([check("ci-ok"), check("perf", "failure")]);
    expect(stage(t)).toBe("proving: #9 waiting on ci-ok");
    await github([check("ci-ok", "success")]);
    expect(stage(t)).toBe("proving: #9 ci-ok green, not merged");
    expect(checksOf(state(), taskPr(state(), t)!.pr)).toEqual({ passed: 1, failed: [], running: 0, required: ["ci-ok"], waiting: [] });
    await github([{ ...check("ci-ok", "failure"), run: 99 }]);
    expect(stage(t)).toBe("red: #9 failed ci-ok");
  });

  test("a merged PR whose required checks passed is done, with no task done; a failed side check doesn't hold it back", async () => {
    const { github, rules, stage, check, task } = await setup();
    const t = await task();
    await rules("jow", ["ci-ok"], ["squash"]);
    await github([check("ci-ok", "success"), check("perf", "failure"), { event: "pull_request", action: "closed", number: 9, state: "closed", merged: true }]);
    expect(stage(t)).toBe("done: #9 merged");
  });

  test("kiwi task show names the PR, its checks against the required ones, and the repo's merge rules", async () => {
    const { github, rules, state, check, task } = await setup();
    const t = await task();
    await github([check("ci-ok"), check("perf", "failure")]);
    expect(formatTask(state(), state().tasks.get(t)!, T0)).toContain(
      ["  stage: red: #9 failed perf", `  pr: o/r#9 open from T${t}-ship · https://github.com/o/r/pull/9`, "  checks: 1 failed (perf), 1 running, of every check (no merge rules read)"].join("\n"),
    );
    await rules("jow", ["ci-ok", "lint"], ["squash", "rebase"]);
    await github([check("ci-ok", "success")]);
    expect(formatTask(state(), state().tasks.get(t)!, T0)).toContain(
      [
        "  stage: proving: #9 waiting on lint",
        `  pr: o/r#9 open from T${t}-ship · https://github.com/o/r/pull/9`,
        "  checks: 1 passed, 1 waiting (lint), of the required ci-ok, lint",
        "  merge rules (main): ci-ok, lint must pass; merges by squash or rebase",
      ].join("\n"),
    );
  });

  test("only the owner's app posts a repo's rules; the event is quiet, well formed, and the latest one wins", async () => {
    const { log, rules, state } = await setup();
    const forged = await rules("ann", ["nothing"], ["merge"]);
    expect(state().rejected.get(forged)).toContain("owner");
    expect(rulesOf(state().github, R)).toBeUndefined();
    await rules("jow", ["ci-ok", "ci-ok"], ["squash"]);
    await rules("jow", ["test"], ["merge", "squash"]);
    expect(rulesOf(state().github, "O/R")).toMatchObject({ repo: R, branch: "main", required: ["test"], merge: ["merge", "squash"] });
    const ev = log.at(-1)!;
    expect(isQuiet(ev)).toBe(true);
    expect(describeEvent(ev)).toBe("read o/r's rules for main: test must pass; merges by merge or squash");
    const base = { v: PROTOCOL_VERSION, id: "x", from: "jow", kind: "event", body: "", ts: T0 };
    expect(wellFormed({ ...base, ev: { op: "github.rules", repo: R, branch: "main", required: ["ci-ok"], merge: ["squash"] } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "github.rules", repo: R, branch: "main", required: ["ci-ok"], merge: ["fast-forward"] } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "github.rules", repo: "not a repo", branch: "main", required: [], merge: [] } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "github.rules", repo: R, branch: "main", required: ["a\nb"], merge: [] } })).toBe(false);
  });
});

describe("the owner's app reads a connected repo's rules through the relay's GitHub App", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-github-rules-"));
  let github: ReturnType<typeof Bun.serve>;
  let server: ReturnType<typeof startRelay>;
  let ownerCh: Channel;
  let memberCh: Channel;
  let required = ["ci-ok"];

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
        if (path === "/repos/ojow/channels/installation") return Response.json({ id: 42 });
        if (path === "/app/installations/42/access_tokens") return Response.json({ token: "ghs_test", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
        if (path === "/repos/ojow/channels")
          return Response.json({
            default_branch: "main",
            allow_merge_commit: false,
            allow_squash_merge: true,
            allow_rebase_merge: false,
            ...(req.headers.get("authorization") === "Bearer ghu_owner" ? { permissions: { push: true } } : {}),
          });
        if (path === "/repos/ojow/channels/rules/branches/main")
          return Response.json([{ type: "required_status_checks", parameters: { required_status_checks: required.map((context) => ({ context })) } }]);
        if (path === "/repos/ojow/channels/branches/main") return new Response("forbidden", { status: 403 });
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

  test("posts the rules once, again only when they change, refuses a repo the channel hasn't connected, and refuses a member", async () => {
    expect(await ownerCh.syncGithubRules(["ojow/channels"], [])).toBe(1);
    const once = await folded();
    expect(rulesOf(once.github, "ojow/channels")).toMatchObject({ branch: "main", required: ["ci-ok"], merge: ["squash"] });
    expect(await ownerCh.syncGithubRules(["ojow/channels"], [...once.github.rules.values()])).toBe(0);
    required = ["ci-ok", "lint"];
    expect(await ownerCh.syncGithubRules(["ojow/channels"], [...once.github.rules.values()])).toBe(1);
    expect(rulesOf((await folded()).github, "ojow/channels")?.required).toEqual(["ci-ok", "lint"]);
    expect(await ownerCh.syncGithubRules(["ojow/other"], []).catch((e: Error) => e.message)).toContain("connected repos");
    expect(await memberCh.syncGithubRules(["ojow/channels"], []).catch((e: Error) => e.message)).toContain("owner");
  });
});
