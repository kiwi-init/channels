import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { claudeArgv, claudeSession } from "../src/loop/claude.ts";
import { firstPrompt, nextWork, workOver } from "../src/loop/work.ts";

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

  test("a task the seat owns comes first, the one it's doing before an open one", async () => {
    const open = await ev("jon", { op: "task.add", title: "Open", owner: "ana" });
    const doing = await ev("jon", { op: "task.add", title: "Doing", owner: "ana" });
    const started = await ev("ana", { op: "task.update", task: doing.seq, state: "doing" });
    const toReview = await ev("jon", { op: "task.add", title: "Bo's", owner: "bo", review: "ana" });
    const round = await ev("bo", { op: "task.update", task: toReview.seq, state: "review", at: "abc1234" });
    const s = fold([open, doing, started, toReview, round], roster);
    expect(nextWork(s, "ana", 3)).toEqual({ kind: "coding", task: doing.seq });
    expect(nextWork(fold([open, toReview, round], roster), "ana", 0)).toEqual({ kind: "coding", task: open.seq });
  });

  test("then an open round the seat reviews, then messages for it", async () => {
    const t = await ev("jon", { op: "task.add", title: "Bo's", owner: "bo", review: "ana" });
    const round = await ev("bo", { op: "task.update", task: t.seq, state: "review", at: "abc1234" });
    expect(nextWork(fold([t, round], roster), "ana", 2)).toEqual({ kind: "reviewing", task: t.seq, round: 1 });
    expect(nextWork(fold([t], roster), "ana", 2)).toEqual({ kind: "answering" });
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
