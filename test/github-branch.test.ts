import { beforeAll, describe, expect, test } from "bun:test";
import { describeEvent } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";
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
    expect(taskOfBranch("T72-branch-prs", "T")).toBe(72);
    expect(taskOfBranch("bus/T11-voice-desktop", "T")).toBe(11);
    expect(taskOfBranch("grok1/t101-daemon-sigterm", "T")).toBe(101);
    expect(taskOfBranch("T5", "T")).toBe(5);
    expect(taskOfBranch("main", "T")).toBeNull();
    expect(taskOfBranch("T5x-thing", "T")).toBeNull();
    expect(taskOfBranch("fix-T5", "T")).toBeNull();
    expect(taskOfBranch(undefined, "T")).toBeNull();
    expect(taskOfBranch("T72-branch-prs", null)).toBeNull();
    expect(taskOfBranch("feature/KW-12-login", "feature/KW-")).toBe(12);
    expect(taskOfBranch("kw-12", "KW-")).toBe(12);
    expect(taskOfBranch("T72-branch-prs", "KW-")).toBeNull();
    expect(taskOfBranch("t.5-x", "t.")).toBe(5);
    expect(taskOfBranch("tx5-x", "t.")).toBeNull();
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
    const log = [await ev("jon", { op: "branch.prefix.set", prefix: "T" }), add, other, news];
    const s = fold(log, roster);
    expect(taskPrs(taskFeed(s, log, add.seq))).toEqual([
      { url: "https://github.com/ojow/channels/pull/360", repo: "ojow/channels", number: 360, state: "open", seq: news.seq, title: "Branch PRs", branch: `T${add.seq}-branch-prs` },
    ]);
    expect(taskPrs(taskFeed(s, log, other.seq))).toEqual([]);
    expect(prsToLinkBack(s, 0)).toEqual([]);
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
    const s = fold([await ev("jon", { op: "branch.prefix.set", prefix: "T" }), add, news], roster);
    expect(taskPr(s, add.seq)).toMatchObject({ pr: { number: 2, additions: 40, deletions: 4, files: 3 }, checks: { passed: 1, failed: [], running: 1 } });
    expect(taskPr(s, add.seq + 100)).toBeUndefined();
  });
});

