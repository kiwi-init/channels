import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { claudeArgv, claudeSession } from "../src/loop/claude.ts";
import { codexArgv, codexIdle, codexThread } from "../src/loop/codex.ts";
import { grokArgv, grokIdle, grokSession } from "../src/loop/grok.ts";
import { mimoArgv, mimoIdle, mimoSession } from "../src/loop/mimo.ts";
import { isListener, kimiArgv, kimiIdle, kimiScreen, kimiSession, listenersUnder, stopStrays, strayKey, tmuxPastesFlag, type Proc } from "../src/loop/kimi.ts";
import { Database } from "bun:sqlite";
import { firstPrompt, nextWork, step, waitingBehind, waitingText, waitsDue, waitTellsTo, workOver, type Wait } from "../src/loop/work.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "ana", "bo"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "bo", pk: ids.bo!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

describe("the work a loop starts a session for", () => {
  test("nothing owned, nothing to review, nothing unread: no session", async () => {
    const t = await ev("jon", { op: "task.add", title: "Bo's", owner: "bo" });
    expect(nextWork(fold([t], roster), "ana", 0)).toBeNull();
  });

  test("the task the seat is doing comes first, then a round it owes, then an open task of its own", async () => {
    const open = await ev("jon", { op: "task.add", title: "Open", owner: "ana" });
    const doing = await ev("jon", { op: "task.add", title: "Doing", owner: "ana" });
    const started = await ev("ana", { op: "task.update", task: doing.seq, state: "doing" });
    const toReview = await ev("jon", { op: "task.add", title: "Bo's", owner: "bo", review: "ana" });
    const round = await ev("bo", { op: "task.update", task: toReview.seq, state: "review", at: "abc1234" });
    const s = fold([open, doing, started, toReview, round], roster);
    expect(nextWork(s, "ana", 3)).toEqual({ kind: "coding", task: doing.seq });
    expect(nextWork(fold([open, toReview, round], roster), "ana", 0)).toEqual({ kind: "reviewing", task: toReview.seq, round: 1 });
    expect(nextWork(fold([open], roster), "ana", 0)).toEqual({ kind: "coding", task: open.seq });
  });

  test("then an open round the seat reviews, then messages for it", async () => {
    const t = await ev("jon", { op: "task.add", title: "Bo's", owner: "bo", review: "ana" });
    const round = await ev("bo", { op: "task.update", task: t.seq, state: "review", at: "abc1234" });
    expect(nextWork(fold([t, round], roster), "ana", 2)).toEqual({ kind: "reviewing", task: t.seq, round: 1 });
    expect(nextWork(fold([t], roster), "ana", 2)).toEqual({ kind: "answering" });
  });

  test("a round open to anyone is owed by every seat that hasn't worked on the task (#1244)", async () => {
    const t = await ev("jon", { op: "task.add", title: "Bo's", owner: "bo", review: "*" });
    const round = await ev("bo", { op: "task.update", task: t.seq, state: "review", at: "abc1234" });
    const s = fold([t, round], roster);
    expect(nextWork(s, "ana", 0)).toEqual({ kind: "reviewing", task: t.seq, round: 1 });
    expect(waitingBehind({ kind: "answering" }, s, "ana")).toEqual([{ kind: "reviewing", task: t.seq, round: 1 }]);
    expect(nextWork(s, "ana", 2, new Set([`T${t.seq} round 1`]))).toEqual({ kind: "answering" });
    const own = await ev("jon", { op: "task.add", title: "Ana's", owner: "ana", review: "bo" });
    const sentOwn = await ev("ana", { op: "task.update", task: own.seq, state: "review", at: "fff6666" });
    const waiting = fold([t, round, own, sentOwn], roster);
    const coding = { kind: "coding" as const, task: own.seq };
    expect(workOver(coding, waiting, "ana")).toBe(true);
    expect(workOver(coding, waiting, "ana", new Set([`T${t.seq} round 1`]))).toBe(false);
    expect(waitingBehind(coding, waiting, "ana", new Set([`T${t.seq} round 1`]))).toEqual([]);
    const todo = await ev("jon", { op: "task.add", title: "Ana's next", owner: "ana" });
    const answering = fold([t, round, todo], roster);
    expect(step({ kind: "answering" }, answering, "ana", null, new Set([`T${t.seq} round 1`]))).toEqual({ kind: "fresh", work: { kind: "coding", task: todo.seq }, why: "took" });
    const worked = await ev("jon", { op: "task.add", title: "Ana's too", owner: "ana", review: "*" });
    const handed = await ev("ana", { op: "task.update", task: worked.seq, owner: "bo" });
    const sent = await ev("bo", { op: "task.update", task: worked.seq, state: "review", at: "def5678" });
    expect(nextWork(fold([worked, handed, sent], roster), "ana", 0)).toBeNull();
  });

  test("two coders reviewing each other: each one's waiting task yields to the round it owes", async () => {
    const t1 = await ev("jon", { op: "task.add", title: "Ana's", owner: "ana", review: "bo" });
    const t2 = await ev("jon", { op: "task.add", title: "Bo's", owner: "bo", review: "ana" });
    const r1 = await ev("ana", { op: "task.update", task: t1.seq, state: "review", at: "aaa1111" });
    const r2 = await ev("bo", { op: "task.update", task: t2.seq, state: "review", at: "bbb2222" });
    const s = fold([t1, t2, r1, r2], roster);
    expect(nextWork(s, "ana", 0)).toEqual({ kind: "reviewing", task: t2.seq, round: 1 });
    expect(nextWork(s, "bo", 0)).toEqual({ kind: "reviewing", task: t1.seq, round: 1 });
    expect(workOver({ kind: "coding", task: t1.seq }, s, "ana")).toBe(true);
    expect(workOver({ kind: "coding", task: t1.seq }, fold([t1, t2, r1], roster), "ana")).toBe(false);
  });

  test("a round the seat owes comes before its backlog, but not before the task it's doing", async () => {
    const backlog = await ev("jon", { op: "task.add", title: "Backlog", owner: "ana" });
    const theirs = await ev("jon", { op: "task.add", title: "Bo's", owner: "bo", review: "ana" });
    const round = await ev("bo", { op: "task.update", task: theirs.seq, state: "review", at: "ccc3333" });
    expect(nextWork(fold([backlog, theirs, round], roster), "ana", 0)).toEqual({ kind: "reviewing", task: theirs.seq, round: 1 });
    const started = await ev("ana", { op: "task.update", task: backlog.seq, state: "doing" });
    expect(nextWork(fold([backlog, theirs, round, started], roster), "ana", 0)).toEqual({ kind: "coding", task: backlog.seq });
  });

  test("everything a live session holds back is named, and nothing is while it holds only its own work", async () => {
    const live = await ev("jon", { op: "task.add", title: "Live", owner: "ana" });
    const started = await ev("ana", { op: "task.update", task: live.seq, state: "doing" });
    const session = { kind: "coding" as const, task: live.seq };
    expect(waitingBehind(session, fold([live, started], roster), "ana")).toEqual([]);
    const queued = await ev("jon", { op: "task.add", title: "Queued", owner: "ana" });
    const s = fold([live, started, queued], roster);
    expect(waitingBehind(session, s, "ana")).toEqual([{ kind: "coding", task: queued.seq }]);
    expect(waitingBehind({ kind: "answering" }, s, "ana")).toEqual([]);
    const theirs = await ev("jon", { op: "task.add", title: "Bo's", owner: "bo", review: "ana" });
    const round = await ev("bo", { op: "task.update", task: theirs.seq, state: "review", at: "eee5555" });
    const both = fold([live, started, queued, theirs, round], roster);
    expect(waitingBehind(session, both, "ana")).toEqual([
      { kind: "coding", task: queued.seq },
      { kind: "reviewing", task: theirs.seq, round: 1 },
    ]);
    expect(waitingBehind({ kind: "answering" }, both, "ana")).toEqual([{ kind: "reviewing", task: theirs.seq, round: 1 }]);
    expect(waitingBehind({ kind: "reviewing", task: theirs.seq, round: 1 }, fold([live, started, theirs, round], roster), "ana")).toEqual([session]);
  });

  test("a task of the seat's waiting on its own verdict, or one it reviews itself, isn't held back", async () => {
    const live = await ev("jon", { op: "task.add", title: "Live", owner: "ana" });
    const sent = await ev("jon", { op: "task.add", title: "Sent", owner: "ana", review: "bo" });
    const round = await ev("ana", { op: "task.update", task: sent.seq, state: "review", at: "aaa0000" });
    const own = await ev("jon", { op: "task.add", title: "Own", owner: "ana", review: "ana" });
    const ownRound = await ev("ana", { op: "task.update", task: own.seq, state: "review", at: "bbb0000" });
    expect(waitingBehind({ kind: "coding", task: live.seq }, fold([live, sent, round, own, ownRound], roster), "ana")).toEqual([]);
  });

  test("a wait keeps its age while the queue's order changes, is said once, and told once it's due; a failed tell is due again later", () => {
    const waits = new Map<string, Wait>();
    const a = { kind: "coding" as const, task: 2 };
    const b = { kind: "coding" as const, task: 3 };
    expect(waitsDue(waits, [a], 0, 100)).toEqual({ fresh: [a], due: [] });
    expect(waitsDue(waits, [b, a], 40, 100)).toEqual({ fresh: [b], due: [] });
    expect(waitsDue(waits, [a, b], 99, 100)).toEqual({ fresh: [], due: [] });
    expect(waitsDue(waits, [a, b], 100, 100)).toEqual({ fresh: [], due: [a] });
    waits.set("T2", { since: 0, tellAt: null });
    expect(waitsDue(waits, [b, a], 140, 100)).toEqual({ fresh: [], due: [b] });
    waits.set("T3", { since: 40, tellAt: 240 });
    expect(waitsDue(waits, [a, b], 239, 100)).toEqual({ fresh: [], due: [] });
    expect(waitsDue(waits, [a, b], 240, 100)).toEqual({ fresh: [], due: [b] });
    expect(waitsDue(waits, [b], 250, 100).fresh).toEqual([]);
    expect(waits.has("T2")).toBe(false);
    expect(waitsDue(waits, [a, b], 260, 100).fresh).toEqual([a]);
  });

  test("a long wait is told to the lead, or to the channel's active owners when the seat is the lead, the lead is gone, or there is none", async () => {
    const t = await ev("jon", { op: "task.add", title: "Any" });
    const s = fold([t], roster);
    expect(waitTellsTo({ ...s, lead: "bo" }, "ana")).toEqual(["bo"]);
    expect(waitTellsTo({ ...s, lead: "ana" }, "ana")).toEqual(["jon"]);
    expect(waitTellsTo({ ...s, lead: null }, "ana")).toEqual(["jon"]);
    const gone = new Map([...s.members].map(([name, m]) => [name, name === "bo" ? { ...m, active: false } : m]));
    expect(waitTellsTo({ ...s, lead: "bo", members: gone }, "ana")).toEqual(["jon"]);
    expect(waitTellsTo(s, "jon")).toEqual([]);
    const text = waitingText({ kind: "coding", task: 7 }, { kind: "coding", task: 3 }, 30);
    expect(text).toContain("T7 has waited 30 minutes behind my T3 session");
    expect(text).toContain("kiwi task assign T3");
    expect(waitingText({ kind: "reviewing", task: 7, round: 2 }, { kind: "reviewing", task: 3, round: 1 }, 45)).toContain("give round 1's verdict");
  });

  test("a task marked first goes before the seat's older tasks, the one it's doing included, until it's handed on", async () => {
    const older = await ev("jon", { op: "task.add", title: "Older", owner: "ana" });
    const started = await ev("ana", { op: "task.update", task: older.seq, state: "doing" });
    const urgent = await ev("jon", { op: "task.add", title: "Urgent" });
    const assigned = await ev("jon", { op: "task.update", task: urgent.seq, owner: "ana", note: "this one first" });
    const marked = await ev("jon", { op: "task.first", task: urgent.seq });
    expect(nextWork(fold([older, started, urgent, assigned], roster), "ana", 0)).toEqual({ kind: "coding", task: older.seq });
    expect(nextWork(fold([older, started, urgent, assigned, marked], roster), "ana", 0)).toEqual({ kind: "coding", task: urgent.seq });
    const noted = await ev("jon", { op: "task.update", task: urgent.seq, owner: "ana", note: "still ana's" });
    expect(nextWork(fold([older, started, urgent, assigned, marked, noted], roster), "ana", 0)).toEqual({ kind: "coding", task: urgent.seq });
    const later = await ev("ana", { op: "task.first", task: older.seq });
    expect(nextWork(fold([older, started, urgent, assigned, marked, later], roster), "ana", 0)).toEqual({ kind: "coding", task: older.seq });
    const away = await ev("jon", { op: "task.update", task: urgent.seq, owner: "bo" });
    const back = await ev("jon", { op: "task.update", task: urgent.seq, owner: "ana" });
    const s = fold([older, started, urgent, assigned, marked, away, back], roster);
    expect(s.tasks.get(urgent.seq)?.first).toBeUndefined();
    expect(nextWork(s, "ana", 0)).toEqual({ kind: "coding", task: older.seq });
  });

  test("only an owned, open task is put first, by anyone who may hand it on", async () => {
    const loose = await ev("jon", { op: "task.add", title: "Loose" });
    const unowned = await ev("jon", { op: "task.first", task: loose.seq });
    const anas = await ev("jon", { op: "task.add", title: "Ana's", owner: "ana" });
    const byBo = await ev("bo", { op: "task.first", task: anas.seq });
    const finished = await ev("jon", { op: "task.add", title: "Finished", owner: "ana" });
    const closed = await ev("ana", { op: "task.update", task: finished.seq, state: "done" });
    const late = await ev("jon", { op: "task.first", task: finished.seq });
    const s = fold([loose, unowned, anas, byBo, finished, closed, late], roster);
    expect(s.rejected.get(unowned.seq)).toContain("has no owner");
    expect(s.rejected.has(byBo.seq)).toBe(false);
    expect(s.rejected.get(late.seq)).toContain("already done");
    expect(s.tasks.get(anas.seq)?.first).toBe(byBo.seq);
    const reopened = await ev("ana", { op: "task.update", task: finished.seq, state: "doing" });
    const own = await ev("ana", { op: "task.first", task: finished.seq });
    expect(fold([loose, anas, finished, closed, reopened, own], roster).tasks.get(finished.seq)?.first).toBe(own.seq);
    const marked = await ev("jon", { op: "task.first", task: anas.seq });
    const done = await ev("ana", { op: "task.update", task: anas.seq, state: "done" });
    const again = await ev("ana", { op: "task.update", task: anas.seq, state: "doing" });
    expect(nextWork(fold([anas, marked, done], roster), "ana", 0)).toBeNull();
    expect(nextWork(fold([finished, closed, anas, marked, done, again], roster), "ana", 0)).toEqual({ kind: "coding", task: anas.seq });
  });

  test("a task marked first waits while its own round is with the reviewer, and its session yields to a round the seat owes", async () => {
    const older = await ev("jon", { op: "task.add", title: "Older", owner: "ana" });
    const urgent = await ev("jon", { op: "task.add", title: "Urgent", owner: "ana", review: "bo" });
    const marked = await ev("jon", { op: "task.first", task: urgent.seq });
    const round = await ev("ana", { op: "task.update", task: urgent.seq, state: "review", at: "ddd4444" });
    expect(nextWork(fold([older, urgent, marked, round], roster), "ana", 0)).toEqual({ kind: "coding", task: older.seq });
    const theirs = await ev("jon", { op: "task.add", title: "Bo's", owner: "bo", review: "ana" });
    const owed = await ev("bo", { op: "task.update", task: theirs.seq, state: "review", at: "fff6666" });
    const s = fold([urgent, marked, round, theirs, owed], roster);
    expect(workOver({ kind: "coding", task: urgent.seq }, s, "ana")).toBe(true);
    expect(nextWork(s, "ana", 0)).toEqual({ kind: "reviewing", task: theirs.seq, round: 1 });
  });

  test("with nothing else to do, the seat's task waiting on its verdict keeps a session", async () => {
    const t = await ev("jon", { op: "task.add", title: "Waiting", owner: "ana", review: "bo" });
    const round = await ev("ana", { op: "task.update", task: t.seq, state: "review", at: "ddd4444" });
    const s = fold([t, round], roster);
    expect(nextWork(s, "ana", 0)).toEqual({ kind: "coding", task: t.seq });
    expect(workOver({ kind: "coding", task: t.seq }, s, "ana")).toBe(false);
  });

  test("a coding session is over when the task is done, archived or someone else's", async () => {
    const t = await ev("jon", { op: "task.add", title: "Mine", owner: "ana" });
    const work = { kind: "coding" as const, task: t.seq };
    expect(workOver(work, fold([t], roster), "ana")).toBe(false);
    const done = await ev("ana", { op: "task.update", task: t.seq, state: "done" });
    expect(workOver(work, fold([t, done], roster), "ana")).toBe(true);
    const moved = await ev("jon", { op: "task.update", task: t.seq, owner: "bo" });
    expect(workOver(work, fold([t, moved], roster), "ana")).toBe(true);
  });

  test("a coder waiting on review keeps its session through a rejection", async () => {
    const t = await ev("jon", { op: "task.add", title: "Reviewed", owner: "ana", review: "bo" });
    const round = await ev("ana", { op: "task.update", task: t.seq, state: "review", at: "abc1234" });
    const rejected = await ev("bo", { op: "task.update", task: t.seq, state: "doing", verdict: "rejected", round: 1 });
    const work = { kind: "coding" as const, task: t.seq };
    expect(workOver(work, fold([t, round], roster), "ana")).toBe(false);
    expect(workOver(work, fold([t, round, rejected], roster), "ana")).toBe(false);
  });

  test("a review session is over when its round closes, by a verdict or a newer round", async () => {
    const t = await ev("jon", { op: "task.add", title: "Bo's", owner: "bo", review: "ana" });
    const round = await ev("bo", { op: "task.update", task: t.seq, state: "review", at: "abc1234" });
    const work = { kind: "reviewing" as const, task: t.seq, round: 1 };
    expect(workOver(work, fold([t, round], roster), "ana")).toBe(false);
    const again = await ev("bo", { op: "task.update", task: t.seq, state: "review", at: "def5678" });
    expect(workOver(work, fold([t, round, again], roster), "ana")).toBe(true);
    const approved = await ev("ana", { op: "task.update", task: t.seq, state: "done", verdict: "approved", round: 1 });
    expect(workOver(work, fold([t, round, approved], roster), "ana")).toBe(true);
  });

  test("a messages session reads only what is for it, replies only where it's asked, and never acknowledges", () => {
    const text = firstPrompt({ kind: "answering" }, fold([], roster), "ana", "dev");
    expect(text).toContain("Read them with `kiwi listen --now --for-me`.");
    expect(text).toContain("Reply only to a message that asks you something or needs something from you");
    expect(text).toContain("react with 👍 (`kiwi react N 👍`)");
    expect(text).toContain("never post an acknowledgement or thanks");
    expect(text).not.toContain("answer each one");
  });

  test("a task whose round is open isn't told to start it, which would withdraw the round", async () => {
    const t = await ev("jon", { op: "task.add", title: "Sent", owner: "ana", review: "bo" });
    const round = await ev("ana", { op: "task.update", task: t.seq, state: "review", at: "eee5555" });
    const text = firstPrompt({ kind: "coding", task: t.seq }, fold([t, round], roster), "ana", "dev");
    expect(text).toContain(`Its round 1 is with bo: wait here for the verdict, and don't run \`kiwi task start T${t.seq}\``);
    expect(text).not.toContain("if it isn't doing yet");
    expect(text).toContain(`kiwi task checkpoint T${t.seq} --file note.md`);
  });

  test("a reviewed task asks for a checkpoint before its round; a self-reviewed one says nobody else will judge it", async () => {
    const t = await ev("jon", { op: "task.add", title: "Reviewed", owner: "ana", review: "bo" });
    const text = firstPrompt({ kind: "coding", task: t.seq }, fold([t], roster), "ana", "dev");
    expect(text.indexOf(`kiwi task checkpoint T${t.seq}`)).toBeLessThan(text.indexOf(`kiwi task review T${t.seq} --at SHA`));
    expect(text).not.toContain("You're also its reviewer");
    const own = await ev("jon", { op: "task.add", title: "Own", owner: "ana", review: "ana" });
    expect(firstPrompt({ kind: "coding", task: own.seq }, fold([own], roster), "ana", "dev")).toContain("You're also its reviewer, so nobody else will give its verdict");
  });

  test("a review session answers messages but leaves the seat's own tasks for their sessions", async () => {
    const t = await ev("jon", { op: "task.add", title: "Bo's", owner: "bo", review: "ana" });
    const text = firstPrompt({ kind: "reviewing", task: t.seq, round: 1 }, fold([t], roster), "ana", "dev");
    expect(text).toContain("your own tasks wait for their own session, even if one of them is rejected meanwhile");
  });

  test("the first prompt names the work, how it ends, and carries re-entry", async () => {
    const t = await ev("jon", { op: "task.add", title: "Reviewed", owner: "ana", review: "bo" });
    const note = await ev("ana", { op: "task.update", task: t.seq, note: "branch feat/x at abc1234", checkpoint: true });
    const s = fold([t, note], roster);
    const text = firstPrompt({ kind: "coding", task: t.seq }, s, "ana", "dev");
    expect(text).toContain(`You're ana in the Kiwi Channels channel "dev"`);
    expect(text).toContain(`kiwi task review T${t.seq} --at SHA`);
    expect(text).toContain("The session ends when the review approves");
    expect(text).toContain("branch feat/x at abc1234");
    const plain = await ev("jon", { op: "task.add", title: "Plain", owner: "ana" });
    expect(firstPrompt({ kind: "coding", task: plain.seq }, fold([plain], roster), "ana", "dev")).toContain(`kiwi task done T${plain.seq}`);
    expect(firstPrompt({ kind: "reviewing", task: t.seq, round: 2 }, s, "bo", "dev")).toContain(`kiwi task approve T${t.seq} --round 2`);
  });
});

