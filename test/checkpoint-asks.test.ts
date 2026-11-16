import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type CheckpointOwed, type Event, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { describeEvent } from "@kiwi/core/format.ts";
import { leadCheckpointKey } from "@kiwi/core/state/lead.ts";
import { checkpointAskFor, checkpointAskStatus, owedBy, CHECKPOINT_ASK_TTL_MS } from "@kiwi/core/state/checkpoint-asks.ts";
import { CHECKPOINT_WINDOW_MS, dueOn, nextOccurrence, withinWindow } from "@kiwi/core/checkpoint-schedule.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
const T0 = Date.parse("2026-11-16T20:00:00Z");

async function put(from: string, p: Partial<Payload>, rts = T0 + seq * 1000, rocc?: string): Promise<Message> {
  seq++;
  const signed = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "msg" as const, body: "", ts: rts, ...p } as Payload);
  return { ...signed, seq, rts, ...(rocc ? { rocc } : {}), sigOk: await verify(signed) };
}
const ev = (from: string, e: Event, rts?: number, rocc?: string) => put(from, { kind: "event", ev: e }, rts, rocc);
const addTask = (title: string, owner: string) => ev("jon", { op: "task.add", title, owner });
const checkpoint = (from: string, task: number) => ev(from, { op: "task.update", task, note: "branch x, next y", checkpoint: true });
const leadCheckpoint = (from: string) => ev(from, { op: "fact.set", key: leadCheckpointKey(from), value: "where the channel stands" });
const ask = (from: string, asks: CheckpointOwed[], unreachable: string[] = [], occurrence?: string, rts?: number, stamp: string | null = occurrence ?? null) =>
  ev(from, { op: "checkpoint.ask", asks, unreachable, ...(occurrence ? { occurrence } : {}) }, rts, stamp ?? undefined);
const daily = { at: "18:00", tz: "America/Sao_Paulo" };
const DUE = Date.parse("2026-11-16T21:00:00Z");

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "owl", "win", "fox"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "owl", pk: ids.owl!.pk, owner: false, at: 1, active: true, kind: "agent", role: "lead" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "fox", pk: ids.fox!.pk, owner: false, at: 3, active: true, kind: "agent" },
  ];
});

describe("the ops are well formed", () => {
  const base = { v: 1 as const, id: "x", from: "jon", body: "", ts: 1, sig: "s", pk: "p", kind: "event" as const };
  test("checkpoint.daily.set takes a time and a known IANA zone, or null", () => {
    expect(wellFormed({ ...base, ev: { op: "checkpoint.daily.set", daily } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "checkpoint.daily.set", daily: null } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "checkpoint.daily.set", daily: { at: "24:00", tz: "UTC" } } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "checkpoint.daily.set", daily: { at: "18:00", tz: "Mars/Olympus" } } })).toBe(false);
  });

  test("checkpoint.ask names each agent once, with at least one item each", () => {
    expect(wellFormed({ ...base, ev: { op: "checkpoint.ask", asks: [{ agent: "win", tasks: [3] }], unreachable: ["fox"] } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "checkpoint.ask", asks: [{ agent: "win", tasks: [] }], unreachable: [] } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "checkpoint.ask", asks: [{ agent: "win", tasks: [3] }], unreachable: ["win"] } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "checkpoint.ask", asks: [], unreachable: [] } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "checkpoint.ask", asks: [{ agent: "owl", tasks: [], lead: true }], unreachable: [], occurrence: "2026-11-16T18:00" } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "checkpoint.ask", asks: [{ agent: "owl", tasks: [], lead: true }], unreachable: [], occurrence: "tonight" } })).toBe(false);
  });
});

