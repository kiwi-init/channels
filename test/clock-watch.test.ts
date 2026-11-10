import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts";
import { QUIET_MS, UNREAD_MS } from "@kiwi/core/state/clocks.ts";
import type { DocWakeItem } from "../src/config/doc-wakes.ts";
import { clockBlock, watchClock, watchedPeers, type ClockWatcher } from "../src/daemon/clock-watch.ts";

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
const open: ClockWatcher[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.stop();
});

function channel() {
  const log: Message[] = [];
  let time = T0;
  const say = async (from: Name, kind: Kind, body: string, extra: Partial<Pick<Message, "to" | "ev" | "task">> = {}): Promise<Message> => {
    const seq = log.length + 1;
    time += 1_000;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: time, ...extra };
    const p = await sign(ids[from]!, payload);
    const m = { ...p, seq, rts: time, sigOk: await verify(p) };
    log.push(m);
    return m;
  };
  const ev = (from: Name, e: Event, to?: string) => say(from, "event", "", { ev: e, ...(to && to !== from ? { to: [to] } : {}) });
  const state = (): ChannelState => fold(log, roster, time);
  const events = (op: Event["op"]) => log.filter((m) => m.ev?.op === op && !state().rejected.has(m.seq));
  return { log, say, ev, state, events, wait: (ms: number) => void (time += ms), now: () => time };
}

type Channel = ReturnType<typeof channel>;

async function inReview(c: Channel): Promise<{ id: number; epoch: number }> {
  const id = (await c.ev("owl", { op: "task.add", title: "ship", owner: "win", review: "mac" })).seq;
  const round = await c.ev("win", { op: "task.update", task: id, state: "review", at: A });
  return { id, epoch: round.seq };
}

interface Rig {
  wakes?: boolean;
  wanted?: boolean;
  peers?: Name[];
  hosts?: Name[];
  reachable?: boolean;
  lose?: "response" | "post";
}

function seat(c: Channel, agent: Name, rig: Rig = {}) {
  const pending: DocWakeItem[] = [];
  const told = new Set<string>();
  const did = { wakes: 0 };
  const set = { ...rig };
  const w = watchClock(
    {
      agent,
      peers: async () => set.peers ?? [agent],
      hosts: (name) => (set.hosts ?? [agent]).some((n) => n === name),
      wanted: async () => set.wanted ?? true,
      wakes: async () => set.wakes ?? true,
      reachable: () => set.reachable ?? true,
      stateOf: async () => c.state(),
      nudge: async (ev, to) => {
        if (set.lose === "post") return null;
        const m = await c.ev(agent, ev, to);
        return set.lose === "response" ? null : m.seq;
      },
      got: async (ev) => void (await c.ev(agent, ev)),
      pending: () => pending.filter((p) => !told.has(p.block)),
      told: (block) => told.has(block),
      add: (item) => void pending.push(item),
      drop: (blocks) => void blocks.forEach((b) => told.add(b)),
      wake: () => void did.wakes++,
    },
    c.now,
  );
  open.push(w);
  return { w, did, set, pending: () => pending.filter((p) => !told.has(p.block)), shown: (block: string) => void told.add(block) };
}