describe("the Claude Code recipe", () => {
  test("the model and effort the window chose, then the prompt after --", () => {
    expect(claudeArgv({ bin: "/bin/claude", model: "opus", effort: "high", prompt: "-go" })).toEqual(["/bin/claude", "--model", "opus", "--effort", "high", "--", "-go"]);
    expect(claudeArgv({ bin: "claude", prompt: "go" })).toEqual(["claude", "--", "go"]);
  });

  test("its process's registry gives the session id and whether it's idle", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-loop-claude-"));
    try {
      const env = { CLAUDE_CONFIG_DIR: dir };
      expect(claudeSession(42, env)).toBeNull();
      mkdirSync(join(dir, "sessions"));
      writeFileSync(join(dir, "sessions", "42.json"), "{half");
      expect(claudeSession(42, env)).toBeNull();
      writeFileSync(join(dir, "sessions", "42.json"), JSON.stringify({ pid: 42, sessionId: "s-1", status: "busy", statusUpdatedAt: 5 }));
      expect(claudeSession(42, env)).toEqual({ sessionId: "s-1", idle: false, since: 5 });
      writeFileSync(join(dir, "sessions", "42.json"), JSON.stringify({ pid: 42, sessionId: "s-1", status: "idle" }));
      expect(claudeSession(42, env)).toEqual({ sessionId: "s-1", idle: true, since: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the Codex recipe", () => {
  const thread = (ms: number, tail: string) => `${ms.toString(16).padStart(12, "0").slice(0, 8)}-${ms.toString(16).padStart(12, "0").slice(8)}-7abc-8def-${tail}`;
  const day = (home: string, at: number) => {
    const d = new Date(at);
    const dir = join(home, "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  test("the model, the effort as a config override, then the prompt after --", () => {
    expect(codexArgv({ bin: "codex", model: "gpt-6-astra", effort: "high", prompt: "go" })).toEqual(["codex", "-m", "gpt-6-astra", "-c", 'model_reasoning_effort="high"', "--", "go"]);
    expect(codexArgv({ bin: "codex", prompt: "go" })).toEqual(["codex", "--", "go"]);
  });

  test("the launch's thread is the one started after it whose rollout holds its nonce", () => {
    const home = mkdtempSync(join(tmpdir(), "kiwi-loop-codex-"));
    try {
      const env = { CODEX_HOME: home };
      const now = Date.now();
      const dir = day(home, now);
      const older = thread(now - 60_000, "000000000001");
      const other = thread(now + 100, "000000000002");
      const mine = thread(now + 200, "000000000003");
      writeFileSync(join(dir, `rollout-x-${older}.jsonl`), '{"type":"session_meta"}\n{"text":"(Kiwi loop launch abc123)"}\n');
      writeFileSync(join(dir, `rollout-x-${other}.jsonl`), '{"type":"session_meta"}\n{"text":"another launch"}\n');
      expect(codexThread("abc123", now, now + 1_000, env)).toBeNull();
      writeFileSync(join(dir, `rollout-x-${mine}.jsonl`), '{"type":"session_meta"}\n{"text":"(Kiwi loop launch abc123)"}\n');
      expect(codexThread("abc123", now, now + 1_000, env)).toEqual({ thread: mine, rollout: join(dir, `rollout-x-${mine}.jsonl`) });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("its rollout says when a turn is over", () => {
    const home = mkdtempSync(join(tmpdir(), "kiwi-loop-codex-"));
    try {
      const file = join(home, "rollout.jsonl");
      writeFileSync(file, '{"type":"event_msg","payload":{"type":"task_started"}}\n');
      expect(codexIdle(file).idle).toBe(false);
      writeFileSync(file, '{"type":"event_msg","payload":{"type":"task_started"}}\n{"type":"event_msg","payload":{"type":"task_complete"}}\n');
      expect(codexIdle(file)).toMatchObject({ idle: true });
      expect(codexIdle(file).since).toBeNumber();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("the Grok recipe", () => {
  const sessionId = (ms: number, tail: string) => `${ms.toString(16).padStart(12, "0").slice(0, 8)}-${ms.toString(16).padStart(12, "0").slice(8)}-7abc-8def-${tail}`;
  const update = (sessionUpdate: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s", update: { sessionUpdate, ...extra } } });

  test("the model and reasoning effort, then the prompt after --", () => {
    expect(grokArgv({ bin: "grok", model: "grok-4.7", effort: "high", prompt: "go" })).toEqual(["grok", "-m", "grok-4.7", "--reasoning-effort", "high", "--", "go"]);
    expect(grokArgv({ bin: "grok", prompt: "go" })).toEqual(["grok", "--", "go"]);
  });

  test("the launch's session is the one in this folder started after it whose history holds its nonce", () => {
    const home = mkdtempSync(join(tmpdir(), "kiwi-loop-grok-"));
    try {
      const env = { GROK_HOME: home };
      const cwd = "/work/proj";
      const now = Date.now();
      const here = join(home, "sessions", encodeURIComponent(cwd));
      const elsewhere = join(home, "sessions", encodeURIComponent("/work/other"));
      const older = sessionId(now - 60_000, "000000000001");
      const other = sessionId(now + 100, "000000000002");
      const mine = sessionId(now + 200, "000000000003");
      mkdirSync(join(here, older), { recursive: true });
      mkdirSync(join(here, mine), { recursive: true });
      mkdirSync(join(elsewhere, other), { recursive: true });
      writeFileSync(join(here, older, "chat_history.jsonl"), '{"type":"user","content":"(Kiwi loop launch abc123)"}\n');
      writeFileSync(join(elsewhere, other, "chat_history.jsonl"), '{"type":"user","content":"(Kiwi loop launch abc123)"}\n');
      expect(grokSession("abc123", now, cwd, env)).toBeNull();
      writeFileSync(join(here, mine, "chat_history.jsonl"), '{"type":"user","content":"(Kiwi loop launch abc123)"}\n');
      expect(grokSession("abc123", now, cwd, env)).toEqual({ session: mine, dir: join(here, mine) });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("its update stream says when a turn is over: turn_completed or the Stop hook's run", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-loop-grok-"));
    try {
      const file = join(dir, "updates.jsonl");
      expect(grokIdle(dir)).toEqual({ idle: false, since: null });
      writeFileSync(file, [update("user_message_chunk"), update("tool_call")].join("\n") + "\n");
      expect(grokIdle(dir).idle).toBe(false);
      writeFileSync(file, [update("tool_call"), update("agent_message_chunk"), update("turn_completed"), update("background_tasks")].join("\n") + "\n");
      expect(grokIdle(dir)).toMatchObject({ idle: true });
      writeFileSync(file, [update("tool_call"), update("hook_execution", { event_name: "stop" })].join("\n") + "\n");
      expect(grokIdle(dir).idle).toBe(true);
      writeFileSync(file, [update("turn_completed"), update("user_message_chunk")].join("\n") + "\n");
      expect(grokIdle(dir).idle).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the MiMoCode recipe", () => {
  const SCHEMA =
    "CREATE TABLE IF NOT EXISTS session (id text PRIMARY KEY, parent_id text, directory text NOT NULL, time_created integer NOT NULL); CREATE TABLE IF NOT EXISTS message (id text PRIMARY KEY, session_id text NOT NULL, agent_id text NOT NULL DEFAULT 'main', time_created integer NOT NULL, data text NOT NULL); CREATE TABLE IF NOT EXISTS part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL, data text NOT NULL);";
  const home = () => {
    const h = mkdtempSync(join(tmpdir(), "kiwi-loop-mimo-"));
    mkdirSync(join(h, "data"), { recursive: true });
    mkdirSync(join(h, "state"), { recursive: true });
    return h;
  };

  test("the model given, else the one chosen in MiMoCode, then the prompt; never an effort", () => {
    const h = home();
    try {
      const env = { MIMOCODE_HOME: h };
      expect(mimoArgv({ bin: "mimo", model: "xiaomi/x", prompt: "go" }, env)).toEqual(["mimo", "-m", "xiaomi/x", "--prompt", "go"]);
      expect(mimoArgv({ bin: "mimo", prompt: "go" }, env)).toEqual(["mimo", "--prompt", "go"]);
      writeFileSync(join(h, "state", "model.json"), JSON.stringify({ recent: [{ providerID: "xiaomi", modelID: "mimo-v2.6-pro" }], variant: {} }));
      expect(mimoArgv({ bin: "mimo", prompt: "go" }, env)).toEqual(["mimo", "-m", "xiaomi/mimo-v2.6-pro", "--prompt", "go"]);
    } finally {
      rmSync(h, { recursive: true, force: true });
    }
  });

  test("the launch's session is the top-level one in this folder started after it with the nonce in a part; idle once its last message is a finished answer", () => {
    const h = home();
    const db = new Database(join(h, "data", "mimocode.db"));
    try {
      const env = { MIMOCODE_HOME: h };
      const cwd = h;
      const dir = realpathSync(h);
      const now = Date.now();
      db.exec(SCHEMA);
      const session = db.prepare("INSERT INTO session (id, parent_id, directory, time_created) VALUES (?1, ?2, ?3, ?4)");
      const part = db.prepare("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?1, 'm', ?2, ?3, ?4)");
      const message = db.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?1, ?2, ?3, ?4)");
      session.run("ses_old", null, dir, now - 60_000);
      part.run("p1", "ses_old", now - 60_000, '{"type":"text","text":"(Kiwi loop launch abc123)"}');
      session.run("ses_child", "ses_x", dir, now + 100);
      part.run("p2", "ses_child", now + 100, '{"type":"text","text":"(Kiwi loop launch abc123)"}');
      session.run("ses_elsewhere", null, "/somewhere/else", now + 100);
      part.run("p3", "ses_elsewhere", now + 100, '{"type":"text","text":"(Kiwi loop launch abc123)"}');
      expect(mimoSession("abc123", now, cwd, env)).toBeNull();
      session.run("ses_mine", null, dir, now + 200);
      part.run("p4", "ses_mine", now + 200, '{"type":"text","text":"(Kiwi loop launch abc123)"}');
      expect(mimoSession("abc123", now, cwd, env)).toBe("ses_mine");

      expect(mimoIdle("ses_mine", env)).toEqual({ idle: false, since: null });
      message.run("m1", "ses_mine", now + 300, JSON.stringify({ role: "user", time: { created: now + 300 } }));
      expect(mimoIdle("ses_mine", env).idle).toBe(false);
      message.run("m2", "ses_mine", now + 400, JSON.stringify({ role: "assistant", time: { created: now + 400 } }));
      expect(mimoIdle("ses_mine", env).idle).toBe(false);
      message.run("m3", "ses_mine", now + 500, JSON.stringify({ role: "assistant", time: { created: now + 500, completed: now + 900 } }));
      expect(mimoIdle("ses_mine", env)).toEqual({ idle: true, since: now + 900 });
    } finally {
      db.close();
      rmSync(h, { recursive: true, force: true });
    }
  });
});

describe("the Kimi Code recipe", () => {
  test("the model, and no prompt: it's typed in once the screen is ready, never into the trust prompt", () => {
    expect(kimiArgv({ bin: "kimi", model: "kimi-code/k3" })).toEqual(["kimi", "-m", "kimi-code/k3"]);
    expect(kimiArgv({ bin: "kimi" })).toEqual(["kimi"]);
    expect(kimiScreen("Model: K3-256k\nNo session yet — one will be created on your first message.\n│ > ")).toBe("ready");
    expect(kimiScreen("Trust this folder?\n❯ Trust and continue\nExit")).toBe("trust");
    expect(kimiScreen("")).toBe("starting");
  });

  test("the launch's session is the earliest one for this folder started after it whose wire log holds its nonce; idle once its turn ended", () => {
    const home = mkdtempSync(join(tmpdir(), "kiwi-loop-kimi-"));
    try {
      const env = { KIMI_CODE_HOME: home };
      const cwd = realpathSync(home);
      const now = Date.now();
      const write = (wd: string, id: string, at: number, folder: string, wire: string[]) => {
        const dir = join(home, "sessions", wd, id);
        mkdirSync(join(dir, "agents", "main"), { recursive: true });
        writeFileSync(join(dir, "state.json"), JSON.stringify({ id, cwd: folder, createdAt: at }));
        writeFileSync(join(dir, "agents", "main", "wire.jsonl"), wire.join("\n") + "\n");
        return dir;
      };
      const prompt = JSON.stringify({ type: "turn.prompt", text: "(Kiwi loop launch abc123)" });
      write("wd_x_1", "session_old", now - 60_000, cwd, [prompt]);
      write("wd_y_2", "session_elsewhere", now + 100, "/some/other", [prompt]);
      expect(kimiSession("abc123", now, cwd, env)).toBeNull();
      const later = write("wd_x_1", "session_later", now + 900, cwd, [prompt]);
      const mine = write("wd_x_1", "session_mine", now + 200, cwd, [prompt, JSON.stringify({ type: "step.begin" })]);
      expect(kimiSession("abc123", now, cwd, env)).toEqual({ session: "session_mine", dir: mine });
      expect(later).not.toBe(mine);

      expect(kimiIdle(mine).idle).toBe(false);
      writeFileSync(
        join(mine, "agents", "main", "wire.jsonl"),
        [prompt, JSON.stringify({ type: "tool.call" }), JSON.stringify({ type: "turn.ended" }), JSON.stringify({ type: "context.append_loop_event" })].join("\n") + "\n",
      );
      expect(kimiIdle(mine)).toMatchObject({ idle: true });
      expect(kimiIdle(join(home, "nowhere"))).toEqual({ idle: false, since: null });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("the kiwi listeners a session left running are found under it, by pid and start time", async () => {
    const parent = Bun.spawn(["sh", "-c", "bash -c 'exec -a \"kiwi listen --once\" sleep 30' & sleep 30 & wait"], { stdout: "ignore", stderr: "ignore" });
    try {
      let found: { pid: number; start: string }[] = [];
      for (let i = 0; i < 50 && found.length === 0; i++) {
        await Bun.sleep(50);
        found = listenersUnder(parent.pid);
      }
      expect(found).toHaveLength(1);
      expect(found[0]!.start).toMatch(/\d{4}$/);
    } finally {
      parent.kill("SIGKILL");
      for (const s of listenersUnder(parent.pid)) process.kill(s.pid, "SIGKILL");
    }
  });

  test("only a listener still running with the pid and start time recorded is stopped; a reused pid, another command or an unkillable process isn't", () => {
    const start = "Fri Oct 23 13:25:11 2026";
    const procs: Proc[] = [
      { pid: 101, ppid: 1, start, args: "/home/u/.kiwi/bin/kiwi listen --once" },
      { pid: 102, ppid: 1, start: "Fri Oct 23 15:00:00 2026", args: "/home/u/.kiwi/bin/kiwi listen --once" },
      { pid: 103, ppid: 1, start, args: "vim notes" },
      { pid: 104, ppid: 1, start, args: "kiwi listen" },
    ];
    const recorded = new Set([101, 102, 103, 104].map((pid) => strayKey({ pid, start })));
    const signalled: number[] = [];
    const kill = (pid: number) => {
      if (pid === 104) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      signalled.push(pid);
    };
    expect(stopStrays(recorded, procs, kill)).toBe(1);
    expect(signalled).toEqual([101]);
  });

  test("a kiwi listen is told by the kiwi command's own words, quickly even on a long command line", () => {
    expect(isListener("/home/u/.kiwi/bin/kiwi listen --once")).toBe(true);
    expect(isListener("kiwi -c dev --as fond-owl listen --once")).toBe(true);
    expect(isListener("sh -c kiwi hook listen")).toBe(true);
    expect(isListener("kiwi --quiet listen")).toBe(true);
    expect(isListener("kiwi send listen")).toBe(false);
    expect(isListener("bun test test/kiwi/listen.test.ts")).toBe(false);
    expect(isListener("rg listen /home/u/kiwi")).toBe(false);
    const long = `kiwi ${"-x ".repeat(5_000)}nope`;
    const at = performance.now();
    expect(isListener(long)).toBe(false);
    expect(performance.now() - at).toBeLessThan(50);
  });

  test("bracketed paste can be checked from tmux 3.7 on", () => {
    expect(tmuxPastesFlag("3.6a")).toBe(false);
    expect(tmuxPastesFlag("tmux 3.4")).toBe(false);
    expect(tmuxPastesFlag("3.7")).toBe(true);
    expect(tmuxPastesFlag("tmux 3.8")).toBe(true);
    expect(tmuxPastesFlag("next-4.0")).toBe(true);
    expect(tmuxPastesFlag("master")).toBe(true);
    expect(tmuxPastesFlag("")).toBe(false);
  });
});