describe("the schedule's clock", () => {
  test("a local time that doesn't exist fires at the first instant after the gap", () => {
    expect(dueOn("2026-03-08", "02:30", "America/New_York")).toBe(Date.parse("2026-03-08T07:00:00Z"));
    expect(dueOn("2026-03-29", "01:30", "Europe/London")).toBe(Date.parse("2026-03-29T01:00:00Z"));
  });

  test("a local time that repeats fires once, at its first occurrence", () => {
    expect(dueOn("2026-11-01", "01:30", "America/New_York")).toBe(Date.parse("2026-11-01T05:30:00Z"));
    const after = nextOccurrence({ at: "01:30", tz: "America/New_York" }, Date.parse("2026-11-01T05:30:00Z"));
    expect(after.id).toBe("2026-11-02T01:30");
  });

  test("the next occurrence is today's when it's still ahead, else tomorrow's", () => {
    expect(nextOccurrence(daily, DUE - 1)).toEqual({ id: "2026-11-16T18:00", due: DUE });
    expect(nextOccurrence(daily, DUE).id).toBe("2026-11-17T18:00");
  });

  test("the window opens at the time and closes five minutes later", () => {
    expect(withinWindow(daily, "2026-11-16T18:00", DUE - 1)).toBe(false);
    expect(withinWindow(daily, "2026-11-16T18:00", DUE)).toBe(true);
    expect(withinWindow(daily, "2026-11-16T18:00", DUE + CHECKPOINT_WINDOW_MS - 1)).toBe(true);
    expect(withinWindow(daily, "2026-11-16T18:00", DUE + CHECKPOINT_WINDOW_MS)).toBe(false);
    expect(withinWindow(daily, "2026-11-16T19:00", DUE + 60 * 60_000)).toBe(false);
  });
});

describe("the daily setting", () => {
  test("is off by default and only the owner sets it", async () => {
    expect(fold([], roster).checkpointDaily).toBeNull();
    const byAgent = await ev("owl", { op: "checkpoint.daily.set", daily });
    expect(fold([byAgent], roster).checkpointDaily).toBeNull();
    const byOwner = await ev("jon", { op: "checkpoint.daily.set", daily });
    expect(fold([byOwner], roster).checkpointDaily).toEqual(daily);
    expect(fold([byOwner, await ev("jon", { op: "checkpoint.daily.set", daily: null })], roster).checkpointDaily).toBeNull();
  });

  test("reads as words", async () => {
    expect(describeEvent(await ev("jon", { op: "checkpoint.daily.set", daily }))).toContain("18:00 (America/Sao_Paulo)");
    expect(describeEvent(await ev("jon", { op: "checkpoint.daily.set", daily: null }))).toContain("turned off");
  });
});

describe("a manual request", () => {
  test("the owner may ask; an agent may not", async () => {
    const t = await addTask("Ship it", "win");
    const byOwner = await ask("jon", [{ agent: "win", tasks: [t.seq] }]);
    const byAgent = await ask("owl", [{ agent: "win", tasks: [t.seq] }]);
    const state = fold([t, byOwner, byAgent], roster);
    expect(state.checkpointAsks.map((a) => a.seq)).toEqual([byOwner.seq]);
    expect(state.rejected.get(byAgent.seq)).toContain("only the owner");
  });

  test("a person or a departed name can't be asked", async () => {
    const t = await addTask("Ship it", "win");
    const asked = await ask("jon", [{ agent: "jon", tasks: [t.seq] }]);
    expect(fold([t, asked], roster).rejected.get(asked.seq)).toContain("isn't an agent");
    const ghost = await ask("jon", [], ["nobody"]);
    expect(fold([ghost], roster).rejected.get(ghost.seq)).toContain("no member named nobody");
  });

  test("reads as words, naming who was asked", async () => {
    expect(describeEvent(await ask("jon", [{ agent: "win", tasks: [1] }]))).toBe("asked win to write their checkpoints");
    expect(describeEvent(await ask("jon", [], ["fox"]))).toContain("no agent with open work was running");
  });
});

