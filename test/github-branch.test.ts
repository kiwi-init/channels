import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { prsToLinkBack, taskFeed, taskOfBranch, taskPr, taskPrs } from "@kiwi/core/work.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "mac"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 1, active: true, kind: "agent" },
  ];
});

describe("a PR finds its task by its branch", () => {
  test("branch names that carry a task id, and ones that don't", () => {
    expect(taskOfBranch("T72-branch-prs")).toBe(72);
    expect(taskOfBranch("bus/T11-voice-desktop")).toBe(11);
    expect(taskOfBranch("grok1/t101-daemon-sigterm")).toBe(101);
    expect(taskOfBranch("T5")).toBe(5);
    expect(taskOfBranch("main")).toBeNull();
    expect(taskOfBranch("T5x-thing")).toBeNull();
    expect(taskOfBranch("fix-T5")).toBeNull();
    expect(taskOfBranch(undefined)).toBeNull();
  });

  test("a PR GitHub reported on branch T<n>-… shows on task T<n>, with its branch, though nobody linked it", async () => {
    const add = await ev("jon", { op: "task.add", title: "Branch PRs", owner: "mac" });
    const other = await ev("jon", { op: "task.add", title: "Something else" });
    const news = await ev("jon", {
      op: "github",
      items: [
        {
          event: "pull_request",
          repo: "ojow/channels",
          action: "opened",
          number: 360,
          title: "Branch PRs",
          url: "https://github.com/ojow/channels/pull/360",
          state: "open",
          branch: `T${add.seq}-branch-prs`,
          sha: "e".repeat(40),
          at: 1,
        },
        { event: "pull_request", repo: "ojow/channels", action: "opened", number: 361, state: "open", branch: "main-fixes", at: 2 },
      ],
    });
    const log = [add, other, news];
    const s = fold(log, roster);
    expect(taskPrs(taskFeed(s, log, add.seq))).toEqual([
      { url: "https://github.com/ojow/channels/pull/360", repo: "ojow/channels", number: 360, state: "open", seq: news.seq, title: "Branch PRs", branch: `T${add.seq}-branch-prs` },
    ]);
    expect(taskPrs(taskFeed(s, log, other.seq))).toEqual([]);
    expect(prsToLinkBack(s, 0)).toEqual([{ repo: "ojow/channels", number: 360, task: add.seq, seq: news.seq, body: `Kiwi task T${add.seq}: Branch PRs` }]);
    expect(prsToLinkBack(s, news.seq)).toEqual([]);
  });

  test("a task's row picks its open PR over an older merged one, with its size and checks", async () => {
    const add = await ev("jon", { op: "task.add", title: "Row PR", owner: "mac" });
    const branch = `T${add.seq}-row-pr`;
    const news = await ev("jon", {
      op: "github",
      items: [
        { event: "pull_request", repo: "o/r", number: 1, state: "closed", merged: true, branch, sha: "a".repeat(40), at: 1 },
        { event: "pull_request", repo: "o/r", number: 2, state: "open", branch, sha: "b".repeat(40), additions: 40, deletions: 4, files: 3, at: 2 },
        { event: "check_run", repo: "o/r", action: "completed", name: "unit", status: "completed", conclusion: "success", sha: "b".repeat(40), at: 3 },
        { event: "check_run", repo: "o/r", action: "created", name: "smoke", status: "in_progress", sha: "b".repeat(40), at: 4 },
      ],
    });
    const s = fold([add, news], roster);
    expect(taskPr(s, add.seq)).toMatchObject({ pr: { number: 2, additions: 40, deletions: 4, files: 3 }, checks: { passed: 1, failed: [], running: 1 } });
    expect(taskPr(s, add.seq + 100)).toBeUndefined();
  });
});

describe("a task's PR, looked up from one index per fold", () => {
  const pr = (number: number, branch: string, state: "open" | "closed" | "merged", at: number) => ({ repo: "o/r", number, branch, state, at, seq: number });
  const stateWith = (prs: ReturnType<typeof pr>[]) =>
    ({ github: { prs: new Map(prs.map((p) => [`o/r#${p.number}`, p])), checks: new Map(), issues: new Map() } }) as unknown as Parameters<typeof taskPr>[0];

  test("an open PR wins over a newer closed one, the newest wins among equals, and the first stays on a tie", () => {
    const s = stateWith([pr(1, "T7-a", "merged", 30), pr(2, "T7-b", "open", 10), pr(3, "T8-a", "closed", 5), pr(4, "T8-b", "closed", 9), pr(5, "T9", "open", 4), pr(6, "T9-x", "open", 4)]);
    expect(taskPr(s, 7)?.pr.number).toBe(2);
    expect(taskPr(s, 8)?.pr.number).toBe(4);
    expect(taskPr(s, 9)?.pr.number).toBe(5);
    expect(taskPr(s, 10)).toBeUndefined();
  });

  test("the same fold's lookups share one index", () => {
    const s = stateWith([pr(1, "T7-a", "open", 1)]);
    expect(taskPr(s, 7)).toBe(taskPr(s, 7));
  });
});
