import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ev: e, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "owl", "win", "mac"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "owl", pk: ids.owl!.pk, owner: false, at: 1, active: true, kind: "agent", role: "lead" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 3, active: true, kind: "agent" },
  ];
});

const HEAD = "1111111111111111111111111111111111111111";

async function approved(more: Partial<Extract<Event, { op: "task.add" }>> = {}): Promise<{ t: number; log: Message[] }> {
  const add = await ev("owl", { op: "task.add", title: "export", owner: "win", review: "mac", ...more });
  const t = add.seq;
  const review = await ev("win", { op: "task.update", task: t, state: "review", at: HEAD });
  const pass = await ev("mac", { op: "task.update", task: t, state: "done", verdict: "approved", round: 1, at: HEAD });
  return { t, log: [add, review, pass] };
}

describe("a task with a landing step isn't done on approval (#623)", () => {
  test("without a landing setting, approval still means done", async () => {
    const { t, log } = await approved();
    const s = fold(log, roster);
    expect(s.tasks.get(t)!.state).toBe("done");
    expect(s.tasks.get(t)!.then).toBeUndefined();
  });

  test("the channel's landing setting is copied onto a task when it's created, and approval moves it to landing", async () => {
    const set = await ev("jon", { op: "landing.set", then: "merge" });
    const { t, log } = await approved();
    const s = fold([set, ...log], roster);
    const task = s.tasks.get(t)!;
    expect(task.then).toBe("merge");
    expect(task.state).toBe("landing");
    expect(task.approvedBy).toBe("mac");
    expect(task.closedSeq).toBeUndefined();
    expect(task.rounds.at(-1)!.result.kind).toBe("approved");
  });

  test("a task made before the setting keeps the old rule", async () => {
    const { t, log } = await approved();
    const set = await ev("jon", { op: "landing.set", then: "merge" });
    const s = fold([log[0]!, set, ...log.slice(1)], roster);
    expect(s.tasks.get(t)!.state).toBe("done");
  });

  test("only the owner or a trusted person sets how tasks land", async () => {
    const set = await ev("win", { op: "landing.set", then: "none" });
    const s = fold([set], roster);
    expect(s.rejected.has(set.seq)).toBe(true);
    expect(s.landing).toBeNull();
  });

  test("--then on a task overrides the channel's setting", async () => {
    const set = await ev("jon", { op: "landing.set", then: "merge" });
    const { t, log } = await approved({ then: "none" });
    const s = fold([set, ...log], roster);
    expect(s.tasks.get(t)!.state).toBe("done");
  });

  test("a manual done can't skip landing, even from a person", async () => {
    const add = await ev("owl", { op: "task.add", title: "export", owner: "win", then: "merge" });
    const done = await ev("jon", { op: "task.update", task: add.seq, state: "done" });
    const s = fold([add, done], roster);
    expect(s.rejected.get(done.seq)).toBe(`T${add.seq} lands by its step (merge): approve it, or close it with a reason`);
    expect(s.tasks.get(add.seq)!.state).toBe("todo");
  });

  test("a manual done on a landing task is refused too", async () => {
    const { t, log } = await approved({ then: "merge" });
    const done = await ev("jon", { op: "task.update", task: t, state: "done" });
    const s = fold([...log, done], roster);
    expect(s.rejected.has(done.seq)).toBe(true);
    expect(s.tasks.get(t)!.state).toBe("landing");
  });

  test("--then none after the PASS sends the task back to review at the same head, not to done", async () => {
    const { t, log } = await approved({ then: "merge" });
    const none = await ev("owl", { op: "task.update", task: t, then: "none" });
    const s = fold([...log, none], roster);
    const task = s.tasks.get(t)!;
    expect(task.state).toBe("review");
    expect(task.then).toBeUndefined();
    expect(task.approvedBy).toBeUndefined();
    expect(task.rounds.at(-1)).toMatchObject({ n: 2, at: HEAD, result: { kind: "open" } });
  });

  test("only a person or the lead changes how a task lands", async () => {
    const { t, log } = await approved({ then: "merge" });
    const none = await ev("win", { op: "task.update", task: t, then: "none" });
    const lander = await ev("win", { op: "task.update", task: t, lander: "win" });
    const s = fold([...log, none, lander], roster);
    expect(s.rejected.get(none.seq)).toBe(`only a person or the lead changes how T${t} lands`);
    expect(s.rejected.has(lander.seq)).toBe(true);
    expect(s.tasks.get(t)!.state).toBe("landing");
  });

  test("a PR replaced after the PASS sends the task back to review, and only a person or the lead may replace it", async () => {
    const { t, log } = await approved({ then: "merge" });
    const first = await ev("win", { op: "task.update", task: t, proof: { url: "https://github.com/o/r/pull/1" } });
    const s0 = fold([log[0]!, log[1]!, first, log[2]!], roster);
    expect(s0.tasks.get(t)!.state).toBe("landing");
    const builder = await ev("win", { op: "task.update", task: t, proof: { url: "https://github.com/o/r/pull/2" } });
    const lead = await ev("owl", { op: "task.update", task: t, proof: { url: "https://github.com/o/r/pull/3" } });
    const s = fold([log[0]!, log[1]!, first, log[2]!, builder, lead], roster);
    expect(s.rejected.get(builder.seq)).toBe(`only a person or the lead links another PR to T${t} once it's approved`);
    expect(s.tasks.get(t)!.state).toBe("review");
    const run = await ev("win", { op: "task.update", task: t, proof: { url: "https://ci.example.com/runs/9" } });
    const s2 = fold([...log, run], roster);
    expect(s2.tasks.get(t)!.state).toBe("landing");
  });

  test("a close with a reason is the way out of landing, for a person or the lead only", async () => {
    const { t, log } = await approved({ then: "merge" });
    const builder = await ev("win", { op: "task.update", task: t, state: "done", close: "merged by hand" });
    const lead = await ev("owl", { op: "task.update", task: t, state: "done", close: "fixed by #1788" });
    const s = fold([...log, builder, lead], roster);
    expect(s.rejected.get(builder.seq)).toBe(`only a person or the lead closes T${t} with a reason`);
    const task = s.tasks.get(t)!;
    expect(task.state).toBe("done");
    expect(task.closedWith).toBe("fixed by #1788");
    expect(task.cancelled).toBeUndefined();
    expect(task.notes.at(-1)!.text).toBe("fixed by #1788");
  });

  test("a close needs a reason and can't carry a verdict", async () => {
    const add = await ev("owl", { op: "task.add", title: "export" });
    expect(wellFormed({ ...add, ev: { op: "task.update", task: add.seq, state: "done", close: "  " } })).toBe(false);
    expect(wellFormed({ ...add, ev: { op: "task.update", task: add.seq, state: "doing", close: "why" } })).toBe(false);
    expect(wellFormed({ ...add, ev: { op: "task.update", task: add.seq, state: "done", verdict: "approved", close: "why" } })).toBe(false);
    expect(wellFormed({ ...add, ev: { op: "task.add", title: "x", then: "release:npm:@kiwi/core@^2" } })).toBe(true);
    expect(wellFormed({ ...add, ev: { op: "task.add", title: "x", then: "ship it" as never } })).toBe(false);
  });

  test("an issue closing moves a task with a landing step to landing at most", async () => {
    const add = await ev("owl", { op: "task.add", title: "export", then: "merge" });
    const closing = await ev("jon", { op: "task.update", task: add.seq, state: "landing", note: "closed on GitHub" });
    const s = fold([add, closing], roster);
    expect(s.tasks.get(add.seq)!.state).toBe("landing");
    const plain = await ev("owl", { op: "task.add", title: "plain" });
    const wrong = await ev("jon", { op: "task.update", task: plain.seq, state: "landing" });
    expect(fold([plain, wrong], roster).rejected.get(wrong.seq)).toBe(`T${plain.seq} has no landing step: it finishes on approval`);
  });

  test("an agent can't send a reviewed task to landing without the review", async () => {
    const add = await ev("owl", { op: "task.add", title: "export", owner: "win", review: "mac", then: "merge" });
    const skip = await ev("win", { op: "task.update", task: add.seq, state: "landing" });
    const s = fold([add, skip], roster);
    expect(s.rejected.has(skip.seq)).toBe(true);
    expect(s.tasks.get(add.seq)!.state).toBe("todo");
  });

  test("a landing task can't be approved twice", async () => {
    const { t, log } = await approved({ then: "merge" });
    const again = await ev("mac", { op: "task.update", task: t, state: "done", verdict: "approved", round: 1, at: HEAD });
    expect(fold([...log, again], roster).rejected.get(again.seq)).toBe(`T${t} is already approved: it lands next`);
  });

  test("cancelling a landing task keeps today's permissions", async () => {
    const { t, log } = await approved({ then: "merge" });
    const builder = await ev("win", { op: "task.update", task: t, state: "cancelled" });
    const lead = await ev("owl", { op: "task.update", task: t, state: "cancelled" });
    const s1 = fold([...log, builder], roster);
    expect(s1.tasks.get(t)!.state).toBe("landing");
    const s2 = fold([...log, lead], roster);
    expect(s2.tasks.get(t)!.state).toBe("done");
    expect(s2.tasks.get(t)!.cancelled).toBe(true);
  });
});