describe("one waker (#3930 §2, cases 2 and 22)", () => {
  test("case 22: two evaluators reach N, and the hosting daemon alone records the attempt and wakes the seat once", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac");
    const other = seat(c, "owl");
    c.wait(N);
    await other.w.look();
    expect(c.events("task.nudge")).toEqual([]);
    await Promise.all([host.w.look(), host.w.look(), other.w.look()]);
    await host.w.look();
    await other.w.look();
    expect(c.events("task.nudge").map((m) => [m.from, m.ev])).toEqual([["mac", { op: "task.nudge", task: id, mover: "mac", since: epoch, step: 1 }]]);
    expect(host.did.wakes).toBe(1);
    expect(other.did.wakes).toBe(0);
    expect(host.pending().map((p) => [p.block, p.text])).toEqual([[clockBlock(id, epoch), `T${id} has been quiet 20m and it's your move`]]);
    expect(host.w.holds(clockBlock(id, epoch))).toBe(false);
  });

  test("case 22: the daemon crashes after the attempt and restarts: it finds its own record, wakes nobody, and the lead is told after 5 min", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac");
    const lead = seat(c, "owl");
    c.wait(N);
    await host.w.look();
    host.w.stop();
    const again = seat(c, "mac");
    await again.w.look();
    c.wait(UNREAD_MS - 2_000);
    await again.w.look();
    await lead.w.look();
    expect(again.did.wakes).toBe(0);
    expect(c.events("task.nudge")).toHaveLength(1);
    c.wait(2_000);
    await lead.w.look();
    await lead.w.look();
    await again.w.look();
    expect(
      c
        .events("task.nudge")
        .slice(1)
        .map((m) => [m.from, m.to, m.ev]),
    ).toEqual([["owl", undefined, { op: "task.nudge", task: id, mover: "mac", since: epoch, step: 2, wake: "attempted" }]]);
    expect(again.did.wakes).toBe(0);
    expect(lead.pending().map((p) => p.text)).toEqual([`T${id} is still quiet with mac (wake attempted, not delivered, not read), and it is yours to chase`]);
    expect(lead.did.wakes).toBe(1);
    expect(lead.w.holds(lead.pending()[0]!.block)).toBe(false);
    await c.say("mac", "msg", "on it", { task: id });
    await lead.w.look();
    expect(lead.pending()).toEqual([]);
  });

  test("a post whose answer was lost is never followed by a wake or a second attempt", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac", { lose: "response" });
    c.wait(N);
    await host.w.look();
    host.set.lose = undefined;
    await host.w.look();
    await host.w.look();
    expect(c.events("task.nudge")).toHaveLength(1);
    expect(c.state().tasks.get(id)!.clock!.woke).toMatchObject({ since: epoch, by: "mac" });
    expect(host.did.wakes).toBe(0);
    expect(host.pending()).toEqual([]);
  });

  test("a post that never left is not retried in this process, and the lead hears no wake was attempted", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac", { lose: "post" });
    const lead = seat(c, "owl");
    c.wait(N);
    await host.w.look();
    host.set.lose = undefined;
    await host.w.look();
    expect(c.events("task.nudge")).toEqual([]);
    expect(host.did.wakes).toBe(0);
    c.wait(UNREAD_MS);
    await lead.w.look();
    expect(c.events("task.nudge").map((m) => m.ev)).toEqual([{ op: "task.nudge", task: id, mover: "mac", since: epoch, step: 2, wake: "none" }]);
  });

  test("delivered is recorded when the wake path answers, read when the session is shown the item, and neither wakes again", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac");
    c.wait(N);
    await host.w.look();
    const ran = host.w.invoked();
    expect(host.w.holds(clockBlock(id, epoch))).toBe(true);
    host.w.delivered(ran);
    await host.w.look();
    await host.w.look();
    expect(c.events("task.wake").map((m) => m.ev)).toEqual([{ op: "task.wake", task: id, mover: "mac", since: epoch, got: "delivered" }]);
    c.wait(60_000);
    host.shown(clockBlock(id, epoch));
    await host.w.look();
    await host.w.look();
    expect(c.events("task.wake").map((m) => (m.ev?.op === "task.wake" ? m.ev.got : ""))).toEqual(["delivered", "read"]);
    expect(host.did.wakes).toBe(1);
    expect(c.state().rejected.size).toBe(0);
    c.wait(UNREAD_MS);
    const lead = seat(c, "owl");
    await lead.w.look();
    expect(c.events("task.nudge")).toHaveLength(1);
  });

  test("a wake command that failed, or whose outcome is unknown, used up the attempt: the item no longer invokes the harness, nothing is said delivered, and the lead hears it after 5 min", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac");
    const lead = seat(c, "owl");
    c.wait(N);
    await host.w.look();
    expect(host.w.holds(clockBlock(id, epoch))).toBe(false);
    host.w.invoked();
    expect(host.w.holds(clockBlock(id, epoch))).toBe(true);
    await host.w.look();
    await host.w.look();
    expect(c.events("task.wake")).toEqual([]);
    expect(host.did.wakes).toBe(1);
    expect(host.pending().map((p) => p.block)).toEqual([clockBlock(id, epoch)]);
    c.wait(UNREAD_MS);
    await lead.w.look();
    expect(c.events("task.nudge").at(-1)!.ev).toEqual({ op: "task.nudge", task: id, mover: "mac", since: epoch, step: 2, wake: "attempted" });
    expect(host.did.wakes).toBe(1);
  });

  test("a second task's attempt armed while the first command runs keeps its own right to a wake, and the first command's answer is recorded for the first only", async () => {
    const c = channel();
    const first = await inReview(c);
    const host = seat(c, "mac");
    c.wait(N);
    await host.w.look();
    const running = host.w.invoked();
    expect(running).toEqual([clockBlock(first.id, first.epoch)]);
    const second = await inReview(c);
    c.wait(N);
    await host.w.look();
    expect(host.did.wakes).toBe(2);
    expect(host.w.holds(clockBlock(second.id, second.epoch))).toBe(false);
    host.w.delivered(running);
    await host.w.look();
    expect(c.events("task.wake").map((m) => m.ev)).toEqual([{ op: "task.wake", task: first.id, mover: "mac", since: first.epoch, got: "delivered" }]);
    expect(host.w.holds(clockBlock(second.id, second.epoch))).toBe(false);
    const next = host.w.invoked();
    expect(next).toEqual([clockBlock(second.id, second.epoch)]);
    host.w.delivered(next);
    host.w.delivered(running);
    await host.w.look();
    expect(c.events("task.wake").map((m) => (m.ev?.op === "task.wake" ? [m.ev.task, m.ev.got] : []))).toEqual([
      [first.id, "delivered"],
      [second.id, "delivered"],
    ]);
    expect(c.state().rejected.size).toBe(0);
  });

  test("a typed wake that has to be tried again gives the attempt back, once", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac");
    c.wait(N);
    await host.w.look();
    const tried = host.w.invoked();
    expect(host.w.holds(clockBlock(id, epoch))).toBe(true);
    host.w.rearm(tried);
    expect(host.w.holds(clockBlock(id, epoch))).toBe(false);
    expect(host.w.invoked()).toEqual(tried);
    expect(host.w.invoked()).toEqual([]);
  });

  test("a typing retry gives back only its own attempt while it is still current: after the mover's progress it restores nothing, and the new epoch's attempt is untouched", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac");
    c.wait(N);
    await host.w.look();
    const typing = host.w.invoked();
    const spoke = await c.say("mac", "msg", "reading it now", { task: id });
    c.wait(N);
    await host.w.look();
    expect(host.w.holds(clockBlock(id, spoke.seq))).toBe(false);
    host.w.rearm(typing);
    host.w.delivered(typing);
    expect(host.w.holds(clockBlock(id, epoch))).toBe(true);
    expect(host.w.holds(clockBlock(id, spoke.seq))).toBe(false);
    await host.w.look();
    expect(c.events("task.wake")).toEqual([]);
    expect(host.w.invoked()).toEqual([clockBlock(id, spoke.seq)]);
  });

  test("the seats a daemon chooses its posting seat from are the watched ones, in a fixed order: a dormant seat is never chosen", () => {
    expect(
      watchedPeers([
        { agent: "win", key: "test\u0000a", watched: false },
        { agent: "zed", key: "test\u0000c", watched: true },
        { agent: "owl", key: "test\u0000b", watched: true },
      ]),
    ).toEqual(["owl", "zed"]);
  });

  test("a session shown the item before any wake path answered is recorded as delivered and read", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac");
    c.wait(N);
    await host.w.look();
    host.shown(clockBlock(id, epoch));
    await host.w.look();
    expect(c.events("task.wake").map((m) => (m.ev?.op === "task.wake" ? m.ev.got : ""))).toEqual(["delivered", "read"]);
    expect(c.state().tasks.get(id)!.clock!.woke!.read).toBeDefined();
  });

  test("case 2: a seat with no way to wake it is the lead's at N, said by its own daemon as no wake attempted", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac", { wakes: false, peers: ["owl", "mac"] });
    c.wait(N);
    await host.w.look();
    await host.w.look();
    expect(c.events("task.nudge").map((m) => [m.from, m.to, m.ev])).toEqual([["mac", ["owl"], { op: "task.nudge", task: id, mover: "mac", since: epoch, step: 2, wake: "none" }]]);
    expect(host.did.wakes).toBe(0);
  });

  test("a seat with no listener and no way to wake it doesn't read the channel at all; another evaluator says no wake was attempted", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac", { wanted: false, wakes: false });
    const lead = seat(c, "owl", { reachable: false });
    c.wait(N);
    await host.w.look();
    expect(c.events("task.nudge")).toEqual([]);
    await lead.w.look();
    expect(c.events("task.nudge").map((m) => [m.from, m.ev])).toEqual([["owl", { op: "task.nudge", task: id, mover: "mac", since: epoch, step: 2, wake: "none" }]]);
  });

  test("case 2: the hosting daemon is offline: another evaluator tells the lead at N when the seat is unreachable, and waits 5 min when it looks reachable", async () => {
    const gone = channel();
    const a = await inReview(gone);
    const lead = seat(gone, "owl", { reachable: false });
    gone.wait(N);
    await lead.w.look();
    expect(gone.events("task.nudge").map((m) => m.ev)).toEqual([{ op: "task.nudge", task: a.id, mover: "mac", since: a.epoch, step: 2, wake: "none" }]);

    const quiet = channel();
    const b = await inReview(quiet);
    const patient = seat(quiet, "owl", { reachable: true });
    quiet.wait(N);
    await patient.w.look();
    quiet.wait(UNREAD_MS - 5_000);
    await patient.w.look();
    expect(quiet.events("task.nudge")).toEqual([]);
    quiet.wait(5_000);
    await patient.w.look();
    expect(quiet.events("task.nudge").map((m) => m.ev)).toEqual([{ op: "task.nudge", task: b.id, mover: "mac", since: b.epoch, step: 2, wake: "none" }]);
  });

  test("the review moves to someone else while the item is pending: it is dropped unread, and the new mover's own daemon makes its own attempt", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac");
    const next = seat(c, "zed");
    c.wait(N);
    await host.w.look();
    await c.ev("owl", { op: "task.update", task: id, review: "zed" });
    await host.w.look();
    expect(host.pending()).toEqual([]);
    expect(c.events("task.wake")).toEqual([]);
    expect(host.w.holds(clockBlock(id, epoch))).toBe(true);
    await next.w.look();
    expect(next.did.wakes).toBe(0);
    c.wait(N);
    await next.w.look();
    await host.w.look();
    expect(next.did.wakes).toBe(1);
    expect(host.did.wakes).toBe(1);
    expect(c.state().tasks.get(id)!.clock!.woke).toMatchObject({ by: "zed" });
    expect(c.state().rejected.size).toBe(0);
  });

  test("the mover's own progress while the item is pending drops it, and a later quiet spell is a new attempt", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac");
    c.wait(N);
    await host.w.look();
    const spoke = await c.say("mac", "msg", "reading it now", { task: id });
    await host.w.look();
    expect(host.pending()).toEqual([]);
    expect(c.events("task.wake")).toEqual([]);
    c.wait(N);
    await host.w.look();
    expect(host.did.wakes).toBe(2);
    expect(host.pending().map((p) => p.block)).toEqual([clockBlock(id, spoke.seq)]);
    expect(host.pending().map((p) => p.block)).not.toContain(clockBlock(id, epoch));
  });

  test("case 7: back after 3N, only the owner's step is posted, and nobody is woken for the steps that passed", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac");
    c.wait(3 * N);
    await host.w.look();
    await host.w.look();
    expect(c.events("task.nudge").map((m) => [m.to, m.ev])).toEqual([[["jon"], { op: "task.nudge", task: id, mover: "mac", since: epoch, step: 3 }]]);
    expect(host.did.wakes).toBe(0);
  });

  test("the posting seat is chosen per task among the seats that may evaluate it: a dormant or unrelated first seat silences nobody", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const lead = seat(c, "owl", { peers: ["win", "owl"] });
    const bystander = seat(c, "win", { peers: ["win", "owl"] });
    c.wait(3 * N);
    await bystander.w.look();
    expect(c.events("task.nudge")).toEqual([]);
    await lead.w.look();
    expect(c.events("task.nudge").map((m) => [m.from, m.to, m.ev])).toEqual([["owl", ["jon"], { op: "task.nudge", task: id, mover: "mac", since: epoch, step: 3 }]]);
  });

  test("a seat that isn't the channel's posting seat still records its own attempt, and leaves the lead's and owner's steps to the one that is", async () => {
    const c = channel();
    const { id, epoch } = await inReview(c);
    const host = seat(c, "mac", { peers: ["owl", "mac"] });
    c.wait(N);
    await host.w.look();
    expect(host.did.wakes).toBe(1);
    const ran = host.w.invoked();
    host.w.delivered(ran);
    host.shown(clockBlock(id, epoch));
    await host.w.look();
    c.wait(N);
    await host.w.look();
    expect(c.events("task.nudge")).toHaveLength(1);
    const posting = seat(c, "owl");
    await posting.w.look();
    expect(c.events("task.nudge").at(-1)!.ev).toEqual({ op: "task.nudge", task: id, mover: "mac", since: epoch, step: 2, wake: "read" });
  });
});
