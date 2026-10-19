// A task is open, doing or done (an older client's cancel is done), a near-duplicate open title
// warns, and an empty kiwi sh glob says so.

import { describe, expect, test } from "bun:test";
import { describeEvent, formatStatus, formatTask, formatTasks } from "@kiwi/core/format.ts";
import { memberLoad } from "@kiwi/core/load.ts";
import { wellFormedEvent, type Event, type Kind, type Message } from "@kiwi/core/protocol.ts";
import { runSh } from "../src/sh.ts";
import { fold as foldWith, similarOpenTasks, titlesLookAlike, type Roster, type Task } from "@kiwi/core/state.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";

const roster: Roster = [];
async function member(name: string): Promise<Identity> {
  const id = await generateIdentity(name);
  roster.push({ name, pk: id.pk, owner: false, at: 0, active: true });
  return id;
}
const fold = (ms: Message[]) => foldWith(ms, roster);

let seq = 0;
const T0 = 1_700_000_000_000;
async function msg(id: Identity, from: string, ev: Event): Promise<Message> {
  seq++;
  const at = T0 + seq * 1000;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as Kind, body: "", ts: at, ev };
  const p = await sign(id, base);
  return { ...p, seq, rts: at, sigOk: await verify(p) };
}

describe("open, doing, done", () => {
  test("an older client's cancel is done, with a note saying so; drop only unassigns", async () => {
    const a = await member("a");
    const added = await msg(a, "a", { op: "task.add", title: "duplicate of the login fix", owner: "a" });
    const claimed = await msg(a, "a", { op: "task.claim", task: added.seq });
    const cancelled = await msg(a, "a", { op: "task.update", task: added.seq, state: "cancelled" });
    const s = fold([added, claimed, cancelled]);
    expect(s.tasks.get(added.seq)).toMatchObject({ state: "done", owner: "a", cancelled: true });
    expect(s.tasks.get(added.seq)?.notes.map((n) => n.text)).toEqual(["cancelled"]);
    expect(s.rejected.has(cancelled.seq)).toBe(false);
    expect(describeEvent(cancelled, s)).toContain("cancelled");

    const other = await msg(a, "a", { op: "task.add", title: "still real", owner: "a" });
    const start = await msg(a, "a", { op: "task.claim", task: other.seq });
    const drop = await msg(a, "a", { op: "task.update", task: other.seq, owner: null });
    const dropped = fold([other, start, drop]);
    expect(dropped.tasks.get(other.seq)).toMatchObject({ state: "todo", owner: undefined });
  });

  test("a done task can't be claimed, and isn't anyone's load", async () => {
    const a = await member("a");
    const t1 = await msg(a, "a", { op: "task.add", title: "the duplicate", owner: "a" });
    const t2 = await msg(a, "a", { op: "task.add", title: "the real one", owner: "a" });
    const done = await msg(a, "a", { op: "task.update", task: t1.seq, state: "done" });
    const claim = await msg(a, "a", { op: "task.claim", task: t1.seq });
    const s = fold([t1, t2, done, claim]);
    expect(s.rejected.get(claim.seq)).toContain("already done");
    const load = memberLoad(s, "a");
    expect([...load.current, ...load.queued, ...load.waiting].map((t) => t.id)).toEqual([t2.seq]);
  });

  test("states on the wire: today's and older clients' are well formed, anything else isn't", () => {
    for (const state of ["todo", "doing", "review", "done", "blocked", "cancelled"]) expect(wellFormedEvent({ op: "task.update", task: 1, state })).toBe(true);
    expect(wellFormedEvent({ op: "task.update", task: 1, state: "nope" })).toBe(false);
    // What older clients also sent rides along, and is ignored.
    expect(wellFormedEvent({ op: "task.update", task: 1, after: [2] })).toBe(true);
    expect(wellFormedEvent({ op: "task.add", title: "t", needs: ["windows"], after: [1] })).toBe(true);
  });

  test("a cancelled task reads as cancelled on the board, in status and in full", async () => {
    const a = await member("a");
    const t = await msg(a, "a", { op: "task.add", title: "not needed after all" });
    const cancel = await msg(a, "a", { op: "task.update", task: t.seq, state: "cancelled" });
    const s = fold([t, cancel]);
    expect(formatTasks(s, { all: true })).toBe(`T${t.seq}   cancelled not needed after all`);
    expect(formatTask(s, s.tasks.get(t.seq)!)).toContain("state: done (cancelled)");
    expect(formatStatus({ alias: "c", me: "a", state: s, online: new Map(), unread: 0, now: T0 })).toContain("0 open, 1 done (1 cancelled)");
  });

  test("done tasks stay off the open board unless --all; the board says open", async () => {
    const a = await member("a");
    const t = await msg(a, "a", { op: "task.add", title: "drop me" });
    const open = await msg(a, "a", { op: "task.add", title: "still open" });
    const finish = await msg(a, "a", { op: "task.update", task: t.seq, state: "done" });
    const s = fold([t, open, finish]);
    expect(formatTasks(s)).toBe(`T${open.seq}   open      still open`);
    expect(formatTasks(s, { all: true })).toContain("done");
    expect(formatStatus({ alias: "c", me: "a", state: s, online: new Map(), unread: 0, now: T0 })).toContain("1 open, 1 done");
  });
});

