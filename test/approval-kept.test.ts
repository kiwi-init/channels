import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type Event, type GithubNote, type KeptEvidence, type Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { compareHeads, gitIn, type Git } from "../src/approval-kept.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "owl", "win", "mac", "zed"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "owl", pk: ids.owl!.pk, owner: false, at: 1, active: true, kind: "agent", role: "lead" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 3, active: true, kind: "agent" },
    { name: "zed", pk: ids.zed!.pk, owner: false, at: 4, active: true, kind: "agent" },
  ];
});

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const TIP = "d".repeat(40);
const TIP2 = "e".repeat(40);

const kept = (more: Partial<KeptEvidence> = {}): KeptEvidence => ({ head: B, approved: A, how: "clean-merge", repo: "o/r", ref: "origin/main", tip: TIP, ...more });

const pr =
  (sha: string, state: "open" | "closed" = "open", merged = false) =>
  (task: number): GithubNote => ({ event: "pull_request", repo: "o/r", number: 7, state, merged, branch: `T${task}-ship`, sha, at: seq, ...(merged ? { happened: seq + 1 } : {}) });

async function approvedAtA(): Promise<{ id: number; log: Message[] }> {
  const repos = await ev("jon", { op: "repos.set", repos: ["o/r"] });
  const prefix = await ev("jon", { op: "branch.prefix.set", prefix: "T" });
  const add = await ev("owl", { op: "task.add", title: "Ship", owner: "win", review: "mac", then: "merge" });
  const opened = await ev("jon", { op: "github", items: [pr(A)(add.seq)] });
  const round = await ev("win", { op: "task.update", task: add.seq, state: "review", at: A });
  const pass = await ev("mac", { op: "task.update", task: add.seq, state: "done", verdict: "approved", round: 1, at: A });
  return { id: add.seq, log: [repos, prefix, add, opened, round, pass] };
}

const keep = (from: string, task: number, evidence: KeptEvidence) => ev(from, { op: "task.update", task, kept: evidence });
const push = (task: number, sha: string) => ev("jon", { op: "github", items: [pr(sha)(task)] });