describe("saved means every item the request froze", () => {
  test("an agent with two tasks stays pending, naming the missing one, until both are saved", async () => {
    const a = await addTask("One", "win");
    const b = await addTask("Two", "win");
    const req = await ask("jon", [{ agent: "win", tasks: [a.seq, b.seq] }]);
    const first = await checkpoint("win", a.seq);
    let state = fold([a, b, req, first], roster);
    const [win] = checkpointAskStatus(state, state.checkpointAsks[0]!);
    expect(win).toEqual({
      agent: "win",
      reach: "asked",
      saved: false,
      items: [
        { kind: "task", task: a.seq, state: "saved" },
        { kind: "task", task: b.seq, state: "pending" },
      ],
    });
    expect(owedBy(state, "win", T0)).toMatchObject({ tasks: [b.seq], lead: false });
    state = fold([a, b, req, first, await checkpoint("win", b.seq)], roster);
    expect(checkpointAskStatus(state, state.checkpointAsks[0]!)[0]).toMatchObject({ saved: true });
    expect(owedBy(state, "win", T0)).toBeNull();
  });

  test("a checkpoint from before the request doesn't count", async () => {
    const a = await addTask("One", "win");
    const early = await checkpoint("win", a.seq);
    const req = await ask("jon", [{ agent: "win", tasks: [a.seq] }]);
    const state = fold([a, early, req], roster);
    expect(checkpointAskStatus(state, state.checkpointAsks[0]!)[0]).toMatchObject({ saved: false });
  });

  test("a lead with task work is saved only after both its task and its channel checkpoint", async () => {
    const a = await addTask("Lead's own", "owl");
    const req = await ask("jon", [{ agent: "owl", tasks: [a.seq], lead: true }]);
    const task = await checkpoint("owl", a.seq);
    let state = fold([a, req, task], roster);
    expect(checkpointAskStatus(state, state.checkpointAsks[0]!)[0]).toMatchObject({
      saved: false,
      items: [
        { kind: "task", state: "saved" },
        { kind: "lead", state: "pending" },
      ],
    });
    expect(owedBy(state, "owl", T0)).toMatchObject({ tasks: [], lead: true });
    state = fold([a, req, task, await leadCheckpoint("owl")], roster);
    expect(checkpointAskStatus(state, state.checkpointAsks[0]!)[0]).toMatchObject({ saved: true });
  });

  test("a task closed before its checkpoint leaves the required set and shows as closed", async () => {
    const a = await addTask("One", "win");
    const b = await addTask("Two", "win");
    const req = await ask("jon", [{ agent: "win", tasks: [a.seq, b.seq] }]);
    const closed = await ev("jon", { op: "task.update", task: b.seq, state: "cancelled", note: "not needed" });
    const state = fold([a, b, req, closed, await checkpoint("win", a.seq)], roster);
    expect(checkpointAskStatus(state, state.checkpointAsks[0]!)[0]).toMatchObject({ saved: true, items: [{ state: "saved" }, { task: b.seq, state: "closed" }] });
  });

  test("agents that weren't running are listed unreachable and owe nothing", async () => {
    const a = await addTask("One", "fox");
    const req = await ask("jon", [], ["fox"]);
    const state = fold([a, req], roster);
    expect(checkpointAskStatus(state, state.checkpointAsks[0]!)).toEqual([{ agent: "fox", reach: "unreachable" }]);
    expect(owedBy(state, "fox", T0)).toBeNull();
  });

  test("a request older than a day no longer nudges", async () => {
    const a = await addTask("One", "win");
    const req = await ask("jon", [{ agent: "win", tasks: [a.seq] }]);
    const state = fold([a, req], roster);
    expect(owedBy(state, "win", req.rts!)).not.toBeNull();
    expect(owedBy(state, "win", req.rts! + CHECKPOINT_ASK_TTL_MS)).toBeNull();
  });
});

