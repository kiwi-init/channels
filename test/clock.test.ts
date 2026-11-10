import { beforeAll, describe, expect, test } from "bun:test";
import { clockOf, nudgesDue } from "@kiwi/core/clock.ts";
import { describeEvent, formatTask, formatTasks } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, wellFormed, type Event, type Kind, type Message, type NudgeStep, type Payload } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts";
import { QUEUE_MS, QUIET_MS } from "@kiwi/core/state/nudges.ts";

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
  const say = async (from: Name, kind: Kind, body: string, extra: Partial<Pick<Message, "to" | "ev" | "re" | "holds" | "task">> = {}): Promise<Message> => {
    const seq = log.length + 1;
    time += 1_000;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: time, ...extra };
    const p = await sign(ids[from]!, payload);
    const m = { ...p, seq, rts: time, sigOk: await verify(p) };
    log.push(m);
    return m;
  };
  const ev = (from: Name, e: Event) => say(from, "event", "", { ev: e });
  const add = async (more: Partial<Extract<Event, { op: "task.add" }>> = {}): Promise<number> => (await ev("owl", { op: "task.add", title: "ship", ...more })).seq;
  const update = (from: Name, task: number, change: Omit<Extract<Event, { op: "task.update" }>, "op" | "task">) => ev(from, { op: "task.update", task, ...change });
  const nudge = (from: Name, task: number, mover: string, since: number, step: NudgeStep) => ev(from, { op: "task.nudge", task, mover, since, step });
  return {
    say,
    ev,
    add,
    update,
    nudge,
    wait: (ms: number) => void (time += ms),
    now: () => time,
    state: (): ChannelState => fold(log, roster, time),
  };
}

async function inReview(c: ReturnType<typeof channel>): Promise<{ id: number; since: number }> {
  const id = await c.add({ owner: "win", review: "mac" });
  await c.update("win", id, { state: "review", at: A });
  return { id, since: c.now() };
}

const due = (c: ReturnType<typeof channel>, now = c.now()) => nudgesDue(c.state(), now);

describe("a quiet task climbs one ladder: its mover, the lead, the owner (#3930 §2)", () => {
  test("case 1: a reviewer quiet with a round open is woken at N, the lead is told at 2N, the owner at 3N", async () => {
    const c = channel();
    const { id, since } = await inReview(c);
    expect(clockOf(c.state(), c.state().tasks.get(id)!, since + 5_000)).toEqual({ mover: "mac", since, quiet: 5_000, paged: true });
    expect(due(c, since + N - 1)).toEqual([]);
    expect(due(c, since + N)).toEqual([{ task: id, mover: "mac", since, step: 1, to: "mac" }]);
    c.wait(N);
    await c.nudge("owl", id, "mac", since, 1);
    expect(due(c)).toEqual([]);
    expect(due(c, since + 2 * N)).toEqual([{ task: id, mover: "mac", since, step: 2, to: "owl" }]);
    c.wait(N);
    await c.nudge("owl", id, "mac", since, 2);
    expect(due(c, since + 3 * N)).toEqual([{ task: id, mover: "mac", since, step: 3, to: "jon" }]);
    c.wait(N);
    await c.nudge("jon", id, "mac", since, 3);
    const s = c.state();
    expect(s.rejected.size).toBe(0);
    expect(nudgesDue(s, since + 10 * N)).toEqual([]);
    expect(s.tasks.get(id)!.nudged!.map((n) => [n.step, n.by])).toEqual([
      [1, "owl"],
      [2, "owl"],
      [3, "jon"],
    ]);
  });

  test("case 4: the lead's own quiet task goes to the owner at 2N", async () => {
    const c = channel();
    const id = await c.add({ owner: "owl" });
    await c.update("owl", id, { state: "doing" });
    const since = c.now();
    expect(due(c, since + N)).toEqual([{ task: id, mover: "owl", since, step: 1, to: "owl" }]);
    expect(due(c, since + 2 * N)).toEqual([{ task: id, mover: "owl", since, step: 2, to: "jon" }]);
  });

  test("case 7: after everyone was offline past 3N, only the highest step is due", async () => {
    const c = channel();
    const { id, since } = await inReview(c);
    expect(due(c, since + 7 * N)).toEqual([{ task: id, mover: "mac", since, step: 3, to: "jon" }]);
  });

  test("case 6: two evaluators post the same step: the fold keeps the first, and neither is refused", async () => {
    const c = channel();
    const { id, since } = await inReview(c);
    c.wait(N);
    const first = await c.nudge("owl", id, "mac", since, 1);
    await c.nudge("jon", id, "mac", since, 1);
    const s = c.state();
    expect(s.rejected.size).toBe(0);
    expect(s.tasks.get(id)!.nudged).toEqual([{ mover: "mac", since, step: 1, seq: first.seq, by: "owl", at: first.rts! }]);
  });

  test("a step posted before its time, a clock from the future and a finished task are refused", async () => {
    const c = channel();
    const { id, since } = await inReview(c);
    c.wait(N);
    const early = await c.nudge("owl", id, "mac", since, 2);
    const ahead = await c.nudge("owl", id, "mac", c.now() + 60_000, 1);
    const done = await c.add({ owner: "win" });
    await c.update("win", done, { state: "done" });
    const late = await c.nudge("owl", done, "win", since, 1);
    const s = c.state();
    expect(s.rejected.get(early.seq)).toBe(`T${id} hasn't been quiet long enough for step 2 of its clock`);
    expect(s.rejected.get(ahead.seq)).toBe(`T${id}'s clock can't start after the event that reads it`);
    expect(s.rejected.get(late.seq)).toBe(`T${done} is already done`);
    expect(wellFormed({ ...early, ev: { op: "task.nudge", task: id, mover: "mac", since, step: 4 } })).toBe(false);
    expect(wellFormed({ ...early, ev: { op: "task.nudge", task: id, mover: "", since, step: 1 } })).toBe(false);
  });
});

