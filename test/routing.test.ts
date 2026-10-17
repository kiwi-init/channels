// Members describe themselves (cards), shown in status and People. A task with a reviewer is done
// only when someone else says so, and handing work over is giving it to someone with a note. What
// older clients sent for routing (needs, dependencies, a handoff's branch and files) is ignored.

import { beforeAll, describe, expect, test } from "bun:test";
import { detectHarness, mergeCard, repoName, sameCard } from "../src/card.ts";
import { cardLine, describeEvent, formatMessage, formatStatus, formatTask, formatTasks } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type Event, type Kind, type Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { taskFeed } from "@kiwi/core/work.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function msg(from: string, kind: Kind, body: string, extra: { to?: string[]; ev?: Event } = {}): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ...extra, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}
const ev = (from: string, e: Event) => msg(from, "event", "", { ev: e });

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "mac", "win", "linux"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 1, active: true, kind: "agent", role: "frontend" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "linux", pk: ids.linux!.pk, owner: false, at: 3, active: true, kind: "agent" },
  ];
});

const cards = async () => [
  await ev("mac", { op: "card", os: "macos", arch: "arm64", harness: "claude-code", tools: ["Git", "xcode", "docker"], repo: "ojow/channels", branch: "main" }),
  await ev("win", { op: "card", os: "windows", arch: "x64", harness: "codex", tools: ["git", "dotnet"], repo: "ojow/channels" }),
  await ev("linux", { op: "card", os: "linux", arch: "x64", tools: ["git", "docker", "gpu"], note: "the CI box" }),
];

describe("cards", () => {
  test("a member says what it is; tags are lowercase; the card shows in status", async () => {
    const s = fold(await cards(), roster);
    expect(s.members.get("mac")!.card).toMatchObject({ os: "macos", tools: ["git", "xcode", "docker"], repo: "ojow/channels" });
    expect(cardLine(s.members.get("linux")!.card)).toBe("linux x64 · tools: git, docker, gpu · the CI box");
    const status = formatStatus({ alias: "c", me: "mac", state: s, online: new Map(), unread: 0 });
    expect(status).toContain("codex · windows x64 · ojow/channels · tools: git, dotnet");
  });

  test("a later card replaces the earlier one; describeEvent says it", async () => {
    const [first] = await cards();
    const later = await ev("mac", { op: "card", os: "macos", harness: "cursor" });
    const s = fold([first!, later], roster);
    expect(s.members.get("mac")!.card).toMatchObject({ os: "macos", harness: "cursor" });
    expect(s.members.get("mac")!.card!.tools).toBeUndefined();
    expect(describeEvent(later)).toBe("described itself: cursor · macos");
  });

  test("bounded: too many tools, or a long field, is malformed", () => {
    const p = { v: 1, id: "x", from: "mac", kind: "event", body: "", ts: 1 };
    expect(wellFormed({ ...p, ev: { op: "card", os: "macos", tools: Array(41).fill("t") } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "card", os: "x".repeat(121) } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "card", os: "macos", tools: Array(40).fill("t") } })).toBe(true);
  });
});