describe("a task's PR, looked up from one index per fold", () => {
  const pr = (number: number, branch: string, state: "open" | "closed" | "merged", at: number) => ({ repo: "o/r", number, branch, state, at, seq: number });
  const stateWith = (prs: ReturnType<typeof pr>[]) =>
    ({ branchPrefix: "T", github: { prs: new Map(prs.map((p) => [`o/r#${p.number}`, p])), checks: new Map(), issues: new Map(), rules: new Map(), releases: new Map() } }) as unknown as Parameters<
      typeof taskPr
    >[0];

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

describe("Write to GitHub: the owner's switch for the PR comment", () => {
  const opened = (number: number, branch: string, at: number): Event => ({
    op: "github",
    items: [{ event: "pull_request", repo: "ojow/channels", action: "opened", number, state: "open", branch, at }],
  });

  test("off by default: a PR on a task's branch gets no comment", async () => {
    const add = await ev("jon", { op: "task.add", title: "Secret plan for the acquisition" });
    const log = [await ev("jon", { op: "branch.prefix.set", prefix: "T" }), add, await ev("jon", opened(400, `T${add.seq}-plan`, 1))];
    const s = fold(log, roster);
    expect(s.githubWrite).toBeNull();
    expect(prsToLinkBack(s, 0)).toEqual([]);
  });

  test("only the owner turns it on; the comment names the task by its id, never its title", async () => {
    const prefix = await ev("jon", { op: "branch.prefix.set", prefix: "T" });
    const add = await ev("jon", { op: "task.add", title: "Secret plan for the acquisition" });
    const forged = await ev("mac", { op: "github.write.set", on: true });
    const on = await ev("jon", { op: "github.write.set", on: true });
    const news = await ev("jon", opened(401, `T${add.seq}-plan`, 2));
    expect(fold([prefix, add, forged, news], roster).rejected.get(forged.seq)).toBe("only the owner lets Kiwi write to GitHub");
    expect(prsToLinkBack(fold([prefix, add, forged, news], roster), 0)).toEqual([]);
    const s = fold([prefix, add, forged, on, news], roster);
    expect(s.githubWrite).toBe(on.seq);
    const due = prsToLinkBack(s, 0);
    expect(due).toEqual([{ repo: "ojow/channels", number: 401, task: add.seq, seq: news.seq, body: `Linked to Kiwi task T${add.seq}` }]);
    expect(due[0]!.body).not.toContain("Secret");
    expect(prsToLinkBack(s, news.seq)).toEqual([]);
  });

  test("a PR GitHub reported before it was on is never commented; turning it off stops the next one", async () => {
    const prefix = await ev("jon", { op: "branch.prefix.set", prefix: "T" });
    const add = await ev("jon", { op: "task.add", title: "Old PRs" });
    const before = await ev("jon", opened(402, `T${add.seq}-old`, 3));
    const on = await ev("jon", { op: "github.write.set", on: true });
    const again = await ev("jon", { op: "github.write.set", on: true });
    const after = await ev("jon", opened(403, `T${add.seq}-new`, 4));
    const s = fold([prefix, add, before, on, again, after], roster);
    expect(s.githubWrite).toBe(on.seq);
    expect(prsToLinkBack(s, 0).map((p) => p.number)).toEqual([403]);
    const off = await ev("jon", { op: "github.write.set", on: false });
    const later = await ev("jon", opened(404, `T${add.seq}-later`, 5));
    expect(prsToLinkBack(fold([prefix, add, before, on, after, off, later], roster), 0)).toEqual([]);
  });

  test("a snapshot carries it, one from before the switch folds to off, and agents read the event", async () => {
    const on = await ev("jon", { op: "github.write.set", on: true });
    const kept: { base?: FoldBase } = {};
    fold([on], roster, Date.now(), null, null, null, (b) => void (kept.base = b));
    expect(kept.base!.githubWrite).toBe(on.seq);
    expect(fold([], roster, Date.now(), null, null, kept.base).githubWrite).toBe(on.seq);
    const older = { ...kept.base! };
    delete older.githubWrite;
    expect(fold([], roster, Date.now(), null, null, older).githubWrite).toBeNull();
    expect(describeEvent(on)).toBe("let Kiwi write to GitHub: a comment links each new PR and issue to its task, and a task closing closes its issue");
    const p = { v: 1, id: "x", from: "jon", kind: "event", body: "", ts: 1 };
    expect(wellFormed({ ...p, ev: { op: "github.write.set", on: false } })).toBe(true);
    expect(wellFormed({ ...p, ev: { op: "github.write.set", on: "yes" } })).toBe(false);
  });
});

describe("the branch prefix: the owner's choice of which branches link PRs to tasks", () => {
  const opened = (number: number, branch: string, at: number): Event => ({
    op: "github",
    items: [{ event: "pull_request", repo: "ojow/channels", action: "opened", number, state: "open", branch, at }],
  });

  test("none by default: a PR on a T<n>-… branch doesn't show on task T<n>", async () => {
    const add = await ev("jon", { op: "task.add", title: "Unlinked" });
    const log = [add, await ev("jon", opened(500, `T${add.seq}-unlinked`, 1))];
    const s = fold(log, roster);
    expect(s.branchPrefix).toBeNull();
    expect(taskPr(s, add.seq)).toBeUndefined();
    expect(taskPrs(taskFeed(s, log, add.seq))).toEqual([]);
  });

  test("only the owner sets it; a branch with that prefix links, another doesn't, and clearing it stops linking", async () => {
    const forged = await ev("mac", { op: "branch.prefix.set", prefix: "T" });
    const set = await ev("jon", { op: "branch.prefix.set", prefix: "kiwi/KW-" });
    const add = await ev("jon", { op: "task.add", title: "Prefixed" });
    const theirs = await ev("jon", opened(501, `kiwi/KW-${add.seq}-login`, 2));
    const old = await ev("jon", opened(502, `T${add.seq}-login`, 3));
    let s = fold([forged, set, add, theirs, old], roster);
    expect(s.rejected.get(forged.seq)).toBe("only the owner, or a person they fully trust, sets the branch prefix");
    expect(s.branchPrefix).toBe("kiwi/KW-");
    expect(taskPr(s, add.seq)?.pr.number).toBe(501);
    const cleared = await ev("jon", { op: "branch.prefix.set", prefix: null });
    s = fold([forged, set, add, theirs, old, cleared], roster);
    expect(s.branchPrefix).toBeNull();
    expect(taskPr(s, add.seq)).toBeUndefined();
  });

  test("a snapshot carries it, one from before the prefix folds to none, agents read the event, and only a short branch-safe prefix is well formed", async () => {
    const set = await ev("jon", { op: "branch.prefix.set", prefix: "T" });
    const kept: { base?: FoldBase } = {};
    fold([set], roster, Date.now(), null, null, null, (b) => void (kept.base = b));
    expect(kept.base!.branchPrefix).toBe("T");
    expect(fold([], roster, Date.now(), null, null, kept.base).branchPrefix).toBe("T");
    const older = { ...kept.base! };
    delete older.branchPrefix;
    expect(fold([], roster, Date.now(), null, null, older).branchPrefix).toBeNull();
    expect(describeEvent(set)).toBe("set the branch prefix to T: a PR from a branch like T7-… shows on task T7");
    expect(describeEvent(await ev("jon", { op: "branch.prefix.set", prefix: null }))).toBe("cleared the branch prefix: a PR shows on a task only when someone posts its link");
    const p = { v: 1, id: "x", from: "jon", kind: "event", body: "", ts: 1 };
    expect(wellFormed({ ...p, ev: { op: "branch.prefix.set", prefix: "feature/KW-" } })).toBe(true);
    expect(wellFormed({ ...p, ev: { op: "branch.prefix.set", prefix: null } })).toBe(true);
    expect(wellFormed({ ...p, ev: { op: "branch.prefix.set", prefix: "" } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "branch.prefix.set", prefix: "has space" } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "branch.prefix.set", prefix: "x".repeat(33) } })).toBe(false);
  });
});
