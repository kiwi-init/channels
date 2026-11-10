import { beforeAll, describe, expect, test } from "bun:test";
import { clockOf, nudgesDue } from "@kiwi/core/clock.ts";
import { describeEvent, formatTask, formatTasks } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, wellFormed, type Event, type Kind, type Message, type NudgeStep, type Payload } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { QUEUE_MS, QUIET_MS } from "@kiwi/core/state/clocks.ts";
import type { StepSpec } from "@kiwi/core/steps.ts";

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
const A = "a".repeat(40);

function channel() {
  const log: Message[] = [];
  let time = T0;
  let still = false;
  const say = async (from: Name, kind: Kind, body: string, extra: Partial<Pick<Message, "to" | "ev" | "re" | "holds" | "task">> = {}): Promise<Message> => {
    const seq = log.length + 1;
    if (!still) time += 1_000;
    still = false;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: time, ...extra };
    const p = await sign(ids[from]!, payload);
    const m = { ...p, seq, rts: time, sigOk: await verify(p) };
    log.push(m);
    return m;
  };
  const ev = (from: Name, e: Event) => say(from, "event", "", { ev: e });
  const add = async (more: Partial<Extract<Event, { op: "task.add" }>> = {}): Promise<number> => (await ev("owl", { op: "task.add", title: "ship", ...more })).seq;
  const update = (from: Name, task: number, change: Omit<Extract<Event, { op: "task.update" }>, "op" | "task">) => ev(from, { op: "task.update", task, ...change });
  const nudge = (from: Name, task: number, mover: string, since: number, step: 1 | 2 | 3) => ev(from, { op: "task.nudge", task, mover, since, step });
  const queued = (from: Name, task: number, mover: string, since: number, day: number) => ev(from, { op: "task.nudge", task, mover, since, step: 0, day });
  return {
    log,
    say,
    ev,
    add,
    update,
    nudge,
    queued,
    wait: (ms: number) => void (time += ms),
    sameInstant: () => void (still = true),
    now: () => time,
    state: (): ChannelState => fold(log, roster, time),
  };
}

type Channel = ReturnType<typeof channel>;

async function inReview(c: Channel): Promise<{ id: number; epoch: number; since: number }> {
  const id = await c.add({ owner: "win", review: "mac" });
  const round = await c.update("win", id, { state: "review", at: A });
  return { id, epoch: round.seq, since: round.rts! };
}

const due = (c: Channel, now = c.now()) => nudgesDue(c.state(), now);
const read = (c: Channel, id: number, now = c.now()) => clockOf(c.state(), c.state().tasks.get(id)!, now);

