import { beforeAll, describe, expect, test } from "bun:test";
import { formatTask, formatTasks } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { moverOf, moverText } from "@kiwi/core/mover.ts";
import { PROTOCOL_VERSION, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts";

const NAMES = ["jon", "owl", "win", "mac", "zed"] as const;
type Name = (typeof NAMES)[number];
const ids: Record<string, Identity> = {};
beforeAll(async () => {
  for (const n of NAMES) ids[n] = await generateIdentity(n);
});

const rosterOf = (gone: readonly Name[] = [], lead = true): Roster => [
  { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
  { name: "owl", pk: ids.owl!.pk, owner: false, at: 1, active: !gone.includes("owl"), kind: "agent", ...(lead ? { role: "lead" as const } : {}) },
  { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: !gone.includes("win"), kind: "agent" },
  { name: "mac", pk: ids.mac!.pk, owner: false, at: 3, active: !gone.includes("mac"), kind: "agent" },
  { name: "zed", pk: ids.zed!.pk, owner: false, at: 4, active: !gone.includes("zed"), kind: "agent" },
];

const A = "a".repeat(40);
const B = "b".repeat(40);

function channel() {
  const log: Message[] = [];
  const say = async (from: Name, kind: Kind, body: string, extra: Partial<Pick<Message, "to" | "ev" | "re" | "esc" | "choices" | "holds">> = {}): Promise<Message> => {
    const seq = log.length + 1;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: seq, ...extra };
    const p = await sign(ids[from]!, payload);
    const m = { ...p, seq, rts: seq, sigOk: await verify(p) };
    log.push(m);
    return m;
  };
  const ev = (from: Name, e: Event) => say(from, "event", "", { ev: e });
  const add = async (more: Partial<Extract<Event, { op: "task.add" }>> = {}): Promise<number> => (await ev("owl", { op: "task.add", title: "ship", ...more })).seq;
  const update = (from: Name, task: number, change: Omit<Extract<Event, { op: "task.update" }>, "op" | "task">) => ev(from, { op: "task.update", task, ...change });
  const ask = (from: Name, to: Name[], holds: number[]) => say(from, "ask", "Which one?", { to, holds });
  const state = (roster: Roster = rosterOf()): ChannelState => fold(log, roster, 10_000);
  return { ev, add, update, ask, say, state };
}

const moveOf = (s: ChannelState, id: number) => moverOf(s, s.tasks.get(id)!);

describe("every open task has one mover, derived from state (#3930 §1)", () => {
  test("a task being worked on is its owner's; with no owner it is the lead's (case 21)", async () => {
    const c = channel();
    const owned = await c.add({ owner: "win" });
    await c.update("win", owned, { state: "doing" });
    const loose = await c.add();
    await c.update("owl", loose, { state: "doing" });
    await c.update("owl", loose, { owner: null });
    const s = c.state();
    expect(s.tasks.get(loose)!.owner).toBeUndefined();
    expect(moveOf(s, owned)).toEqual({ kind: "member", name: "win", move: "work" });
    expect(moveOf(s, loose)).toEqual({ kind: "member", name: "owl", move: "assign" });
  });

  test("planned tasks queue by id behind their owner's work, and only the first has a mover (case 3)", async () => {
    const c = channel();
    const first = await c.add({ owner: "win" });
    const second = await c.add({ owner: "win" });
    const third = await c.add({ owner: "win" });
    const idle = c.state();
    expect(moveOf(idle, first)).toEqual({ kind: "member", name: "win", move: "start" });
    expect(moveOf(idle, second)).toEqual({ kind: "waiting", owner: "win", ahead: 1 });
    expect(moveOf(idle, third)).toEqual({ kind: "waiting", owner: "win", ahead: 2 });
    await c.update("win", second, { state: "doing" });
    const busy = c.state();
    expect(moveOf(busy, second)).toEqual({ kind: "member", name: "win", move: "work" });
    expect(moveOf(busy, first)).toEqual({ kind: "waiting", owner: "win", ahead: 1 });
    expect(moveOf(busy, third)).toEqual({ kind: "waiting", owner: "win", ahead: 2 });
  });

  test("a planned task with no owner is the lead's to give out", async () => {
    const c = channel();
    const id = await c.add();
    expect(moveOf(c.state(), id)).toEqual({ kind: "member", name: "owl", move: "assign" });
  });

  test("an open round is its reviewer's; one open to anyone is the lead's to route", async () => {
    const c = channel();
    const named = await c.add({ owner: "win", review: "mac" });
    await c.update("win", named, { state: "review", at: A });
    const anyone = await c.add({ owner: "win", review: "*" });
    await c.update("win", anyone, { state: "review", at: A });
    const s = c.state();
    expect(moveOf(s, named)).toEqual({ kind: "member", name: "mac", move: "review" });
    expect(moveOf(s, anyone)).toEqual({ kind: "member", name: "owl", move: "route" });
  });

  test("a rejected task is its owner's to work on; one whose approval went stale is its owner's to send again", async () => {
    const c = channel();
    await c.ev("jon", { op: "repos.set", repos: ["o/r"] });
    await c.ev("jon", { op: "branch.prefix.set", prefix: "T" });
    const rejected = await c.add({ owner: "win", review: "mac" });
    await c.update("win", rejected, { state: "review", at: A });
    await c.update("mac", rejected, { state: "doing", verdict: "rejected", round: 1, at: A, note: "no" });
    const stale = await c.add({ owner: "win", review: "mac", then: "merge" });
    const pr = (sha: string) => ({ event: "pull_request" as const, repo: "o/r", number: 7, state: "open" as const, merged: false, branch: `T${stale}-ship`, sha, at: 1 });
    await c.ev("jon", { op: "github", items: [pr(A)] });
    await c.update("win", stale, { state: "review", at: A });
    await c.update("mac", stale, { state: "done", verdict: "approved", round: 1, at: A });
    expect(moveOf(c.state(), stale)).toEqual({ kind: "member", name: "win", move: "land" });
    await c.ev("jon", { op: "github", items: [pr(B)] });
    const s = c.state();
    expect(s.tasks.get(stale)!.state).toBe("review");
    expect(moveOf(s, rejected)).toEqual({ kind: "member", name: "win", move: "work" });
    expect(moveOf(s, stale)).toEqual({ kind: "member", name: "win", move: "revise" });
  });

  test("an approved task is its lander's, the owner unless someone else is named", async () => {
    const c = channel();
    const own = await c.add({ owner: "win", review: "mac", then: "merge" });
    await c.update("win", own, { state: "review", at: A });
    await c.update("mac", own, { state: "done", verdict: "approved", round: 1, at: A });
    const led = await c.add({ owner: "win", review: "mac", then: "merge", lander: "owl" });
    await c.update("win", led, { state: "review", at: A });
    await c.update("mac", led, { state: "done", verdict: "approved", round: 1, at: A });
    const s = c.state();
    expect(moveOf(s, own)).toEqual({ kind: "member", name: "win", move: "land" });
    expect(moveOf(s, led)).toEqual({ kind: "member", name: "owl", move: "land" });
  });

  test("an open question that holds the task wins over its state: the first person named on the oldest one (case 20)", async () => {
    const c = channel();
    const id = await c.add({ owner: "win", review: "mac" });
    await c.update("win", id, { state: "review", at: A });
    expect(moveOf(c.state(), id)).toEqual({ kind: "member", name: "mac", move: "review" });
    const oldest = await c.ask("win", ["jon", "zed"], [id]);
    await c.ask("win", ["zed"], [id]);
    expect(moveOf(c.state(), id)).toEqual({ kind: "member", name: "jon", move: "answer", question: oldest.seq });
    await c.say("jon", "msg", "yes", { re: [oldest.seq] });
    expect(moveOf(c.state(), id)).toMatchObject({ kind: "member", name: "zed", move: "answer" });
  });

  test("a mover who left, or a channel with no lead, hands the move to the channel's owner", async () => {
    const c = channel();
    const owned = await c.add({ owner: "win" });
    await c.update("win", owned, { state: "doing" });
    const reviewed = await c.add({ owner: "zed", review: "mac" });
    await c.update("zed", reviewed, { state: "review", at: A });
    const loose = await c.add();
    const gone = c.state(rosterOf(["win", "mac"]));
    expect(gone.tasks.get(owned)).toMatchObject({ state: "todo", leftBy: "win" });
    expect(moveOf(gone, owned)).toEqual({ kind: "member", name: "owl", move: "assign" });
    expect(moveOf(gone, reviewed)).toEqual({ kind: "member", name: "jon", move: "review" });
    const leaderless = c.state(rosterOf([], false));
    expect(leaderless.lead).toBeNull();
    expect(moveOf(leaderless, loose)).toEqual({ kind: "member", name: "jon", move: "assign" });
  });

  test("a finished task has no mover", async () => {
    const c = channel();
    const id = await c.add({ owner: "win" });
    await c.update("win", id, { state: "done" });
    expect(moveOf(c.state(), id)).toBeUndefined();
  });
});

describe("the board and the task page say whose move it is (#3930 §1)", () => {
  test("a row names the mover only when it isn't the owner shown, and says when a task waits", async () => {
    const c = channel();
    const doing = await c.add({ owner: "win", title: "first" });
    await c.update("win", doing, { state: "doing" });
    const waits = await c.add({ owner: "win", title: "second" });
    const reviewed = await c.add({ owner: "zed", review: "mac", title: "third" });
    await c.update("zed", reviewed, { state: "review", at: A });
    const held = await c.add({ owner: "zed", title: "fourth" });
    await c.update("zed", held, { state: "doing" });
    const q = await c.ask("zed", ["jon"], [held]);
    const s = c.state();
    const rows = formatTasks(s, "kiwi").split("\n");
    const row = (id: number) => rows.find((r) => r.trimStart().startsWith(`T${id} `))!;
    expect(row(doing)).not.toContain("move:");
    expect(row(waits)).toEndWith(" · waiting, 1 ahead");
    expect(row(reviewed)).toEndWith(" · move: mac to review it");
    expect(row(held)).toEndWith(` · move: jon to answer #${q.seq}`);
  });

  test("task show has a move line", async () => {
    const c = channel();
    const first = await c.add({ owner: "win" });
    const second = await c.add({ owner: "win" });
    const loose = await c.add();
    const s = c.state();
    expect(formatTask(s, s.tasks.get(first)!).split("\n")).toContain("  move: win to start it");
    expect(formatTask(s, s.tasks.get(second)!).split("\n")).toContain("  move: waiting, 1 ahead of it for win");
    expect(formatTask(s, s.tasks.get(loose)!).split("\n")).toContain("  move: owl to give it an owner");
    expect(moverText({ kind: "nobody", move: "assign" })).toBe("nobody to give it an owner: the channel has no owner here");
  });
});
