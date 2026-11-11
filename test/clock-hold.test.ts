import { beforeAll, describe, expect, test } from "bun:test";
import { clockOf, nudgesDue } from "@kiwi/core/clock.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { moverOf, moverText } from "@kiwi/core/mover.ts";
import { PROTOCOL_VERSION, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { QUIET_MS } from "@kiwi/core/state/clocks.ts";
import type { StepEdit, StepSpec } from "@kiwi/core/steps.ts";

const NAMES = ["jon", "owl", "win", "mac", "zed"] as const;
type Name = (typeof NAMES)[number];
const ids: Record<string, Identity> = {};
let roster: Roster;
beforeAll(async () => {
  for (const n of NAMES) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "owl", pk: ids.owl!.pk, owner: false, at: 1, active: true, kind: "agent", role: "lead" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 3, active: true, kind: "agent" },
    { name: "zed", pk: ids.zed!.pk, owner: false, at: 4, active: true, kind: "agent" },
  ];
});

const T0 = 1_760_000_000_000;
const N = QUIET_MS;
const HOUR = 3_600_000;
const A = "a".repeat(40);

function channel() {
  const log: Message[] = [];
  let time = T0;
  const say = async (from: Name, kind: Kind, body: string, extra: Partial<Pick<Message, "to" | "ev" | "re" | "holds" | "task" | "choices" | "esc">> = {}): Promise<Message> => {
    const seq = log.length + 1;
    time += 1_000;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: time, ...extra };
    const p = await sign(ids[from]!, payload);
    const m = { ...p, seq, rts: time, sigOk: await verify(p) };
    log.push(m);
    return m;
  };
  const ev = (from: Name, e: Event) => say(from, "event", "", { ev: e });
  return {
    log,
    say,
    ev,
    steps: (task: number, edit: StepEdit) => ev("owl", { op: "task.steps", task, edit }),
    run: (run: number, title: string, conclusion?: string) =>
      ev("jon", {
        op: "github",
        items: [{ event: "workflow_run", repo: "o/r", at: time, action: conclusion ? "completed" : "in_progress", run, title, started: time, ...(conclusion ? { conclusion } : {}) }],
      } as Event),
    wait: (ms: number) => void (time += ms),
    now: () => time,
    state: (): ChannelState => fold(log, roster, time),
  };
}

type Channel = ReturnType<typeof channel>;

async function doing(c: Channel, steps?: StepSpec[]): Promise<number> {
  const id = (await c.ev("owl", { op: "task.add", title: "cut over", owner: "win", review: "mac", ...(steps ? { steps } : {}) })).seq;
  await c.ev("win", { op: "task.update", task: id, state: "doing" });
  return id;
}

async function withRepos(c: Channel): Promise<void> {
  await c.ev("jon", { op: "repos.set", repos: ["o/r"] });
  await c.run(1, "warm-up", "success");
}

async function approve(c: Channel, id: number): Promise<Message> {
  await c.ev("win", { op: "task.update", task: id, state: "review", at: A });
  return c.ev("mac", { op: "task.update", task: id, state: "done", verdict: "approved", round: 1, at: A });
}

const task = (c: Channel, id: number) => c.state().tasks.get(id)!;
const read = (c: Channel, id: number, now = c.now()) => clockOf(c.state(), task(c, id), now);
const mover = (c: Channel, id: number, now = c.now()) => moverOf(c.state(), task(c, id), now);
const due = (c: Channel, now = c.now()) => nudgesDue(c.state(), now);
const nudge = (c: Channel, from: Name, id: number, since: number, step: 1 | 2 | 3) => c.ev(from, { op: "task.nudge", task: id, mover: "win", since, step });

function replays(c: Channel, now: number): void {
  const whole = fold(c.log, roster, now);
  const clocks = (s: ChannelState) => [...s.tasks.values()].map((t) => [t.id, t.clock]);
  for (let cut = 2; cut < c.log.length; cut++) {
    const made: FoldBase[] = [];
    fold(c.log.slice(0, cut), roster, now, null, null, null, (b) => void made.push(b));
    const resumed = fold(c.log.slice(cut), roster, now, null, null, made.at(-1)!);
    expect(clocks(resumed)).toEqual(clocks(whole));
    expect(nudgesDue(resumed, now + N)).toEqual(nudgesDue(whole, now + N));
  }
}