describe("only the mover's own progress resets the clock (#3930 §2, case 5)", () => {
  test("CI news, an update of main, another member's note and thread message leave it; the mover's message restarts it", async () => {
    const c = channel();
    await c.ev("jon", { op: "repos.set", repos: ["o/r"] });
    const { id, since } = await inReview(c);
    const read = () => clockOf(c.state(), c.state().tasks.get(id)!, c.now())!.since;
    c.wait(60_000);
    await c.ev("jon", { op: "github", items: [{ event: "check_run", repo: "o/r", at: c.now(), sha: A, name: "build", run: 9, status: "completed", conclusion: "success" }] } as Event);
    await c.ev("jon", { op: "github", items: [{ event: "push", repo: "o/r", at: c.now(), branch: "main", sha: "b".repeat(40) }] } as Event);
    await c.update("zed", id, { note: "watching this one" });
    await c.say("zed", "msg", "any news?", { task: id });
    expect(c.state().rejected.size).toBe(0);
    expect(read()).toBe(since);
    c.wait(60_000);
    const spoke = await c.say("mac", "msg", "reading it now", { task: id });
    expect(read()).toBe(spoke.rts!);
    expect(due(c, since + N)).toEqual([]);
  });

  test("a new mover starts a new clock, and an answered question hands the move back with a fresh one", async () => {
    const c = channel();
    const { id } = await inReview(c);
    c.wait(5 * N);
    const pass = await c.update("mac", id, { state: "done", verdict: "approved", round: 1, at: A });
    expect(c.state().tasks.get(id)!.state).toBe("done");
    const held = await c.add({ owner: "win" });
    await c.update("win", held, { state: "doing" });
    const began = c.now();
    c.wait(5 * N);
    const ask = await c.say("win", "ask", "Which one?", { to: ["jon"], holds: [held] });
    const asked = c.state();
    expect(clockOf(asked, asked.tasks.get(held)!, c.now())).toMatchObject({ mover: "jon", since: ask.rts!, paged: false });
    expect(nudgesDue(asked, c.now() + 9 * N)).toEqual([]);
    c.wait(2 * N);
    const answer = await c.say("jon", "msg", "the first", { re: [ask.seq] });
    const back = c.state();
    expect(clockOf(back, back.tasks.get(held)!, c.now())).toEqual({ mover: "win", since: answer.rts!, quiet: 0, paged: true });
    expect(began).toBeLessThan(pass.rts! + 5 * N);
  });
});

describe("queued work is never paged, and a long wait reaches the lead once a day (#3930 §2, case 3)", () => {
  test("three planned tasks behind one in progress page nobody; after a day the lead gets one line for the oldest", async () => {
    const c = channel();
    const doing = await c.add({ owner: "win" });
    await c.update("win", doing, { state: "doing" });
    const first = await c.add({ owner: "win" });
    await c.add({ owner: "win" });
    await c.add({ owner: "win" });
    const queued = c.state().tasks.get(first)!.createdAt;
    await c.say("win", "msg", "still on it", { task: doing });
    expect(due(c, c.now() + N - 1)).toEqual([]);
    const tomorrow = queued + QUEUE_MS + 1;
    const notices = nudgesDue(c.state(), tomorrow).filter((d) => d.step === 0);
    expect(notices).toEqual([{ task: first, mover: "win", since: queued + QUEUE_MS, step: 0, to: "owl" }]);
    c.wait(QUEUE_MS + 2_000);
    await c.say("win", "msg", "still on it", { task: doing });
    await c.nudge("owl", first, "win", queued + QUEUE_MS, 0);
    expect(c.state().rejected.size).toBe(0);
    expect(due(c).filter((d) => d.step === 0)).toEqual([]);
    expect(nudgesDue(c.state(), queued + 2 * QUEUE_MS + 1).filter((d) => d.step === 0)).toEqual([{ task: first, mover: "win", since: queued + 2 * QUEUE_MS, step: 0, to: "owl" }]);
  });
});

describe("the board and the task page say when a task is quiet", () => {
  test("a quiet line on the task, a tag on its row, and plain words for each step", async () => {
    const c = channel();
    const { id, since } = await inReview(c);
    c.wait(2 * N);
    const woke = await c.nudge("owl", id, "mac", since, 1);
    const s = c.state();
    const at = since + 2 * N + 60_000;
    expect(formatTask(s, s.tasks.get(id)!, at).split("\n")).toContain("  quiet 41m with mac (woken)");
    expect(
      formatTasks(s, "kiwi", { now: at })
        .split("\n")
        .find((r) => r.trimStart().startsWith(`T${id} `)),
    ).toEndWith(" · move: mac to review it · quiet 41m with mac (woken)");
    expect(
      formatTasks(s, "kiwi")
        .split("\n")
        .find((r) => r.trimStart().startsWith(`T${id} `)),
    ).toEndWith(" · move: mac to review it");
    const words = (step: NudgeStep) => describeEvent({ ...woke, ev: { op: "task.nudge", task: id, mover: "mac", since, step } }, s);
    expect([0, 1, 2, 3].map((step) => words(step as NudgeStep))).toEqual([
      `noted that T${id} “ship” has waited a day in mac's queue`,
      `woke mac: T${id} “ship” has gone quiet`,
      `told the lead that T${id} “ship” is still quiet with mac`,
      `put T${id} “ship” in the owner's Needs you: still quiet with mac`,
    ]);
  });
});