describe("a quiet task climbs one ladder: its mover, the lead, the owner (#3930 §2)", () => {
  test("case 1: a reviewer quiet with a round open is due a wake at N, the lead at 2N, the owner at 3N", async () => {
    const c = channel();
    const { id, epoch, since } = await inReview(c);
    expect(read(c, id, since + 5_000)).toEqual({ mover: "mac", party: "mac", epoch, since, quiet: 5_000, paged: true, step: 0 });
    expect(due(c, since + N - 1)).toEqual([]);
    expect(due(c, since + N)).toEqual([{ task: id, mover: "mac", since: epoch, step: 1, to: "mac" }]);
    c.wait(N);
    await c.nudge("owl", id, "mac", epoch, 1);
    expect(due(c)).toEqual([]);
    expect(due(c, since + 2 * N)).toEqual([{ task: id, mover: "mac", since: epoch, step: 2, to: "owl" }]);
    c.wait(N);
    await c.nudge("owl", id, "mac", epoch, 2);
    expect(due(c, since + 3 * N)).toEqual([{ task: id, mover: "mac", since: epoch, step: 3, to: "jon" }]);
    c.wait(N);
    await c.nudge("jon", id, "mac", epoch, 3);
    const s = c.state();
    expect(s.rejected.size).toBe(0);
    expect(nudgesDue(s, since + 10 * N)).toEqual([]);
    expect(s.tasks.get(id)!.clock).toEqual({ key: "mac|review|1", seq: epoch, at: since, step: 3 });
  });

  test("a step posted from the mover's own seat doesn't restart its clock, and the lead is still due at 2N", async () => {
    const c = channel();
    const id = await c.add({ owner: "win" });
    const start = await c.update("win", id, { state: "doing" });
    c.wait(N);
    await c.nudge("win", id, "win", start.seq, 1);
    expect(c.state().rejected.size).toBe(0);
    expect(read(c, id)).toMatchObject({ mover: "win", epoch: start.seq, since: start.rts!, step: 1 });
    expect(due(c, start.rts! + 2 * N)).toEqual([{ task: id, mover: "win", since: start.seq, step: 2, to: "owl" }]);
  });

  test("case 4: the lead's own quiet task goes to the owner at 2N", async () => {
    const c = channel();
    const id = await c.add({ owner: "owl" });
    const start = await c.update("owl", id, { state: "doing" });
    expect(due(c, start.rts! + N)).toEqual([{ task: id, mover: "owl", since: start.seq, step: 1, to: "owl" }]);
    expect(due(c, start.rts! + 2 * N)).toEqual([{ task: id, mover: "owl", since: start.seq, step: 2, to: "jon" }]);
  });

  test("case 7: after everyone was offline past 3N, only the highest step is due", async () => {
    const c = channel();
    const { id, epoch, since } = await inReview(c);
    expect(due(c, since + 7 * N)).toEqual([{ task: id, mover: "mac", since: epoch, step: 3, to: "jon" }]);
  });

  test("case 6: the same step from two evaluators is one record, and a repeat long after is still dropped", async () => {
    const c = channel();
    const { id, epoch, since } = await inReview(c);
    c.wait(N);
    await c.nudge("owl", id, "mac", epoch, 1);
    await c.nudge("jon", id, "mac", epoch, 1);
    c.wait(40 * N);
    const filler = await c.add();
    await c.update("zed", filler, { note: "one" });
    await c.update("zed", filler, { note: "two" });
    await c.nudge("zed", id, "mac", epoch, 1);
    const s = c.state();
    expect(s.rejected.size).toBe(0);
    expect(s.tasks.get(id)!.clock).toEqual({ key: "mac|review|1", seq: epoch, at: since, step: 1 });
  });
});

describe("the fold checks a step against the task's own clock (#3930 §2)", () => {
  test("a step before its time, a made-up mover, a made-up epoch and a finished task are refused", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    c.wait(N);
    const early = await c.nudge("owl", id, "mac", epoch, 2);
    const nobody = await c.nudge("zed", id, "not-a-member", epoch, 1);
    const wrongEpoch = await c.nudge("zed", id, "mac", epoch - 1, 1);
    const done = await c.add({ owner: "win" });
    await c.update("win", done, { state: "done" });
    const late = await c.nudge("owl", done, "win", done, 1);
    const s = c.state();
    expect(s.rejected.get(early.seq)).toBe(`T${id} hasn't been quiet long enough for step 2 of its clock`);
    expect(s.rejected.get(nobody.seq)).toBe(`T${id}'s clock moved on: it is mac's since #${epoch}`);
    expect(s.rejected.get(wrongEpoch.seq)).toBe(`T${id}'s clock moved on: it is mac's since #${epoch}`);
    expect(s.rejected.get(late.seq)).toBe(`T${done} is already done`);
    expect(s.tasks.get(id)!.clock!.step).toBeUndefined();
    expect(wellFormed({ ...early, ev: { op: "task.nudge", task: id, mover: "mac", since: epoch, step: 4 } })).toBe(false);
    expect(wellFormed({ ...early, ev: { op: "task.nudge", task: id, mover: "", since: epoch, step: 1 } })).toBe(false);
    expect(wellFormed({ ...early, ev: { op: "task.nudge", task: id, mover: "mac", since: epoch, step: 0 } })).toBe(false);
    expect(wellFormed({ ...early, ev: { op: "task.nudge", task: id, mover: "mac", since: epoch, step: 1, day: 1 } })).toBe(false);
  });

  test("a step for an epoch that progress or a reassignment ended is refused", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    c.wait(N);
    const spoke = await c.say("mac", "msg", "reading it now", { task: id });
    const stale = await c.nudge("owl", id, "mac", epoch, 1);
    expect(c.state().rejected.get(stale.seq)).toBe(`T${id}'s clock moved on: it is mac's since #${spoke.seq}`);
    c.wait(N);
    const moved = await c.update("owl", id, { review: "zed" });
    const old = await c.nudge("owl", id, "mac", spoke.seq, 1);
    const s = c.state();
    expect(s.rejected.get(old.seq)).toBe(`T${id}'s clock moved on: it is zed's since #${moved.seq}`);
    expect(read(c, id)).toMatchObject({ mover: "zed", epoch: moved.seq, since: moved.rts!, step: 0 });
  });

  test("a task that waits on a person is never on the ladder, and a step for it is refused", async () => {
    const c = channel();
    const id = await c.add({ owner: "win" });
    await c.update("win", id, { state: "doing" });
    const ask = await c.say("win", "ask", "Which one?", { to: ["jon"], holds: [id] });
    expect(read(c, id)).toMatchObject({ mover: "jon", epoch: ask.seq, paged: false });
    expect(due(c, c.now() + 9 * N)).toEqual([]);
    c.wait(N);
    const refused = await c.nudge("owl", id, "jon", ask.seq, 1);
    expect(c.state().rejected.get(refused.seq)).toBe(`T${id} waits on an answer to #${ask.seq}: that is in Needs you, not on the clock`);
  });
});