describe("an approval survives a new head on recorded evidence (#3930 §4)", () => {
  test("evidence before the push: the task stays landing and the gates accept the new head (cases 11, 12)", async () => {
    const { id, log } = await approvedAtA();
    const evidence = await keep("win", id, kept());
    const pushed = await push(id, B);
    const s = fold([...log, evidence, pushed], roster);
    const t = s.tasks.get(id)!;
    expect(s.rejected.size).toBe(0);
    expect(t.state).toBe("landing");
    expect(t.approvedBy).toBe("mac");
    expect(t.rounds.length).toBe(1);
    expect(t.rounds[0]!.stale).toBeUndefined();
    expect(t.rounds[0]!.kept).toEqual([{ ...kept(), seq: evidence.seq, by: "win", rts: evidence.seq }]);
    expect(t.notes.at(-1)!.text).toBe("bbbbbbb is a clean merge of origin/main into the approved aaaaaaa: the approval holds");
    const merged = await ev("jon", { op: "github", items: [pr(B, "closed", true)(id)] });
    const landed = await ev("jon", { op: "task.landed", task: id, artifact: { kind: "pr", repo: "o/r", pr: 7, sha: B } });
    const after = fold([...log, evidence, pushed, merged, landed], roster);
    expect(after.rejected.has(landed.seq)).toBe(false);
    expect(after.tasks.get(id)).toMatchObject({ state: "done", closedSeq: landed.seq });
  });

  test("evidence after the push: the task went back to review and returns to landing", async () => {
    const { id, log } = await approvedAtA();
    const pushed = await push(id, B);
    const before = fold([...log, pushed], roster).tasks.get(id)!;
    expect(before.state).toBe("review");
    expect(before.rounds[0]!.stale).toBe(pushed.seq);
    const evidence = await keep("win", id, kept({ how: "same-tree" }));
    const t = fold([...log, pushed, evidence], roster).tasks.get(id)!;
    expect(t.state).toBe("landing");
    expect(t.approvedBy).toBe("mac");
    expect(t.rounds.length).toBe(1);
    expect(t.rounds[0]!.stale).toBeUndefined();
    expect(t.notes.slice(-2).map((n) => n.text)).toEqual(["bbbbbbb is the same tree as the approved aaaaaaa: the approval holds", "head bbbbbbb is the approved code: the approval holds again"]);
  });

  test("a new head with no evidence isn't kept, and the approved head needs none (case 24)", async () => {
    const { id, log } = await approvedAtA();
    const still = fold(log, roster).tasks.get(id)!;
    expect(still.state).toBe("landing");
    const pushed = await push(id, B);
    const t = fold([...log, pushed], roster).tasks.get(id)!;
    expect(t.state).toBe("review");
    expect(t.approvedBy).toBeUndefined();
    expect(t.rounds.at(-1)!.result.kind).toBe("approved");
    expect(t.notes.at(-1)!.text).toBe("new head bbbbbbb on o/r#7 after the approval: back to review");
  });

  test("a head that returns to kept code holds the approval again, on the push or on evidence sent again", async () => {
    const { id, log } = await approvedAtA();
    const evidence = await keep("win", id, kept());
    const toB = await push(id, B);
    const toC = await push(id, C);
    const away = fold([...log, evidence, toB, toC], roster).tasks.get(id)!;
    expect(away.state).toBe("review");
    const back = await push(id, B);
    const t = fold([...log, evidence, toB, toC, back], roster).tasks.get(id)!;
    expect(t.state).toBe("landing");
    expect(t.approvedBy).toBe("mac");
    expect(t.rounds.length).toBe(1);
    expect(t.rounds[0]!.stale).toBeUndefined();
    expect(t.rounds[0]!.kept).toEqual([{ ...kept(), seq: evidence.seq, by: "win", rts: evidence.seq }]);
    expect(t.notes.at(-1)!.text).toBe("head bbbbbbb is the approved code: the approval holds again");
    const resent = await keep("win", id, kept({ tip: TIP2 }));
    const again = fold([...log, evidence, toB, toC, back, resent], roster).tasks.get(id)!;
    expect(again.state).toBe("landing");
    expect(again.rounds[0]!.kept).toEqual(t.rounds[0]!.kept);
  });

  test("a head that returns to the approved commit holds the approval again, with no evidence", async () => {
    const { id, log } = await approvedAtA();
    const toC = await push(id, C);
    const back = await push(id, A);
    const t = fold([...log, toC, back], roster).tasks.get(id)!;
    expect(t.state).toBe("landing");
    expect(t.approvedBy).toBe("mac");
    expect(t.rounds[0]!.stale).toBeUndefined();
    expect(t.rounds[0]!.kept).toBeUndefined();
  });

  test("evidence sent again doesn't revive an approval that a new round, or a rejection, replaced", async () => {
    const { id, log } = await approvedAtA();
    const evidence = await keep("win", id, kept());
    const toC = await push(id, C);
    const round = await ev("win", { op: "task.update", task: id, state: "review", at: C });
    const back = await push(id, B);
    const open = fold([...log, evidence, toC, round, back], roster);
    expect(open.tasks.get(id)!.state).toBe("review");
    expect(open.tasks.get(id)!.rounds.at(-1)).toMatchObject({ n: 2, at: C, result: { kind: "open" } });
    const resent = await keep("win", id, kept());
    const s = fold([...log, evidence, toC, round, back, resent], roster);
    expect(s.rejected.get(resent.seq)).toBe(`T${id} has no approval pinned to a commit`);
    expect(s.tasks.get(id)!.state).toBe("review");
    const reject = await ev("mac", { op: "task.update", task: id, state: "doing", verdict: "rejected", round: 2, at: C, note: "no" });
    const late = await keep("win", id, kept());
    const after = fold([...log, evidence, toC, round, back, reject, late], roster);
    expect(after.rejected.has(late.seq)).toBe(true);
    expect(after.tasks.get(id)!.state).toBe("doing");
  });

  test("evidence for one head doesn't cover a later one", async () => {
    const { id, log } = await approvedAtA();
    const evidence = await keep("win", id, kept());
    const pushed = await push(id, C);
    expect(fold([...log, evidence, pushed], roster).tasks.get(id)!.state).toBe("review");
  });

  test("the evidence is recorded once: a later claim for the same head changes nothing (case 23)", async () => {
    const { id, log } = await approvedAtA();
    const first = await keep("win", id, kept());
    const again = await keep("win", id, kept({ tip: TIP2, how: "same-tree" }));
    const pushed = await push(id, B);
    const all = [...log, first, again, pushed];
    const t = fold(all, roster).tasks.get(id)!;
    expect(t.rounds[0]!.kept).toEqual([{ ...kept(), seq: first.seq, by: "win", rts: first.seq }]);
    expect(t.state).toBe("landing");
    expect(fold(all, roster).tasks.get(id)!.rounds[0]!.kept).toEqual(t.rounds[0]!.kept);
  });

  test("only the task's owner or the lead records it, and only against the pinned approved head", async () => {
    const { id, log } = await approvedAtA();
    const stranger = await keep("zed", id, kept());
    const wrong = await keep("win", id, kept({ approved: C }));
    const lead = await keep("owl", id, kept());
    const s = fold([...log, stranger, wrong, lead], roster);
    expect(s.rejected.get(stranger.seq)).toBe(`only win or the lead records that T${id}'s approval holds at a new head`);
    expect(s.rejected.get(wrong.seq)).toBe(`T${id} is approved at aaaaaaa, not at ccccccc`);
    expect(s.rejected.has(lead.seq)).toBe(false);
    expect(s.tasks.get(id)!.rounds[0]!.kept!.map((k) => k.by)).toEqual(["owl"]);
  });

  test("a task with no approval pinned to a commit takes no evidence", async () => {
    const add = await ev("owl", { op: "task.add", title: "Ship", owner: "win", review: "mac", then: "merge" });
    const round = await ev("win", { op: "task.update", task: add.seq, state: "review", at: A });
    const early = await keep("win", add.seq, kept());
    const s = fold([add, round, early], roster);
    expect(s.rejected.get(early.seq)).toBe(`T${add.seq} has no approval pinned to a commit`);
  });

  test("linking the approved PR keeps the approval; linking one at another head sends it back (case 13)", async () => {
    const repos = await ev("jon", { op: "repos.set", repos: ["o/r"] });
    const add = await ev("owl", { op: "task.add", title: "Ship", owner: "win", review: "mac", then: "merge" });
    const round = await ev("win", { op: "task.update", task: add.seq, state: "review", at: A });
    const pass = await ev("mac", { op: "task.update", task: add.seq, state: "done", verdict: "approved", round: 1, at: A });
    const same = await ev("jon", { op: "github", items: [{ ...pr(A)(0), branch: "ship-it" }] });
    const other = await ev("jon", { op: "github", items: [{ ...pr(B)(0), branch: "other", number: 8 }] });
    const link = await ev("win", { op: "task.update", task: add.seq, proof: { url: "https://github.com/o/r/pull/7" } });
    const base = [repos, add, round, pass, same, other, link];
    const linked = fold(base, roster);
    expect(linked.rejected.size).toBe(0);
    expect(linked.tasks.get(add.seq)!.state).toBe("landing");
    expect(linked.tasks.get(add.seq)!.rounds.length).toBe(1);
    const swap = await ev("win", { op: "task.update", task: add.seq, proof: { url: "https://github.com/o/r/pull/8" } });
    const swapped = fold([...base, swap], roster).tasks.get(add.seq)!;
    expect(swapped.state).toBe("review");
    expect(swapped.notes.at(-1)!.text).toBe("new head bbbbbbb on o/r#8 after the approval: back to review");
  });

  test("the wire shape takes whole commit ids, two different heads and a known kind", async () => {
    const good = await keep("win", 1, kept());
    expect(wellFormed(good)).toBe(true);
    const bad = (evidence: unknown): boolean => wellFormed({ ...good, ev: { op: "task.update", task: 1, kept: evidence } });
    expect(bad({ ...kept(), head: "bbbbbbb" })).toBe(false);
    expect(bad({ ...kept(), head: A })).toBe(false);
    expect(bad({ ...kept(), how: "patch-id" })).toBe(false);
    expect(bad({ ...kept(), ref: "origin/main --force" })).toBe(false);
    expect(bad({ ...kept(), extra: 1 })).toBe(false);
  });
});