describe("review", () => {
  test("the doer can't mark reviewed work done; the reviewer approves; a person always may", async () => {
    const add = await ev("jon", { op: "task.add", title: "driver", owner: "win", review: "mac" });
    const t = add.seq;
    const selfDone = await ev("win", { op: "task.update", task: t, state: "done" });
    const toReview = await ev("win", { op: "task.update", task: t, state: "review" });
    const otherDone = await ev("linux", { op: "task.update", task: t, state: "done" });
    const approve = await ev("mac", { op: "task.update", task: t, state: "done", note: "ran it on the PC" });
    const s = fold([add, selfDone, toReview, otherDone, approve], roster);
    expect(s.rejected.get(selfDone.seq)).toBe(`T${t} needs review by mac before it's done (send it for review)`);
    expect(s.rejected.get(otherDone.seq)).toContain("needs review by mac");
    expect(s.tasks.get(t)!.state).toBe("done");
    expect(s.tasks.get(t)!.approvedBy).toBe("mac");
    expect(describeEvent(approve, s)).toBe(`approved T${t} “driver”: ran it on the PC`);
    expect(formatTask(s, s.tasks.get(t)!)).toContain("review by mac; approved by mac");
    // A person overrides.
    const p = fold([add, await ev("jon", { op: "task.update", task: t, state: "done" })], roster);
    expect(p.tasks.get(t)!.state).toBe("done");
  });

  test("a reviewer's reject reads as rejected, never as started; it sends the work back all the same", async () => {
    const add = await ev("jon", { op: "task.add", title: "driver", owner: "win", review: "mac" });
    const t = add.seq;
    const toReview = await ev("win", { op: "task.update", task: t, state: "review" });
    const reject = await ev("mac", { op: "task.update", task: t, state: "doing", verdict: "rejected", note: "3 blocking" });
    const restart = await ev("win", { op: "task.update", task: t, state: "doing" });
    const ms = [add, toReview, reject, restart];
    const s = fold(ms, roster);
    expect(s.tasks.get(t)!.state).toBe("doing");
    expect(describeEvent(reject, s)).toBe(`rejected T${t} “driver” (round 1): 3 blocking`);
    expect(describeEvent(restart, s)).toBe(`started T${t} “driver”`);
    expect(taskFeed(s, ms, t, "jon").flatMap((i) => (i.type === "event" ? [i.text] : []))).toEqual(["created the task for win", "sent it for review (round 1)", "rejected it (round 1)", "started it"]);
    expect(wellFormed({ ...reject, ev: { op: "task.update", task: t, verdict: "maybe" } })).toBe(false);
  });

  test("review rounds: each review opens a round at a commit, a verdict closes the open one, and a stale verdict is refused", async () => {
    const add = await ev("jon", { op: "task.add", title: "driver", owner: "win", review: "mac" });
    const t = add.seq;
    const r1 = await ev("win", { op: "task.update", task: t, state: "review", at: "abc123" });
    const rej = await ev("mac", { op: "task.update", task: t, state: "doing", verdict: "rejected", round: 1, note: "2 blocking" });
    const r2 = await ev("win", { op: "task.update", task: t, state: "review", at: "def456" });
    const stale = await ev("mac", { op: "task.update", task: t, state: "doing", verdict: "rejected", round: 1, note: "late" });
    const future = await ev("mac", { op: "task.update", task: t, state: "done", verdict: "approved", round: 3 });
    const self = await ev("win", { op: "task.update", task: t, state: "done", verdict: "approved", round: 2 });
    const mismatched = await ev("mac", { op: "task.update", task: t, state: "doing", verdict: "approved", round: 2 });
    const ok = await ev("mac", { op: "task.update", task: t, state: "done", verdict: "approved", round: 2, note: "clean" });
    const s = fold([add, r1, rej, r2, stale, future, self, mismatched, ok], roster);
    const task = s.tasks.get(t)!;
    expect(task.state).toBe("done");
    expect(task.approvedBy).toBe("mac");
    expect(task.rounds).toEqual([
      { n: 1, at: "abc123", by: "win", seq: r1.seq, ts: r1.ts, result: { kind: "rejected", by: "mac", seq: rej.seq, ts: rej.ts } },
      { n: 2, at: "def456", by: "win", seq: r2.seq, ts: r2.ts, result: { kind: "approved", by: "mac", seq: ok.seq, ts: ok.ts } },
    ]);
    expect(s.rejected.get(stale.seq)).toBe(`round 1 of T${t} isn't the open one: round 2 is`);
    expect(s.rejected.get(future.seq)).toBe(`round 3 of T${t} isn't the open one: round 2 is`);
    expect(s.rejected.get(self.seq)).toContain("needs review by mac");
    expect(s.rejected.get(mismatched.seq)).toBe("an approval finishes the task and a rejection sends it back to doing");
    expect(describeEvent(r1, s)).toBe(`sent for review T${t} “driver” (round 1 @ abc123)`);
    expect(describeEvent(ok, s)).toBe(`approved T${t} “driver” (round 2 @ def456): clean`);
    const shown = formatTask(s, task);
    expect(shown).toContain(`round 1 @ abc123, asked by win in #${r1.seq}`);
    expect(shown).toContain(`: rejected by mac in #${rej.seq}`);
    expect(shown).toContain(`: approved by mac in #${ok.seq}`);
  });

  test("sending it for review again withdraws the open round; once a round rejects it, its owner may cancel, but not while a round is open", async () => {
    const add = await ev("jon", { op: "task.add", title: "docs", owner: "win", review: "*" });
    const t = add.seq;
    const r1 = await ev("win", { op: "task.update", task: t, state: "review", at: "a1" });
    const r2 = await ev("win", { op: "task.update", task: t, state: "review", at: "a2" });
    const tooSoon = await ev("win", { op: "task.update", task: t, state: "cancelled" });
    const byWorker = await ev("win", { op: "task.update", task: t, state: "doing", verdict: "rejected", round: 2 });
    const rej = await ev("mac", { op: "task.update", task: t, state: "doing", verdict: "rejected", round: 2, note: "REVISE" });
    const late = await ev("linux", { op: "task.update", task: t, state: "done", verdict: "approved" });
    const oldCancel = await ev("win", { op: "task.update", task: t, state: "cancelled", note: "an older client's cancel" });
    const wrongRound = await ev("win", { op: "task.update", task: t, state: "cancelled", round: 1 });
    const before = fold([add, r1, r2, tooSoon, byWorker, rej, late, oldCancel, wrongRound], roster);
    expect(before.tasks.get(t)!.rounds.map((r) => r.result.kind)).toEqual(["withdrawn", "rejected"]);
    expect(before.tasks.get(t)!.state).toBe("doing");
    expect(before.rejected.get(byWorker.seq)).toBe(`only someone who hasn't worked on it gives T${t}'s verdict`);
    expect(before.rejected.get(late.seq)).toBe(`a verdict on T${t} names the round it judges`);
    const cancel = await ev("win", { op: "task.update", task: t, state: "cancelled", round: 2, note: "handed to the runner" });
    const after = fold([add, r1, r2, tooSoon, byWorker, rej, late, oldCancel, wrongRound, cancel], roster);
    expect(after.tasks.get(t)).toMatchObject({ state: "done", cancelled: true });
    expect(after.tasks.get(t)!.approvedBy).toBeUndefined();
  });

  test("history from before rounds folds to the same task states", async () => {
    const add = await ev("jon", { op: "task.add", title: "legacy", owner: "win", review: "mac" });
    const t = add.seq;
    const toReview = await ev("win", { op: "task.update", task: t, state: "review" });
    const done = await ev("mac", { op: "task.update", task: t, state: "done" });
    const reopen = await ev("mac", { op: "task.update", task: t, state: "doing", verdict: "rejected", note: "after all" });
    expect(fold([add, toReview, done, reopen], roster).tasks.get(t)!.state).toBe("doing");
    const add2 = await ev("jon", { op: "task.add", title: "legacy 2", owner: "win", review: "mac" });
    const t2 = add2.seq;
    const back = await ev("win", { op: "task.update", task: t2, state: "review" });
    const todo = await ev("win", { op: "task.update", task: t2, state: "todo" });
    const sendBack = await ev("mac", { op: "task.update", task: t2, state: "doing", verdict: "rejected" });
    const cancel = await ev("win", { op: "task.update", task: t2, state: "cancelled" });
    const s = fold([add2, back, todo, sendBack, cancel], roster);
    expect(s.tasks.get(t2)!.state).toBe("doing");
    expect(s.rejected.has(sendBack.seq)).toBe(false);
  });

  test("an old-style rejection from the author withdraws its round, so it never opens the way to a cancel", async () => {
    const add = await ev("jon", { op: "task.add", title: "own", owner: "win", review: "mac" });
    const t = add.seq;
    const request = await ev("win", { op: "task.update", task: t, state: "review", at: "a1" });
    const own = await ev("win", { op: "task.update", task: t, state: "doing", verdict: "rejected" });
    const cancel = await ev("win", { op: "task.update", task: t, state: "cancelled", round: 1 });
    const s = fold([add, request, own, cancel], roster);
    expect(s.tasks.get(t)!.rounds[0]!.result).toEqual({ kind: "withdrawn", seq: own.seq });
    expect(s.tasks.get(t)!.state).toBe("doing");
  });

  test("a verdict can carry the whole review as its message, and only a verdict can", async () => {
    const add = await ev("jon", { op: "task.add", title: "api", owner: "win", review: "mac" });
    const t = add.seq;
    const r1 = await ev("win", { op: "task.update", task: t, state: "review", at: "c0ffee" });
    const review = await msg("mac", "event", "## Review\n\n1. BLOCKING: the cache never expires\n\nVerdict: REVISE", {
      ev: { op: "task.update", task: t, state: "doing", verdict: "rejected", round: 1, note: "## Review", body: "review" },
    });
    const s = fold([add, r1, review], roster);
    expect(s.rejected.has(review.seq)).toBe(false);
    const line = formatMessage(review, s.trust.get(review.seq), s);
    expect(line).toContain(`rejected T${t} “api” (round 1 @ c0ffee): ## Review`);
    expect(line).toContain("│ 1. BLOCKING: the cache never expires");
    expect(line).toContain("│ Verdict: REVISE");
    expect(taskFeed(s, [add, r1, review], t, "jon").find((i) => i.type === "event" && i.seq === review.seq)).toMatchObject({ review: "## Review\n\n1. BLOCKING: the cache never expires\n\nVerdict: REVISE" });
    expect(wellFormed({ ...review, ev: { op: "task.update", task: t, note: "x", body: "review" } })).toBe(false);
    expect(wellFormed({ ...r1, ev: { op: "task.update", task: t, state: "review", at: "two\nlines" } })).toBe(false);
  });

  test("any: anyone who hasn't worked on it, judged by who owns it then", async () => {
    const add = await ev("jon", { op: "task.add", title: "docs", review: "*" });
    const t = add.seq;
    const claim = await ev("win", { op: "task.claim", task: t });
    const selfDone = await ev("win", { op: "task.update", task: t, state: "done" });
    const reject = await ev("mac", { op: "task.update", task: t, state: "doing", note: "missing the Windows steps" });
    const approve = await ev("linux", { op: "task.update", task: t, state: "done" });
    const s = fold([add, claim, selfDone, reject, approve], roster);
    expect(s.rejected.get(selfDone.seq)).toContain("someone who hasn't worked on it");
    expect(s.tasks.get(t)!.notes.map((n) => n.text)).toEqual(["missing the Windows steps"]);
    expect(s.tasks.get(t)!.approvedBy).toBe("linux");
    expect(formatTasks(fold([add, claim], roster))).toContain("[review by anyone who hasn't worked on it]");
  });

  test("handing it to someone first doesn't make the doer its reviewer", async () => {
    const add = await ev("jon", { op: "task.add", title: "sneaky", review: "*" });
    const t = add.seq;
    const claim = await ev("win", { op: "task.claim", task: t });
    const pass = await ev("win", { op: "task.update", task: t, owner: "mac" });
    const selfDone = await ev("win", { op: "task.update", task: t, state: "done" });
    const oneStep = await ev("win", { op: "task.update", task: t, owner: "linux", state: "done" });
    const reject = await ev("linux", { op: "task.update", task: t, state: "doing", note: "not yet" });
    const linuxDone = await ev("linux", { op: "task.update", task: t, state: "done" });
    const s = fold([add, claim, pass, selfDone, oneStep, reject, linuxDone], roster);
    for (const m of [selfDone, oneStep]) expect(s.rejected.get(m.seq)).toContain("someone who hasn't worked on it");
    // linux sent it back as a reviewer (not its owner), so it hasn't worked on it, and may approve.
    expect(s.tasks.get(t)!.workedBy).toEqual(["win", "mac"]);
    expect(s.tasks.get(t)!.approvedBy).toBe("linux");
  });

  test("only a person or the reviewer moves a review gate once it's set", async () => {
    const add = await ev("win", { op: "task.add", title: "mine", owner: "win", review: "mac" });
    const t = add.seq;
    const dodge = await ev("win", { op: "task.update", task: t, review: null });
    const swap = await ev("win", { op: "task.update", task: t, review: "*" });
    const handBack = await ev("mac", { op: "task.update", task: t, review: "linux" });
    const s = fold([add, dodge, swap, handBack], roster);
    expect(s.rejected.get(dodge.seq)).toBe(`only a person or mac changes who reviews T${t}`);
    expect(s.rejected.has(swap.seq)).toBe(true);
    expect(s.tasks.get(t)!.review).toBe("linux");
    // Setting one where there was none is anyone's (with the tasks scope).
    const open = await ev("jon", { op: "task.add", title: "open" });
    const set = await ev("win", { op: "task.update", task: open.seq, review: "mac" });
    expect(fold([open, set], roster).tasks.get(open.seq)!.review).toBe("mac");
  });

  test("reopening clears the approval", async () => {
    const add = await ev("jon", { op: "task.add", title: "x", review: "mac" });
    const s = fold([add, await ev("mac", { op: "task.update", task: add.seq, state: "done" }), await ev("jon", { op: "task.update", task: add.seq, state: "todo" })], roster);
    expect(s.tasks.get(add.seq)!.approvedBy).toBeUndefined();
  });
});

