import { describe, expect, test } from "bun:test";
import { clockOf, nudgesDue } from "@kiwi/core/clock.ts";
import { wellFormedEvent, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, LEASE_WAIT_MS, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { folded } from "@kiwi/core/state/fold-on.ts";
import { QUIET_MS } from "@kiwi/core/state/clocks.ts";

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human" },
  { name: "owl", pk: "pk-owl", owner: false, at: 0, active: true, kind: "agent", role: "lead" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent" },
  { name: "mac", pk: "pk-mac", owner: false, at: 0, active: true, kind: "agent" },
];

const MIN = 60_000;
const HOUR = 60 * MIN;
const TASK = 1;
const OTHER = 3;
const JOINED = 10 * MIN;

const event = (seq: number, at: number, from: string, ev: Event): Message =>
  ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev, ts: at, rts: at }) as Message;

const doing = (): Message[] => [event(TASK, 0, "jow", { op: "task.add", title: "Ship the release", owner: "win" }), event(2, 1_000, "win", { op: "task.update", task: TASK, state: "doing" })];
const take = (seq: number, at: number, from: string, ttlMin: number, task?: number): Message =>
  event(seq, at, from, { op: "lease.take", name: "build", ttl: ttlMin * 60, ...(task !== undefined ? { task } : {}) });
const free = (seq: number, at: number, from: string): Message => event(seq, at, from, { op: "lease.free", name: "build" });

const queued = (): Message[] => [...doing(), take(5, 5 * MIN, "mac", 60), take(6, JOINED, "win", 30, TASK)];

const foldAt = (ms: Message[], now: number) =>
  fold(
    ms.filter((m) => m.ts <= now),
    roster,
    now,
  );
const dueFor = (ms: Message[], now: number, task = TASK) => nudgesDue(foldAt(ms, now), now).filter((d) => d.task === task);

