import { beforeAll, describe, expect, test } from "bun:test";
import { formatTasks } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { REVIEW_CHECK } from "@kiwi/core/protocol.ts";
import { landingWaits, reviewNotRequired } from "@kiwi/core/prs.ts";
import type { Event, GithubNote, Landing, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "win", "mac"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

const HEAD = "3333333333333333333333333333333333333333";
const pr =
  (state: "open" | "closed", merged = false) =>
  (task: number): GithubNote => ({ event: "pull_request", repo: "o/r", number: 7, state, merged, branch: `T${task}-ship`, sha: HEAD, at: seq, ...(merged ? { happened: seq + 1 } : {}) });

async function landing(then: Landing, github?: (task: number) => GithubNote): Promise<Message[]> {
  const repos = await ev("jon", { op: "repos.set", repos: ["o/r"] });
  const prefix = await ev("jon", { op: "branch.prefix.set", prefix: "T" });
  const add = await ev("jon", { op: "task.add", title: "Ship", owner: "win", review: "mac", then });
  const round = await ev("win", { op: "task.update", task: add.seq, state: "review", at: HEAD });
  const pass = await ev("mac", { op: "task.update", task: add.seq, state: "done", verdict: "approved", round: 1, at: HEAD });
  const news = github ? [await ev("jon", { op: "github", items: [github(add.seq)] })] : [];
  return [repos, prefix, add, round, pass, ...news];
}

describe("what a landing task still waits for (#623 §2)", () => {
  test("a merge step names the linked PR and where it stands", async () => {
    const open = fold(await landing("merge", pr("open")), roster);
    const t = [...open.tasks.values()].at(-1)!;
    expect(t.state).toBe("landing");
    expect(landingWaits(open, t)).toBe("waits for PR #7 to merge");
    expect(formatTasks(open)).toContain("· waits for PR #7 to merge");
    const closed = fold(await landing("merge", pr("closed")), roster);
    expect(landingWaits(closed, [...closed.tasks.values()].at(-1)!)).toBe("waits: PR #7 was closed without merging");
    const merged = fold(await landing("release:tag", pr("closed", true)), roster);
    expect(landingWaits(merged, [...merged.tasks.values()].at(-1)!)).toBe("waits for a release that contains PR #7");
  });

  test("run and npm steps say what proves them, and other states wait for nothing", async () => {
    const run = fold(await landing("run"), roster);
    expect(landingWaits(run, [...run.tasks.values()].at(-1)!)).toBe(`waits for its run id: kiwi task proof T${[...run.tasks.values()].at(-1)!.id} --run ID`);
    const npm = fold(await landing("release:npm:@scope/lib@^1.2.0"), roster);
    expect(landingWaits(npm, [...npm.tasks.values()].at(-1)!)).toBe("waits for its PR to be linked and merged");
    expect(landingWaits(run, { ...[...run.tasks.values()].at(-1)!, state: "review" })).toBeNull();
  });
});

describe("a channel that lands on merge warns until kiwi/review is required (#623 §4)", () => {
  const github = (required: string[]) => ({
    prs: new Map(),
    checks: new Map(),
    issues: new Map(),
    rules: new Map([["o/r", { repo: "o/r", branch: "main", required, merge: [], seq: 1 }]]),
    releases: new Map(),
  });
  test("only a merge channel warns, for each repo whose rules don't require it or are unknown", () => {
    expect(reviewNotRequired({ landing: "merge", repos: ["o/r", "o/other"], github: github(["ci-ok"]) })).toEqual(["o/r", "o/other"]);
    expect(reviewNotRequired({ landing: "merge", repos: ["o/r"], github: github(["ci-ok", REVIEW_CHECK]) })).toEqual([]);
    expect(reviewNotRequired({ landing: "release:tag", repos: ["o/r"], github: github([]) })).toEqual([]);
    expect(reviewNotRequired({ landing: null, repos: ["o/r"], github: github([]) })).toEqual([]);
  });
});