describe("handing over", () => {
  test("is giving it to someone with a note; an older client's handoff details are ignored", async () => {
    const add = await ev("jon", { op: "task.add", title: "port", owner: "mac" });
    // What an older client sent: the branch, commit and files ride along, and fold to nothing.
    const old = { op: "task.update", task: add.seq, owner: "win", note: "build on Windows next", handoff: { branch: "mac/port", commit: "3f9a2c1", files: ["src/a.ts"] } } as unknown as Event;
    const hand = await ev("mac", old);
    const s = fold([add, hand], roster);
    expect(s.tasks.get(add.seq)!.owner).toBe("win");
    expect(s.tasks.get(add.seq)!.notes[0]).toEqual({ seq: hand.seq, by: "mac", ts: expect.any(Number), text: "build on Windows next" });
    expect(describeEvent(hand, s)).toBe(`assigned T${add.seq} “port” to win: build on Windows next`);
    expect(formatTask(s, s.tasks.get(add.seq)!)).not.toContain("files");
  });
});

describe("reading the machine", () => {
  test("repo names from https and ssh remotes", () => {
    expect(repoName("https://github.com/ojowwalker77/channels.git")).toBe("ojowwalker77/channels");
    expect(repoName("git@github.com:ojowwalker77/channels.git")).toBe("ojowwalker77/channels");
    expect(repoName("https://gitlab.com/a/b/")).toBe("a/b");
    expect(repoName(null)).toBeNull();
  });

  test("the harness from its markers", () => {
    expect(detectHarness({ CLAUDECODE: "1" })).toBe("claude-code");
    expect(detectHarness({ GROK_SESSION_ID: "g1" })).toBe("grok");
    expect(detectHarness({ CLAUDECODE: "1", GROK_SESSION_ID: "g1" })).toBe("grok");
    expect(detectHarness({ CODEX_THREAD_ID: "x" })).toBe("codex");
    expect(detectHarness({ MIMOCODE: "1", CLAUDECODE: "1" })).toBe("mimocode");
    expect(detectHarness({ TERM: "dumb", NO_COLOR: "1", CLAUDECODE: "1" }, { from: 9, lookup: () => ({ ppid: 1, name: "kimi-code" }) })).toBe("kimi-code");
    expect(detectHarness({})).toBeUndefined();
  });

  test("what was said by hand stays until said again; detected tools follow the machine", () => {
    const was = { os: "macos", tools: ["docker", "figma"], model: "opus", note: "design work" };
    const now = { os: "macos", tools: ["git"] };
    const merged = mergeCard(now, was);
    expect(merged).toEqual({ os: "macos", tools: ["git", "figma"], model: "opus", note: "design work" });
    expect(mergeCard(now, was, { model: "sonnet", tools: ["Blender"] })).toMatchObject({ model: "sonnet", tools: ["git", "figma", "blender"] });
    expect(sameCard(merged, { ...merged, tools: ["figma", "git"] })).toBe(true);
    expect(sameCard(merged, { ...merged, note: "other" })).toBe(false);
  });
});