describe("only the mover's own progress, or a new mover, starts a new clock (#3930 §2, case 5)", () => {
  test("CI news, an update of main, another member's note and thread message leave it; the mover's message restarts it", async () => {
    const c = channel();
    await c.ev("jon", { op: "repos.set", repos: ["o/r"] });
    const { id, epoch, since } = await inReview(c);
    c.wait(60_000);
    await c.ev("jon", { op: "github", items: [{ event: "check_run", repo: "o/r", at: c.now(), sha: A, name: "build", run: 9, status: "completed", conclusion: "success" }] } as Event);
    await c.ev("jon", { op: "github", items: [{ event: "push", repo: "o/r", at: c.now(), branch: "main", sha: "b".repeat(40) }] } as Event);
    await c.update("zed", id, { note: "watching this one" });
    await c.say("zed", "msg", "any news?", { task: id });
    expect(c.state().rejected.size).toBe(0);
    expect(read(c, id)).toMatchObject({ mover: "mac", epoch, since });
    c.wait(60_000);
    const spoke = await c.say("mac", "msg", "reading it now", { task: id });
    expect(read(c, id)).toMatchObject({ mover: "mac", epoch: spoke.seq, since: spoke.rts! });
    expect(due(c, since + N)).toEqual([]);
  });

  test("two messages from the mover at the same instant are two epochs", async () => {
    const c = channel();
    const { id } = await inReview(c);
    const first = await c.say("mac", "msg", "one", { task: id });
    c.sameInstant();
    const second = await c.say("mac", "msg", "two", { task: id });
    expect(second.rts).toBe(first.rts);
    expect(read(c, id)).toMatchObject({ epoch: second.seq, since: first.rts! });
    c.wait(N);
    const stale = await c.nudge("owl", id, "mac", first.seq, 1);
    const good = await c.nudge("owl", id, "mac", second.seq, 1);
    const s = c.state();
    expect(s.rejected.has(stale.seq)).toBe(true);
    expect(s.rejected.has(good.seq)).toBe(false);
  });

  test("a question hands the move over and its answer hands it back with a fresh clock; a late reply to the settled question changes nothing", async () => {
    const c = channel();
    const id = await c.add({ owner: "win" });
    await c.update("win", id, { state: "doing" });
    c.wait(5 * N);
    const ask = await c.say("win", "ask", "Which one?", { to: ["jon"], holds: [id] });
    expect(read(c, id)).toMatchObject({ mover: "jon", epoch: ask.seq, since: ask.rts!, paged: false });
    c.wait(2 * N);
    const answer = await c.say("jon", "msg", "the first", { re: [ask.seq] });
    expect(read(c, id)).toEqual({ mover: "win", party: "win", epoch: answer.seq, since: answer.rts!, quiet: 0, paged: true, step: 0 });
    c.wait(2 * N);
    await c.say("zed", "msg", "noted", { re: [ask.seq] });
    expect(read(c, id)).toMatchObject({ mover: "win", epoch: answer.seq, since: answer.rts! });
    expect(due(c)).toEqual([{ task: id, mover: "win", since: answer.seq, step: 2, to: "owl" }]);
  });
});