describe("near-duplicate titles", () => {
  test("equal, contained, or mostly the same words; done titles do not warn", async () => {
    expect(titlesLookAlike("Fix the login button", "fix the login button")).toBe(true);
    expect(titlesLookAlike("Fix the login button", "fix the login button now")).toBe(true);
    expect(titlesLookAlike("Fix login", "Please fix the login flow")).toBe(true);
    expect(titlesLookAlike("Write the docs", "Fix the login button")).toBe(false);
    expect(titlesLookAlike("ui", "build the gui")).toBe(false);
    expect(titlesLookAlike("ABC-81 stage 6", "XY-53 stage 6")).toBe(false);
    expect(titlesLookAlike("ABC-81 stage 6", "ABC-82 stage 6")).toBe(false);
    expect(titlesLookAlike("ABC-6 stage 6", "ABC-53 stage 6")).toBe(false);
    expect(titlesLookAlike("ABC-81 stage 6", "XY-81 stage 6")).toBe(false);
    expect(titlesLookAlike("Fix bug 12", "Fix bug 12 and 13")).toBe(false);
    expect(titlesLookAlike("abc81 stage 6 review", "ABC-81 stage 6")).toBe(true);
    expect(titlesLookAlike("Release 1.2 stage 6", "Release 2.1 stage 6")).toBe(false);
    expect(titlesLookAlike("Release 0.20 stage 6", "Release 20.0 stage 6")).toBe(false);
    expect(titlesLookAlike("Review 2026-10-12 stage 6", "Review 2026-12-10 stage 6")).toBe(false);
    expect(titlesLookAlike("ABC-81A stage 6", "ABC-81B stage 6")).toBe(false);
    expect(titlesLookAlike("ABC-81AB stage 6", "ABC-82AB stage 6")).toBe(false);
    expect(titlesLookAlike("Release 0.20", "Release v0.20")).toBe(true);
    expect(titlesLookAlike("Deploy", "deploy the site")).toBe(false);
    expect(titlesLookAlike("ABC-81 stage 6 review", "Review ABC-81, stage 6")).toBe(true);

    const a = await member("a");
    const open = await msg(a, "a", { op: "task.add", title: "Fix the login button" });
    const done = await msg(a, "a", { op: "task.add", title: "Fix the login button" });
    const finish = await msg(a, "a", { op: "task.update", task: done.seq, state: "done" });
    const cancel = await msg(a, "a", { op: "task.add", title: "Fix the login button" });
    const cancelled = await msg(a, "a", { op: "task.update", task: cancel.seq, state: "cancelled" });
    const s = fold([open, done, finish, cancel, cancelled]);
    expect(similarOpenTasks(s, "fix the login button!").map((t: Task) => t.id)).toEqual([open.seq]);
  });
});

describe("kiwi sh empty globs", () => {
  const files = { "/channel/tasks/T2.md": "hello\n", "/channel/nope/": "" };

  test("a glob that matches nothing is named on stderr and the script still runs", async () => {
    const r = await runSh(files, "echo /channel/nope/*.md; echo after");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("after\n");
    expect(r.stderr).toBe("bash: no match: /channel/nope/*.md\n");
  });

  test("a glob that matches nothing, and nothing after it, exits nonzero", async () => {
    const r = await runSh(files, "echo /channel/nope/*.md");
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("bash: no match: /channel/nope/*.md\n");
  });

  test("a matching glob is quiet, and test, arithmetic and prefix removal are not globs", async () => {
    const hit = await runSh(files, "echo /channel/tasks/*.md");
    expect(hit).toMatchObject({ stdout: "/channel/tasks/T2.md\n", stderr: "", exitCode: 0 });
    const testCmd = await runSh(files, "[ -f x ]; echo after");
    expect(testCmd).toMatchObject({ stdout: "after\n", stderr: "", exitCode: 0 });
    const arith = await runSh(files, "echo $((2*3))");
    expect(arith).toMatchObject({ stdout: "6\n", stderr: "", exitCode: 0 });
    const trim = await runSh(files, "x=a/b; echo ${x#*/}");
    expect(trim).toMatchObject({ stdout: "b\n", stderr: "", exitCode: 0 });
  });
});