describe("the daily request takes its authority from the schedule's occurrence", () => {
  test("any member's client may build it inside the window, and it reads as the daily one", async () => {
    const set = await ev("jon", { op: "checkpoint.daily.set", daily });
    const a = await addTask("One", "win");
    const req = await ask("fox", [{ agent: "win", tasks: [a.seq] }], [], "2026-11-16T18:00", DUE + 1000);
    const state = fold([set, a, req], roster);
    expect(state.checkpointAsks.map((r) => r.occurrence)).toEqual(["2026-11-16T18:00"]);
    expect(describeEvent(req)).toBe("made the daily checkpoint request: asked win to write their checkpoints");
  });

  test("two clients answering one occurrence give one request", async () => {
    const set = await ev("jon", { op: "checkpoint.daily.set", daily });
    const a = await addTask("One", "win");
    const one = await ask("fox", [{ agent: "win", tasks: [a.seq] }], [], "2026-11-16T18:00", DUE + 1000);
    const two = await ask("owl", [{ agent: "win", tasks: [a.seq] }], [], "2026-11-16T18:00", DUE + 2000);
    const state = fold([set, a, one, two], roster);
    expect(state.checkpointAsks.map((r) => r.seq)).toEqual([one.seq]);
    expect(state.rejected.get(two.seq)).toContain("already made");
  });

  test("late, early, off or for another time, it's refused, and naming a day gives no authority", async () => {
    const set = await ev("jon", { op: "checkpoint.daily.set", daily });
    const owed = [{ agent: "win", tasks: [1] }];
    const late = await ask("fox", owed, [], "2026-11-16T18:00", DUE + CHECKPOINT_WINDOW_MS);
    const early = await ask("fox", owed, [], "2026-11-16T18:00", DUE - 1000);
    const other = await ask("fox", owed, [], "2026-11-16T19:00", DUE + 60 * 60_000);
    const state = fold([set, late, early, other], roster);
    expect(state.checkpointAsks).toEqual([]);
    expect(state.rejected.get(late.seq)).toContain("outside its time");
    const unset = await ask("jon", owed, [], "2026-11-16T18:00", DUE + 1000);
    expect(fold([unset], roster).rejected.get(unset.seq)).toContain("no daily checkpoint time");
  });

  test("only the message the relay took for that occurrence counts: no stamp, or another time's, is refused", async () => {
    const set = await ev("jon", { op: "checkpoint.daily.set", daily });
    const owed = [{ agent: "win", tasks: [1] }];
    const unstamped = await ask("jon", owed, [], "2026-11-16T18:00", DUE + 1000, null);
    const elsewhere = await ask("jon", owed, [], "2026-11-16T18:00", DUE + 2000, "2026-11-15T18:00");
    const taken = await ask("fox", owed, [], "2026-11-16T18:00", DUE + 3000);
    const state = fold([set, unstamped, elsewhere, taken], roster);
    expect(state.rejected.get(unstamped.seq)).toContain("the relay didn't take this message");
    expect(state.rejected.get(elsewhere.seq)).toContain("the relay didn't take this message");
    expect(state.checkpointAsks.map((a) => a.seq)).toEqual([taken.seq]);
  });
});

describe("building a request from the board and who is running", () => {
  test("running agents with open work are asked for each open task, the lead for its channel checkpoint too; the rest are listed unreachable", async () => {
    const a = await addTask("Win's", "win");
    const b = await addTask("Win's other", "win");
    const c = await addTask("Fox's", "fox");
    const d = await addTask("Done one", "win");
    const state = fold([a, b, c, d, await ev("jon", { op: "task.update", task: d.seq, state: "done", note: "landed" })], roster);
    expect(checkpointAskFor(state, (name) => name !== "fox")).toEqual({
      asks: [
        { agent: "owl", tasks: [], lead: true },
        { agent: "win", tasks: [a.seq, b.seq] },
      ],
      unreachable: ["fox"],
    });
  });

  test("people are never asked, and with no agent owing anything there's nothing to send", async () => {
    const mine = await addTask("The owner's own", "jon");
    const noLead = roster.map((m) => (m.name === "owl" ? { ...m, role: undefined } : m));
    expect(checkpointAskFor(fold([mine], noLead), () => true)).toBeNull();
  });

  test("what it builds is a request the fold accepts", async () => {
    const a = await addTask("Win's", "win");
    const state = fold([a], roster);
    const body = checkpointAskFor(state, (name) => name === "win");
    const req = await ask("jon", body!.asks, body!.unreachable);
    expect(fold([a, req], roster).checkpointAsks.map((r) => r.seq)).toEqual([req.seq]);
  });
});