describe("a landing step's clock starts when the move reaches a member (#3930 §2 and §3)", () => {
  const HOUR = 3_600_000;
  async function landing(c: Channel, steps: StepSpec[]): Promise<number> {
    const id = await c.add({ owner: "win", review: "mac", steps });
    await c.update("win", id, { state: "review", at: A });
    await c.update("mac", id, { state: "done", verdict: "approved", round: 1, at: A });
    return id;
  }
  const runEvent = (c: Channel, run: number, title: string, conclusion?: string) =>
    c.ev("jon", {
      op: "github",
      items: [{ event: "workflow_run", repo: "o/r", at: c.now(), action: conclusion ? "completed" : "in_progress", run, title, started: c.now(), ...(conclusion ? { conclusion } : {}) }],
    } as Event);

  test("a run that fails before its deadline starts the named member's clock at the failure, not at the approval", async () => {
    const c = channel();
    await c.ev("jon", { op: "repos.set", repos: ["o/r"] });
    await runEvent(c, 1, "warm-up", "success");
    const id = await landing(c, [{ words: "prd pipeline", by: "zed", run: { id: "deploy-7", expected: 10 * HOUR } }]);
    expect(read(c, id)).toBeUndefined();
    c.wait(4 * N);
    await runEvent(c, 70, "deploy-7");
    const failed = await runEvent(c, 70, "deploy-7", "failure");
    expect(read(c, id)).toEqual({ mover: "zed", party: "zed", epoch: failed.seq, since: failed.rts!, quiet: 0, paged: true, step: 0 });
    expect(due(c)).toEqual([]);
    expect(due(c, failed.rts! + N)).toEqual([{ task: id, mover: "zed", since: failed.seq, step: 1, to: "zed" }]);
  });

  test("a wait that ends starts the clock at its deadline, with no event, and the fold reads it the same way", async () => {
    const c = channel();
    const id = await landing(c, [{ words: "soak", by: "zed", wait: { reason: "soak", ms: HOUR } }]);
    const armed = c.state().tasks.get(id)!.clock!;
    const until = c.state().tasks.get(id)!.steps![0]!.wait!.until!;
    expect(read(c, id, until - 1)).toBeUndefined();
    expect(read(c, id, until + 5_000)).toEqual({ mover: "zed", party: "zed", epoch: armed.seq, since: until, quiet: 5_000, paged: true, step: 0 });
    c.wait(HOUR + N);
    const step = await c.nudge("owl", id, "zed", armed.seq, 1);
    expect(c.state().rejected.has(step.seq)).toBe(false);
    expect(c.state().tasks.get(id)!.clock).toMatchObject({ key: "zed|land|s1|", seq: armed.seq, at: until, step: 1 });
  });

  test("giving a step to someone else starts their clock", async () => {
    const c = channel();
    const id = await landing(c, [{ words: "cut the release", by: "zed" }]);
    expect(read(c, id)!.mover).toBe("zed");
    c.wait(N);
    const moved = await c.ev("owl", { op: "task.steps", task: id, edit: { kind: "by", id: "s1", by: "mac" } });
    expect(c.state().rejected.size).toBe(0);
    expect(read(c, id)).toEqual({ mover: "mac", party: "mac", epoch: moved.seq, since: moved.rts!, quiet: 0, paged: true, step: 0 });
  });
});

describe("queued work is never paged, and a long wait is due to the lead once a day (#3930 §2, case 3)", () => {
  test("three planned tasks behind one in progress page nobody; after a day one line is due for the oldest", async () => {
    const c = channel();
    const doing = await c.add({ owner: "win" });
    await c.update("win", doing, { state: "doing" });
    const first = await c.add({ owner: "win" });
    await c.add({ owner: "win" });
    await c.add({ owner: "win" });
    const waiting = c.state().tasks.get(first)!.clock!;
    expect(waiting).toEqual({ key: "~waiting|win", seq: first, at: waiting.at });
    await c.say("win", "msg", "still on it", { task: doing });
    expect(due(c, c.now() + N - 1)).toEqual([]);
    const lines = (now: number) => nudgesDue(c.state(), now).filter((d) => d.step === 0);
    expect(lines(waiting.at + QUEUE_MS)).toEqual([{ task: first, mover: "win", since: first, step: 0, day: 1, to: "owl" }]);
    c.wait(QUEUE_MS + 5_000);
    const noted = await c.queued("owl", first, "win", first, 1);
    const again = await c.queued("jon", first, "win", first, 1);
    const early = await c.queued("owl", first, "win", first, 2);
    const notQueued = await c.queued("owl", doing, "win", c.state().tasks.get(doing)!.clock!.seq, 1);
    const s = c.state();
    expect(s.rejected.has(noted.seq)).toBe(false);
    expect(s.rejected.has(again.seq)).toBe(false);
    expect(s.rejected.get(early.seq)).toBe(`T${first} hasn't waited that long in its queue`);
    expect(s.rejected.get(notQueued.seq)).toBe(`T${doing} isn't waiting in a queue`);
    expect(s.tasks.get(first)!.clock!.day).toBe(1);
    expect(lines(c.now())).toEqual([]);
    expect(lines(waiting.at + 2 * QUEUE_MS)).toEqual([{ task: first, mover: "win", since: first, step: 0, day: 2, to: "owl" }]);
  });
});