describe("a lock wait recorded on a task (T19510)", () => {
  test("the task it blocks raises no quiet event while it waits in line", () => {
    const now = 5 * MIN + HOUR - MIN;
    const state = foldAt(queued(), now);
    expect(state.leases.get("build")?.queue).toEqual([{ name: "win", ttl: 30 * MIN, joined: JOINED, task: TASK }]);
    expect(nudgesDue(state, now)).toEqual([]);
    expect(clockOf(state, state.tasks.get(TASK)!, now)?.paged).toBe(false);
  });

  test("without a task on the wait the clock runs as before", () => {
    const ms = [...doing(), take(5, 5 * MIN, "mac", 60), take(6, JOINED, "win", 30)];
    expect(dueFor(ms, JOINED + QUIET_MS)).toEqual([expect.objectContaining({ step: 1, mover: "win" })]);
  });

  test("one seat with two tasks: only the task on the wait goes quiet-free", () => {
    const ms = [
      ...doing(),
      event(OTHER, 2_000, "jow", { op: "task.add", title: "Fix the docs", owner: "win" }),
      event(4, 3_000, "win", { op: "task.update", task: OTHER, state: "doing" }),
      take(5, 5 * MIN, "mac", 60),
      take(6, JOINED, "win", 30, TASK),
    ];
    const now = JOINED + QUIET_MS + MIN;
    expect(dueFor(ms, now, TASK)).toEqual([]);
    expect(dueFor(ms, now, OTHER)).toEqual([expect.objectContaining({ task: OTHER, step: 1, mover: "win" })]);
  });

  test("the clock resumes from the moment the holder lets go and the seat acquires it", () => {
    const handed = 40 * MIN;
    const ms = [...queued(), free(7, handed, "mac")];
    expect(foldAt(ms, handed + MIN).leases.get("build")).toMatchObject({ holder: "win", since: handed });
    expect(dueFor(ms, handed + QUIET_MS - MIN)).toEqual([]);
    const now = handed + QUIET_MS + MIN;
    expect(dueFor(ms, now)).toEqual([expect.objectContaining({ step: 1, mover: "win" })]);
    const state = foldAt(ms, now);
    expect(clockOf(state, state.tasks.get(TASK)!, now)).toMatchObject({ mover: "win", since: handed, paged: true });
  });

  test("the clock resumes when the lock passes to the seat as the holder's lease runs out", () => {
    const ranOut = 5 * MIN + HOUR;
    expect(dueFor(queued(), ranOut + QUIET_MS - MIN)).toEqual([]);
    const now = ranOut + QUIET_MS + MIN;
    const state = foldAt(queued(), now);
    expect(state.leases.get("build")).toMatchObject({ holder: "win", since: ranOut });
    expect(clockOf(state, state.tasks.get(TASK)!, now)).toMatchObject({ since: ranOut, paged: true });
    expect(dueFor(queued(), now)).toEqual([expect.objectContaining({ step: 1, mover: "win" })]);
  });

  test("the clock resumes from the moment the seat leaves the line", () => {
    const left = 25 * MIN;
    const ms = [...queued(), free(7, left, "win")];
    expect(dueFor(ms, left + QUIET_MS - MIN)).toEqual([]);
    const now = left + QUIET_MS + MIN;
    const state = foldAt(ms, now);
    expect(clockOf(state, state.tasks.get(TASK)!, now)).toMatchObject({ since: left, paged: true });
    expect(dueFor(ms, now)).toEqual([expect.objectContaining({ step: 1, mover: "win" })]);
  });

  test("the clock resumes when the wait gives up at joined + LEASE_WAIT_MS, though the holder keeps renewing", () => {
    const renewals = [0, 1, 2, 3, 4].map((n) => take(7 + n, 5 * MIN + (n + 1) * 25 * MIN, "mac", 60));
    const ms = [...queued(), ...renewals];
    const gaveUp = JOINED + LEASE_WAIT_MS;
    expect(
      foldAt(ms, gaveUp - MIN)
        .leases.get("build")
        ?.queue.map((q) => q.name),
    ).toEqual(["win"]);
    expect(dueFor(ms, gaveUp - MIN)).toEqual([]);
    expect(dueFor(ms, gaveUp + QUIET_MS - MIN)).toEqual([]);
    const now = gaveUp + QUIET_MS + MIN;
    const state = foldAt(ms, now);
    expect(state.leases.get("build")).toMatchObject({ holder: "mac", queue: [] });
    expect(clockOf(state, state.tasks.get(TASK)!, now)).toMatchObject({ since: gaveUp, paged: true });
    expect(dueFor(ms, now)).toEqual([expect.objectContaining({ step: 1, mover: "win" })]);
  });

  test("an event after the wait gave up keeps the restart at the give-up time", () => {
    const gaveUp = JOINED + LEASE_WAIT_MS;
    const renewals = [0, 1, 2, 3, 4, 5].map((n) => take(7 + n, 5 * MIN + (n + 1) * 25 * MIN, "mac", 60));
    const ms = [...queued(), ...renewals];
    expect(renewals.at(-1)!.ts).toBeGreaterThan(gaveUp);
    const now = renewals.at(-1)!.ts + MIN;
    const state = foldAt(ms, now);
    expect(clockOf(state, state.tasks.get(TASK)!, now)).toMatchObject({ since: gaveUp, paged: true });
  });

  test("the live fold agrees with a whole fold across the wait and its end", () => {
    const left = 25 * MIN;
    const ms = [...queued(), free(7, left, "win")];
    const live = folded(ms.slice(0, 6), roster, JOINED + MIN);
    const during = live.next([], JOINED + QUIET_MS + MIN)!;
    expect(nudgesDue(during, JOINED + QUIET_MS + MIN)).toEqual([]);
    const now = left + QUIET_MS + MIN;
    const after = live.next(ms.slice(6), now)!;
    expect(clockOf(after, after.tasks.get(TASK)!, now)).toEqual(clockOf(foldAt(ms, now), foldAt(ms, now).tasks.get(TASK)!, now));
  });

  test("a fold resumed from a snapshot base taken mid-wait agrees with the whole log", () => {
    const left = 25 * MIN;
    const ms = [...queued(), free(7, left, "win")];
    let base: FoldBase | null = null;
    fold(ms.slice(0, 4), roster, JOINED + MIN, null, null, null, (b) => {
      base = b;
    });
    expect(base!.leases[0]?.queue).toEqual([expect.objectContaining({ name: "win", task: TASK })]);
    const now = left + QUIET_MS + MIN;
    const resumed = fold(ms, roster, now, null, null, base);
    const whole = fold(ms, roster, now);
    expect(clockOf(resumed, resumed.tasks.get(TASK)!, now)).toEqual(clockOf(whole, whole.tasks.get(TASK)!, now));
    expect(clockOf(resumed, resumed.tasks.get(TASK)!, now)).toMatchObject({ since: left, paged: true });
  });

  test("a wait that names a closed or missing task is refused", () => {
    const ms = [...doing(), take(5, 5 * MIN, "mac", 60), take(6, JOINED, "win", 30, 99)];
    const state = foldAt(ms, JOINED + MIN);
    expect(state.rejected.get(6)).toBe("no open task T99 for a lock wait");
    expect(state.leases.get("build")?.queue).toEqual([]);
  });

  test("the task is checked on the wire", () => {
    expect(wellFormedEvent({ op: "lease.take", name: "build", ttl: 600, task: 7 })).toBe(true);
    expect(wellFormedEvent({ op: "lease.take", name: "build", ttl: 600, task: "T7" })).toBe(false);
    expect(wellFormedEvent({ op: "lease.take", name: "build", ttl: 600, task: -1 })).toBe(false);
  });
});
