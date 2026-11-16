import { describe, expect, test } from "bun:test";
import { clockOf, nudgesDue } from "@kiwi/core/clock.ts";
import { describeEvent, formatTask } from "@kiwi/core/format.ts";
import { moverOf, moverTag } from "@kiwi/core/mover.ts";
import { wellFormedEvent, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { QUIET_MS } from "@kiwi/core/state/clocks.ts";

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human" },
  { name: "owl", pk: "pk-owl", owner: false, at: 0, active: true, kind: "agent", role: "lead" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent" },
  { name: "mac", pk: "pk-mac", owner: false, at: 0, active: true, kind: "agent" },
];

const MIN = 60_000;
const TASK = 1;
const event = (seq: number, at: number, from: string, ev: Event): Message =>
  ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev, ts: at, rts: at }) as Message;
const post = (seq: number, at: number, from: string, task?: number): Message =>
  ({ v: 1, id: `m${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "msg", body: "progress", ts: at, rts: at, ...(task !== undefined ? { task } : {}) }) as Message;

const doing = (): Message[] => [
  event(TASK, 0, "jow", { op: "task.add", title: "Resume the job once load drops", owner: "win" }),
  event(2, 1_000, "win", { op: "task.update", task: TASK, state: "doing" }),
];
const wait = (seq: number, at: number, until?: number, from = "win"): Message =>
  event(seq, at, from, { op: "task.wait", task: TASK, reason: "until load < 65% on 2 reads (#123)", ...(until !== undefined ? { until } : {}) });

describe("a task-level wait on a step-less task", () => {
  test("is well formed only with a one-line reason, and is not a quiet event", () => {
    expect(wellFormedEvent({ op: "task.wait", task: 1, reason: "load" })).toBe(true);
    expect(wellFormedEvent({ op: "task.wait", task: 1, reason: "load", until: 5 })).toBe(true);
    expect(wellFormedEvent({ op: "task.wait", task: 1, reason: " " })).toBe(false);
    expect(wellFormedEvent({ op: "task.wait", task: 1, reason: "two\nlines" })).toBe(false);
    expect(wellFormedEvent({ op: "task.wait.end", task: 1 })).toBe(true);
    expect(describeEvent(wait(3, 2_000))).toBe("marked T1 waiting: until load < 65% on 2 reads (#123)");
  });

  test("pauses the clock: nobody's move, the board and the task show waiting, and no quiet mark comes due", () => {
    const now = 10 * QUIET_MS;
    const state = fold([...doing(), wait(3, 2_000)], roster, now);
    const t = state.tasks.get(TASK)!;
    expect(t.steps).toBeUndefined();
    expect(t.wait).toMatchObject({ reason: "until load < 65% on 2 reads (#123)", by: "win", seq: 3 });
    expect(moverOf(state, t, now)).toEqual({ kind: "wait", reason: "until load < 65% on 2 reads (#123)" });
    expect(moverTag(t, moverOf(state, t, now))).toBe(" · waiting: until load < 65% on 2 reads (#123)");
    expect(clockOf(state, t, now)).toBeUndefined();
    expect(nudgesDue(state, now)).toEqual([]);
    const shown = formatTask(state, t, now);
    expect(shown).toContain("move: nobody: waiting: until load < 65% on 2 reads (#123)");
    expect(shown).not.toContain("quiet");
  });

  test("--end puts it back on the clock from that moment, not from when it started waiting", () => {
    const end = event(4, 50 * MIN, "win", { op: "task.wait.end", task: TASK });
    const state = fold([...doing(), wait(3, 2_000), end], roster, 60 * MIN);
    const t = state.tasks.get(TASK)!;
    expect(t.wait).toBeUndefined();
    expect(clockOf(state, t, 60 * MIN)).toMatchObject({ mover: "win", since: 50 * MIN, quiet: 10 * MIN });
    expect(describeEvent(end)).toBe("ended the wait on T1");
  });

  test("--until runs out at its deadline: the clock restarts there, and its first mark says the wait ran out", () => {
    const until = 30 * MIN;
    const during = fold([...doing(), wait(3, 2_000, until)], roster, until - MIN);
    expect(moverOf(during, during.tasks.get(TASK)!, until - MIN)).toMatchObject({ kind: "wait", until, left: MIN });
    const now = until + QUIET_MS + MIN;
    const after = fold([...doing(), wait(3, 2_000, until)], roster, now);
    const t = after.tasks.get(TASK)!;
    expect(clockOf(after, t, now)).toMatchObject({ mover: "win", since: until });
    const due = nudgesDue(after, now);
    expect(due).toEqual([expect.objectContaining({ task: TASK, step: 1, waited: "until load < 65% on 2 reads (#123)" })]);
    const mark = event(9, now, "win", { op: "task.nudge", task: TASK, mover: due[0]!.mover, since: due[0]!.since, step: 1, waited: due[0]!.waited! });
    expect(describeEvent(mark)).toBe("marked T1 quiet with win: a wake is attempted; its wait ran out: until load < 65% on 2 reads (#123)");
    const marked = fold([...doing(), wait(3, 2_000, until), mark], roster, now + QUIET_MS);
    expect(nudgesDue(marked, now + QUIET_MS).every((d) => d.waited === undefined)).toBe(true);
  });

  test("a post by its mover in the task's thread ends it; posts elsewhere, or by someone else, leave it", () => {
    const elsewhere = post(4, 5 * MIN, "win");
    const someoneElse = post(5, 6 * MIN, "mac", TASK);
    const kept = fold([...doing(), wait(3, 2_000), elsewhere, someoneElse], roster, 10 * MIN);
    expect(kept.tasks.get(TASK)!.wait).toBeDefined();
    const mine = post(6, 7 * MIN, "win", TASK);
    const ended = fold([...doing(), wait(3, 2_000), elsewhere, someoneElse, mine], roster, 10 * MIN);
    const t = ended.tasks.get(TASK)!;
    expect(t.wait).toBeUndefined();
    expect(clockOf(ended, t, 10 * MIN)).toMatchObject({ mover: "win", since: 7 * MIN });
  });

  test("its owner, the lead or a person sets it; another agent can't, and ending one that isn't there is refused", () => {
    const state = fold([...doing(), wait(3, 2_000, undefined, "mac"), event(4, 3_000, "win", { op: "task.wait.end", task: TASK })], roster, 4_000);
    expect(state.rejected.get(3)).toBe("only T1's owner, the lead or a person sets or ends its wait");
    expect(state.rejected.get(4)).toBe("T1 isn't waiting");
    const byLead = fold([...doing(), wait(3, 2_000, undefined, "owl")], roster, 4_000);
    expect(byLead.tasks.get(TASK)!.wait?.by).toBe("owl");
    const past = fold([...doing(), wait(3, 2_000, 1_000)], roster, 4_000);
    expect(past.rejected.get(3)).toBe("the wait on T1 would already be over");
  });

  test("a question to a person that holds the task still comes first: the wait doesn't hide it", () => {
    const ask = { v: 1, id: "q4", seq: 4, from: "win", pk: "pk-win", sigOk: true, kind: "ask", body: "go on?", to: ["jow"], holds: [TASK], ts: 3_000, rts: 3_000 } as Message;
    const state = fold([...doing(), wait(3, 2_000), ask], roster, 5_000);
    const t = state.tasks.get(TASK)!;
    expect(t.clock?.key).toBe("?4");
    expect(moverOf(state, t, 5_000)).toMatchObject({ kind: "member", question: 4 });
  });

  test("what the hook and the checkpoint request write on their own doesn't end it: the Stop snapshot and a checkpoint keep the wait", () => {
    const snapshot = event(4, 3 * MIN, "win", { op: "task.snapshot", task: TASK, path: "/home/www/repo-T1", branch: "T1-resume", head: "a".repeat(40), subject: "pause the job", dirty: ["wip.ts"] });
    const checkpoint = event(5, 4 * MIN, "win", { op: "task.update", task: TASK, note: "waiting on the load to drop", checkpoint: true });
    const state = fold([...doing(), wait(3, 2_000), snapshot, checkpoint], roster, 10 * MIN);
    expect(state.rejected.size).toBe(0);
    expect(state.tasks.get(TASK)!.wait).toMatchObject({ seq: 3 });
    expect(moverOf(state, state.tasks.get(TASK)!, 10 * MIN)).toMatchObject({ kind: "wait" });
    const note = event(6, 5 * MIN, "win", { op: "task.update", task: TASK, note: "load is down, resuming" });
    expect(fold([...doing(), wait(3, 2_000), snapshot, checkpoint, note], roster, 10 * MIN).tasks.get(TASK)!.wait).toBeUndefined();
  });

  test("on a task with no owner the lead has the move, so the lead's post ends it, and nobody else's does", () => {
    const open = (): Message[] => [event(TASK, 0, "jow", { op: "task.add", title: "Resume the job once load drops" }), wait(2, 1_000, undefined, "jow")];
    const kept = fold([...open(), post(3, 2 * MIN, "mac", TASK)], roster, 5 * MIN);
    expect(moverOf(kept, kept.tasks.get(TASK)!, 5 * MIN)).toMatchObject({ kind: "wait" });
    const ended = fold([...open(), post(3, 2 * MIN, "mac", TASK), post(4, 3 * MIN, "owl", TASK)], roster, 5 * MIN);
    expect(ended.tasks.get(TASK)!.wait).toBeUndefined();
    expect(moverOf(ended, ended.tasks.get(TASK)!, 5 * MIN)).toMatchObject({ kind: "member", name: "owl", move: "assign" });

    const moved: Roster = roster.map((r) => (r.name === "owl" ? { ...r, role: undefined } : r.name === "mac" ? { ...r, role: "lead" } : r));
    expect(fold([...open(), post(3, 2 * MIN, "owl", TASK)], moved, 5 * MIN).tasks.get(TASK)!.wait).toBeDefined();
    expect(fold([...open(), post(3, 2 * MIN, "mac", TASK)], moved, 5 * MIN).tasks.get(TASK)!.wait).toBeUndefined();

    const gone: Roster = roster.map((r) => (r.name === "owl" ? { ...r, active: false } : r));
    expect(fold([...open(), post(3, 2 * MIN, "jow", TASK)], gone, 5 * MIN).tasks.get(TASK)!.wait).toBeUndefined();
  });

  test("a lead signed through its persona is the lead whose post ends it, the same one the board shows with the move (#11503)", () => {
    const persona = { name: "Lead", role: "lead" as const, capabilities: [], areas: [], instructions: "" };
    const signed: Roster = roster.map((r) => (r.name === "owl" ? { ...r, role: undefined } : r.name === "mac" ? { ...r, persona } : r));
    const open = (): Message[] => [event(TASK, 0, "jow", { op: "task.add", title: "Resume the job once load drops" }), wait(2, 1_000, undefined, "jow")];
    const kept = fold([...open(), post(3, 2 * MIN, "owl", TASK)], signed, 5 * MIN);
    expect(kept.lead).toBe("mac");
    expect(kept.tasks.get(TASK)!.wait).toBeDefined();
    const ended = fold([...open(), post(3, 2 * MIN, "owl", TASK), post(4, 3 * MIN, "mac", TASK)], signed, 5 * MIN);
    expect(ended.tasks.get(TASK)!.wait).toBeUndefined();
    expect(moverOf(ended, ended.tasks.get(TASK)!, 5 * MIN)).toMatchObject({ kind: "member", name: "mac", move: "assign" });
  });

  test("a signed lead whose key is gone no longer ends it; the channel owner, who has the move then, does", () => {
    const persona = { name: "Lead", role: "lead" as const, capabilities: [], areas: [], instructions: "" };
    const signed: Roster = roster.map((r) => (r.name === "owl" ? { ...r, role: undefined } : r.name === "mac" ? { ...r, persona } : r));
    const open = (): Message[] => [
      event(TASK, 0, "jow", { op: "task.add", title: "Resume the job once load drops" }),
      wait(2, 1_000, undefined, "jow"),
      event(3, 2_000, "jow", { op: "member.gone", member: "mac", pk: "pk-mac" }),
    ];
    const kept = fold([...open(), post(4, 2 * MIN, "mac", TASK)], signed, 5 * MIN);
    expect([...kept.rejected]).toEqual([[4, "sent after its key was removed"]]);
    expect(kept.lead).toBeNull();
    expect(kept.tasks.get(TASK)!.wait).toBeDefined();
    const ended = fold([...open(), post(4, 2 * MIN, "mac", TASK), post(5, 3 * MIN, "jow", TASK)], signed, 5 * MIN);
    expect(ended.tasks.get(TASK)!.wait).toBeUndefined();
    expect(moverOf(ended, ended.tasks.get(TASK)!, 5 * MIN)).toMatchObject({ kind: "member", name: "jow", move: "assign" });
  });
});