describe("a fold from a snapshot reads the same clocks as one fold of the whole log", () => {
  test("clocks, recorded steps and what is due match at every cut", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const held = await c.add({ owner: "win" });
    await c.update("win", held, { state: "doing" });
    const ask = await c.say("win", "ask", "Which one?", { to: ["jon"], holds: [held] });
    c.wait(N);
    await c.nudge("owl", id, "mac", epoch, 1);
    await c.say("jon", "msg", "the first", { re: [ask.seq] });
    c.wait(2 * N);
    await c.say("zed", "msg", "noted", { re: [ask.seq] });
    await c.nudge("zed", id, "not-a-member", epoch, 2);
    await c.nudge("owl", id, "mac", epoch, 2);
    const now = c.now();
    const whole = fold(c.log, roster, now);
    const clocks = (s: ChannelState) => [...s.tasks.values()].map((t) => [t.id, t.clock]);
    const baseAt = (cut: number): FoldBase => {
      const made: FoldBase[] = [];
      fold(c.log.slice(0, cut), roster, now, null, null, null, (b) => void made.push(b));
      return made.at(-1)!;
    };
    for (const cut of [2, 4, 6, 7, 8, 9]) {
      const resumed = fold(c.log.slice(cut), roster, now, null, null, baseAt(cut));
      expect(clocks(resumed)).toEqual(clocks(whole));
      expect(nudgesDue(resumed, now + N)).toEqual(nudgesDue(whole, now + N));
    }
    expect(whole.tasks.get(id)!.clock!.step).toBe(2);
  });
});

describe("the board and the task page say when a task is quiet, and the words only say what is due", () => {
  test("a quiet line on the task, a tag on its row, and plain words for each step", async () => {
    const c = channel();
    const { id, epoch, since } = await inReview(c);
    c.wait(2 * N);
    const due1 = await c.nudge("owl", id, "mac", epoch, 1);
    const s = c.state();
    const at = since + 2 * N + 60_000;
    expect(formatTask(s, s.tasks.get(id)!, at).split("\n")).toContain("  quiet 41m with mac (a wake is due)");
    const row = (rows: string) => rows.split("\n").find((r) => r.trimStart().startsWith(`T${id} `));
    expect(row(formatTasks(s, "kiwi", { now: at }))).toEndWith(" · move: mac to review it · quiet 41m with mac (a wake is due)");
    expect(row(formatTasks(s, "kiwi"))).toEndWith(" · move: mac to review it");
    const words = (step: NudgeStep) =>
      describeEvent({ ...due1, ev: step === 0 ? { op: "task.nudge", task: id, mover: "mac", since: epoch, step, day: 1 } : { op: "task.nudge", task: id, mover: "mac", since: epoch, step } }, s);
    expect(([0, 1, 2, 3] as const).map(words)).toEqual([
      `noted that T${id} “ship” has waited a day in mac's queue`,
      `marked T${id} “ship” quiet with mac: a wake is due`,
      `marked T${id} “ship” still quiet with mac: due to the lead`,
      `marked T${id} “ship” still quiet with mac: due in the owner's Needs you`,
    ]);
  });
});