describe("a wait set before approval pauses the quiet clock (#5954)", () => {
  test("on a doing task, a wait set on its first step pauses the clock and drops the owner's card; the board says why and until when", async () => {
    const c = channel();
    const id = await doing(c);
    c.wait(3 * N);
    await c.steps(id, { kind: "add", step: { words: "change window", by: "zed" } });
    expect(due(c).map((d) => [d.task, d.step])).toEqual([[id, 3]]);
    const wait = await c.steps(id, { kind: "wait", id: "s1", reason: "runs sit at the PRD approval", ms: 3 * HOUR });
    const until = wait.rts! + 3 * HOUR;
    expect(c.state().rejected.size).toBe(0);
    expect(task(c, id).clock).toMatchObject({ key: "~none", seq: wait.seq });
    expect(read(c, id)).toBeUndefined();
    expect(due(c)).toEqual([]);
    expect(due(c, until - 1)).toEqual([]);
    const m = mover(c, id)!;
    expect(m).toEqual({ kind: "hold", step: "s1 “change window”", until, left: 3 * HOUR, reason: "runs sit at the PRD approval" });
    expect(moverText(m)).toBe("nobody for 3h: step s1 “change window” waits (runs sit at the PRD approval)");
  });

  test("when the wait runs out, the owner's clock starts at its end with no event, the step stays open, and a replay reads the same", async () => {
    const c = channel();
    const id = await doing(c);
    await c.steps(id, { kind: "add", step: { words: "change window", by: "zed" } });
    const wait = await c.steps(id, { kind: "wait", id: "s1", reason: "window at 23:00", ms: HOUR });
    const until = wait.rts! + HOUR;
    expect(read(c, id, until + 5_000)).toEqual({ mover: "win", party: "win", epoch: wait.seq, since: until, quiet: 5_000, paged: true, step: 0 });
    expect(due(c, until + N)).toEqual([{ task: id, mover: "win", since: wait.seq, step: 1, to: "win" }]);
    c.wait(HOUR + 10_000);
    await c.say("jon", "msg", "morning");
    expect(task(c, id).clock).toMatchObject({ key: "win|work|", seq: wait.seq, at: until });
    expect(task(c, id).steps![0]!.progress).toEqual({ kind: "open" });
    replays(c, c.now());
  });

  test("a run pauses while it runs; a failure resumes the owner at the failure, and a success at the sync, which ends the step on approval", async () => {
    const c = channel();
    await withRepos(c);
    const id = await doing(c);
    await c.steps(id, { kind: "add", step: { words: "prd pipeline", by: "zed" } });
    const armed = await c.steps(id, { kind: "run", id: "s1", run: "deploy-7", expected: HOUR });
    expect(mover(c, id)).toMatchObject({ kind: "run", behind: "zed", due: armed.rts! + HOUR });
    await c.run(70, "deploy-7");
    expect(mover(c, id)).toMatchObject({ kind: "run" });
    c.wait(10 * 60_000);
    const failed = await c.run(70, "deploy-7", "failure");
    expect(read(c, id)).toEqual({ mover: "win", party: "win", epoch: failed.seq, since: failed.rts!, quiet: 0, paged: true, step: 0 });

    const ok = channel();
    await withRepos(ok);
    const t = await doing(ok);
    await ok.steps(t, { kind: "add", step: { words: "prd pipeline", by: "zed" } });
    await ok.steps(t, { kind: "run", id: "s1", run: "deploy-8", expected: HOUR });
    await ok.run(80, "deploy-8");
    const passed = await ok.run(80, "deploy-8", "success");
    expect(read(ok, t)).toMatchObject({ mover: "win", epoch: passed.seq, since: passed.rts! });
    await ok.ev("jon", { op: "task.landed", task: t, step: "s1", artifact: { kind: "run", id: "deploy-8" } });
    expect(task(ok, t).steps![0]!.progress).toMatchObject({ kind: "open", seen: { saw: "run deploy-8" } });
    await approve(ok, t);
    expect(task(ok, t).state).toBe("done");
    replays(ok, ok.now());
  });

  test("a run that never shows resumes the owner at its deadline, and one Kiwi can't see doesn't pause at all", async () => {
    const c = channel();
    await withRepos(c);
    const id = await doing(c);
    await c.steps(id, { kind: "add", step: { words: "prd pipeline", by: "zed" } });
    const armed = await c.steps(id, { kind: "run", id: "s1", run: "deploy-7", expected: HOUR });
    expect(read(c, id, armed.rts! + HOUR - 1)).toBeUndefined();
    expect(read(c, id, armed.rts! + HOUR + 5_000)).toMatchObject({ mover: "win", since: armed.rts! + HOUR, quiet: 5_000 });

    const blind = channel();
    const t = await doing(blind);
    await blind.steps(t, { kind: "add", step: { words: "prd pipeline", by: "zed" } });
    await blind.steps(t, { kind: "run", id: "s1", run: "deploy-7", expected: HOUR });
    expect(mover(blind, t)).toMatchObject({ kind: "member", name: "win" });
  });

  test("a wait on a question ends early on its first option only, and an answered step with no wait doesn't pause", async () => {
    const c = channel();
    const ask = await c.say("owl", "blocking", "Cut over tonight?", { to: ["jon"], esc: true, choices: ["A: go", "B: hold"] });
    const id = await doing(c);
    await c.steps(id, { kind: "add", step: { words: "owner says go", by: "jon", detector: { kind: "answered", ask: ask.seq } } });
    expect(mover(c, id)).toMatchObject({ kind: "member", name: "win" });
    await c.steps(id, { kind: "wait", id: "s1", reason: "the owner decides by 22:00", ms: 3 * HOUR });
    await c.say("jon", "msg", "B: hold", { re: [ask.seq] });
    expect(mover(c, id)).toMatchObject({ kind: "hold" });
    const go = await c.say("jon", "msg", "A: go", { re: [ask.seq] });
    expect(read(c, id)).toMatchObject({ mover: "win", epoch: go.seq, since: go.rts! });
    expect(task(c, id).steps![0]!.progress).toMatchObject({ kind: "open", seen: { saw: "#" + ask.seq + " answered “A: go”" } });
    replays(c, c.now());
  });

  test("a step with a wait and a run pauses through the wait even if the run failed, then while the run is still in time", async () => {
    const c = channel();
    await withRepos(c);
    const id = await doing(c);
    await c.steps(id, { kind: "add", step: { words: "prd pipeline", by: "zed" } });
    await c.steps(id, { kind: "run", id: "s1", run: "deploy-7", expected: 5 * HOUR });
    const wait = await c.steps(id, { kind: "wait", id: "s1", reason: "change freeze", ms: HOUR });
    const until = wait.rts! + HOUR;
    await c.run(70, "deploy-7");
    await c.run(70, "deploy-7", "failure");
    expect(mover(c, id)).toMatchObject({ kind: "hold", until });
    expect(read(c, id, until + 5_000)).toMatchObject({ mover: "win", since: until });
    c.wait(HOUR + 5_000);
    await c.say("jon", "msg", "later");
    expect(task(c, id).clock).toMatchObject({ key: "win|work|", at: until });

    const running = channel();
    await withRepos(running);
    const t = await doing(running);
    await running.steps(t, { kind: "add", step: { words: "prd pipeline", by: "zed" } });
    const run = await running.steps(t, { kind: "run", id: "s1", run: "deploy-9", expected: 5 * HOUR });
    const held = await running.steps(t, { kind: "wait", id: "s1", reason: "change freeze", ms: HOUR });
    await running.run(90, "deploy-9");
    expect(mover(running, t, held.rts! + HOUR + 1_000)).toMatchObject({ kind: "run", due: run.rts! + 5 * HOUR });
    replays(running, running.now());
  });

  test("a step whose run already succeeded starts no pause and leaves the clock as it was", async () => {
    const c = channel();
    await withRepos(c);
    const id = await doing(c);
    await c.run(70, "deploy-7");
    await c.run(70, "deploy-7", "success");
    await c.steps(id, { kind: "add", step: { words: "prd pipeline", by: "zed" } });
    const before = task(c, id).clock;
    await c.steps(id, { kind: "run", id: "s1", run: "deploy-7", expected: HOUR });
    expect(task(c, id).clock).toEqual(before);
    expect(mover(c, id)).toMatchObject({ kind: "member", name: "win" });
    replays(c, c.now());
  });

  test("setting the wait again restarts it; skipping the step or moving another ahead ends the pause at that message", async () => {
    const c = channel();
    const id = await doing(c);
    await c.steps(id, { kind: "add", step: { words: "change window", by: "zed" } });
    await c.steps(id, { kind: "wait", id: "s1", reason: "window", ms: HOUR });
    c.wait(30 * 60_000);
    const again = await c.steps(id, { kind: "wait", id: "s1", reason: "window moved", ms: HOUR });
    expect(mover(c, id)).toMatchObject({ kind: "hold", until: again.rts! + HOUR, reason: "window moved" });
    const skip = await c.steps(id, { kind: "skip", id: "s1", why: "window cancelled" });
    expect(read(c, id)).toMatchObject({ mover: "win", epoch: skip.seq, since: skip.rts! });

    const moved = channel();
    const t = await doing(moved);
    await moved.steps(t, { kind: "add", step: { words: "change window", by: "zed" } });
    await moved.steps(t, { kind: "wait", id: "s1", reason: "window", ms: HOUR });
    await moved.steps(t, { kind: "add", step: { words: "announce", by: "zed" } });
    const ahead = await moved.steps(t, { kind: "move", id: "s2", before: "s1" });
    expect(read(moved, t)).toMatchObject({ mover: "win", epoch: ahead.seq, since: ahead.rts! });
    replays(moved, moved.now());
  });

  test("approval ends the pause and landing arms the step from approval as today; a seeded first step never pauses before approval", async () => {
    const c = channel();
    const id = await doing(c);
    await c.steps(id, { kind: "add", step: { words: "soak", by: "zed" } });
    await c.steps(id, { kind: "wait", id: "s1", reason: "soak", ms: HOUR });
    c.wait(30 * 60_000);
    const approved = await approve(c, id);
    expect(task(c, id).state).toBe("landing");
    expect(task(c, id).steps![0]!.wait!.until).toBe(approved.rts! + HOUR);
    expect(mover(c, id)).toMatchObject({ kind: "hold", until: approved.rts! + HOUR });

    const seeded = channel();
    await withRepos(seeded);
    const t = await doing(seeded, [{ words: "prd pipeline", by: "zed", run: { id: "deploy-7", expected: HOUR } }]);
    expect(mover(seeded, t)).toMatchObject({ kind: "member", name: "win" });
    expect(task(seeded, t).steps![0]!.run!.due).toBeUndefined();
  });

  test("a nudge for the clock before the pause is refused, while paused and after it ends; the new epoch's nudge lands", async () => {
    const c = channel();
    const id = await doing(c);
    const before = task(c, id).clock!.seq;
    await c.steps(id, { kind: "add", step: { words: "change window", by: "zed" } });
    const wait = await c.steps(id, { kind: "wait", id: "s1", reason: "window", ms: HOUR });
    c.wait(N);
    const paused = await nudge(c, "win", id, before, 1);
    const pausedNow = await nudge(c, "win", id, wait.seq, 1);
    c.wait(HOUR + N);
    const stale = await nudge(c, "win", id, before, 1);
    const fresh = await nudge(c, "win", id, wait.seq, 1);
    const s = c.state();
    expect(s.rejected.get(paused.seq)).toContain("clock moved on");
    expect(s.rejected.get(pausedNow.seq)).toContain("clock moved on");
    expect(s.rejected.get(stale.seq)).toContain("clock moved on");
    expect(s.rejected.has(fresh.seq)).toBe(false);
    replays(c, c.now());
  });
});