describe("the builder's checkout decides whether a new head is the approved code (#3930 §4)", () => {
  let dir: string;
  let git: Git;
  const run = (...args: string[]): string => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const tryRun = (...args: string[]): boolean =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, encoding: "utf8" }).status === 0;
  const write = (file: string, text: string) => writeFileSync(join(dir, file), text);
  const commit = (file: string, text: string, message: string): string => {
    write(file, text);
    run("add", file);
    run("commit", "-q", "-m", message);
    return run("rev-parse", "HEAD");
  };
  const branchAt = (name: string, at: string) => run("switch", "-q", "-C", name, at);
  let approved: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kiwi-kept-"));
    git = gitIn(dir);
    run("init", "-q", "-b", "main");
    commit("label.ts", 'export const label = "old";\n', "base");
    write("other.txt", "one\n");
    run("add", "other.txt");
    run("commit", "-q", "-m", "other");
    branchAt("feat", "main");
    approved = commit("feature.txt", "the task's code\n", "feature");
    run("switch", "-q", "main");
    commit("other.txt", "one\ntwo\n", "main moves");
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("the approved head itself is the same head", () => {
    expect(compareHeads(git, approved, approved, "main")).toEqual({ kind: "same", head: approved });
    expect(compareHeads(git, approved.slice(0, 9), approved, "main")).toEqual({ kind: "same", head: approved });
  });

  test("a reworded commit with the same tree is kept (case 11)", () => {
    branchAt("reworded", approved);
    run("commit", "-q", "--amend", "-m", "feature, reworded");
    const head = run("rev-parse", "HEAD");
    expect(head).not.toBe(approved);
    expect(compareHeads(git, approved, head, "main")).toEqual({ kind: "kept", how: "same-tree", head, approved, tip: run("rev-parse", "main") });
  });

  test("a clean merge of main is kept, and so are two in a row (case 12)", () => {
    branchAt("merged", approved);
    run("merge", "-q", "--no-ff", "-m", "merge main", "main");
    const one = run("rev-parse", "HEAD");
    expect(compareHeads(git, approved, one, "main")).toMatchObject({ kind: "kept", how: "clean-merge", head: one, approved });
    run("switch", "-q", "main");
    commit("other.txt", "one\ntwo\nthree\n", "main moves again");
    run("switch", "-q", "merged");
    run("merge", "-q", "--no-ff", "-m", "merge main again", "main");
    const two = run("rev-parse", "HEAD");
    expect(compareHeads(git, approved, two, "main")).toEqual({ kind: "kept", how: "clean-merge", head: two, approved, tip: run("rev-parse", "main") });
  });

  test("approved A, a code commit B, then a clean merge M isn't kept (case 12)", () => {
    branchAt("sneaky", approved);
    const b = commit("feature.txt", "the task's code, changed\n", "B");
    run("merge", "-q", "--no-ff", "-m", "merge main", "main");
    const found = compareHeads(git, approved, "HEAD", "main");
    expect(found).toEqual({ kind: "changed", why: `${b.slice(0, 7)} isn't a merge of two parents, so it may change the task's code` });
  });

  test('a merge that types "a b" where the automatic merge gives "ab" isn\'t kept (case 12)', () => {
    branchAt("main-label", "main");
    commit("label.ts", 'export const label = "ab";\n', "label on the target");
    branchAt("spaced", approved);
    run("merge", "-q", "--no-ff", "--no-commit", "main-label");
    write("label.ts", 'export const label = "a b";\n');
    run("add", "label.ts");
    run("commit", "-q", "-m", "merge with an edit");
    const head = run("rev-parse", "HEAD");
    expect(compareHeads(git, approved, head, "main-label")).toEqual({ kind: "changed", why: `${head.slice(0, 7)} holds edits beyond the merge of main-label` });
  });

  test("a merge resolved by hand after a conflict isn't kept", () => {
    branchAt("main-conflict", "main");
    commit("feature.txt", "the target's own text\n", "target touches the same file");
    branchAt("resolved", approved);
    expect(tryRun("merge", "-q", "--no-ff", "-m", "merge", "main-conflict")).toBe(false);
    write("feature.txt", "resolved by hand\n");
    run("add", "feature.txt");
    run("commit", "-q", "-m", "merge, resolved");
    const head = run("rev-parse", "HEAD");
    expect(compareHeads(git, approved, head, "main-conflict")).toEqual({ kind: "changed", why: `${head.slice(0, 7)} merges main-conflict with a conflict` });
  });

  test("a merge of a branch that isn't on the target isn't kept", () => {
    branchAt("side", "main");
    const side = commit("side.txt", "side\n", "side work");
    branchAt("pulled-side", approved);
    run("merge", "-q", "--no-ff", "-m", "merge side", "side");
    const head = run("rev-parse", "HEAD");
    expect(compareHeads(git, approved, head, "main")).toEqual({ kind: "changed", why: `${head.slice(0, 7)} merges ${side.slice(0, 7)}, which isn't on main` });
  });

  test("an octopus merge isn't kept", () => {
    branchAt("arm-one", "main");
    commit("one.txt", "1\n", "arm one");
    branchAt("arm-two", "main");
    commit("two.txt", "2\n", "arm two");
    branchAt("octopus", approved);
    run("merge", "-q", "--no-ff", "-m", "octopus", "arm-one", "arm-two");
    const head = run("rev-parse", "HEAD");
    expect(compareHeads(git, approved, head, "main")).toEqual({ kind: "changed", why: `${head.slice(0, 7)} isn't a merge of two parents, so it may change the task's code` });
  });

  test("a commit or a target this checkout doesn't have can't be judged", () => {
    expect(compareHeads(git, "f".repeat(40), "HEAD", "main")).toEqual({ kind: "changed", why: `the approved commit ${"f".repeat(40)} isn't in this checkout` });
    expect(compareHeads(git, approved, "merged", "origin/nowhere")).toEqual({ kind: "changed", why: "origin/nowhere isn't in this checkout (git fetch first)" });
  });
});