describe("round 2: the lead's own progress counts, and only an agent's queue gives a daily line (#3930 §2)", () => {
  test("a review open to anyone is the lead's to route: the lead's message in its thread starts a new clock, another member's doesn't", async () => {
    const c = channel();
    const id = await c.add({ owner: "win", review: "*" });
    const round = await c.update("win", id, { state: "review", at: A });
    expect(read(c, id)).toMatchObject({ mover: "owl", party: "@lead", epoch: round.seq, since: round.rts! });
    c.wait(2 * N);
    await c.say("zed", "msg", "who takes this?", { task: id });
    expect(read(c, id)).toMatchObject({ mover: "owl", epoch: round.seq, since: round.rts! });
    const spoke = await c.say("owl", "msg", "routing it now", { task: id });
    expect(read(c, id)).toEqual({ mover: "owl", party: "@lead", epoch: spoke.seq, since: spoke.rts!, quiet: 0, paged: true, step: 0 });
    expect(due(c)).toEqual([]);
    expect(due(c, spoke.rts! + N)).toEqual([{ task: id, mover: "@lead", since: spoke.seq, step: 1, to: "owl" }]);
    c.wait(N);
    const stale = await c.nudge("jon", id, "@lead", round.seq - 1, 1);
    const good = await c.nudge("jon", id, "@lead", spoke.seq, 1);
    const s = c.state();
    expect(s.rejected.has(stale.seq)).toBe(true);
    expect(s.rejected.has(good.seq)).toBe(false);
    expect(read(c, id)).toMatchObject({ mover: "owl", epoch: spoke.seq, since: spoke.rts!, step: 1 });
    expect(due(c, spoke.rts! + 2 * N)).toEqual([{ task: id, mover: "@lead", since: spoke.seq, step: 2, to: "jon" }]);
  });

  test("a task with no owner is the lead's to give out: the lead's note on it starts a new clock", async () => {
    const c = channel();
    const id = await c.add();
    const created = c.state().tasks.get(id)!.createdAt;
    expect(read(c, id)).toMatchObject({ mover: "owl", party: "@lead", epoch: id, since: created });
    c.wait(2 * N);
    const noted = await c.update("owl", id, { note: "looking for an owner" });
    expect(read(c, id)).toMatchObject({ mover: "owl", party: "@lead", epoch: noted.seq, since: noted.rts!, step: 0 });
    expect(due(c)).toEqual([]);
  });

  test("the lead's progress survives a snapshot", async () => {
    const c = channel();
    const id = await c.add({ owner: "win", review: "*" });
    await c.update("win", id, { state: "review", at: A });
    c.wait(2 * N);
    await c.say("owl", "msg", "routing it now", { task: id });
    await c.say("zed", "msg", "ok", { task: id });
    const now = c.now();
    const whole = fold(c.log, roster, now);
    const baseAt = (cut: number): FoldBase => {
      const made: FoldBase[] = [];
      fold(c.log.slice(0, cut), roster, now, null, null, null, (b) => void made.push(b));
      return made.at(-1)!;
    };
    for (const cut of [2, 3, 4]) {
      const resumed = fold(c.log.slice(cut), roster, now, null, null, baseAt(cut));
      expect(resumed.tasks.get(id)!.clock).toEqual(whole.tasks.get(id)!.clock);
      expect(clockOf(resumed, resumed.tasks.get(id)!, now)).toEqual(clockOf(whole, whole.tasks.get(id)!, now));
    }
  });

  test("a person's queue, and the queue of an agent who left, give no daily line, and one posted for them is refused", async () => {
    const c = channel();
    const doing = await c.add({ owner: "jon" });
    await c.update("jon", doing, { state: "doing" });
    const planned = await c.add({ owner: "jon" });
    const agents = await c.add({ owner: "win" });
    await c.update("win", agents, { state: "doing" });
    const queued = await c.add({ owner: "win" });
    c.wait(2 * QUEUE_MS + 5_000);
    const lines = (s: ChannelState) => nudgesDue(s, c.now()).filter((d) => d.step === 0);
    expect(lines(c.state())).toEqual([{ task: queued, mover: "win", since: queued, step: 0, day: 2, to: "owl" }]);
    const gone = roster.map((m) => (m.name === "win" ? { ...m, active: false } : m));
    expect(lines(fold(c.log, gone, c.now()))).toEqual([]);
    const forPerson = await c.queued("owl", planned, "jon", planned, 1);
    expect(c.state().rejected.get(forPerson.seq)).toBe(`T${planned} isn't in an agent's queue: jon is a person, or has left`);
    const forAgent = await c.queued("owl", queued, "win", queued, 1);
    expect(c.state().rejected.has(forAgent.seq)).toBe(false);
    expect(fold(c.log, gone, c.now()).rejected.get(forAgent.seq)).toBe(`T${queued} isn't in an agent's queue: win is a person, or has left`);
  });
});
