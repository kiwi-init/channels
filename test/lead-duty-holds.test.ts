import { beforeAll, describe, expect, test } from "bun:test";
import type { CheckArtifact } from "@kiwi/core/checks.ts";
import { heldSteps, offDutyLines, takenOverLines } from "@kiwi/core/duty.ts";
import { stepLines } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { CHECKPOINT_MAX_LENGTH, EVENT_OPS_VERSION, FOLD_RULES, HANDOVER_CHECKPOINT_OPS, PROTOCOL_VERSION, wellFormed, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { omit } from "@kiwi/core/omit.ts";
import { reentryText } from "@kiwi/core/reentry.ts";
import { fold, handedOver, type ChannelState, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { QUIET_MS } from "@kiwi/core/state/clocks.ts";
import { currentStep, landedStepRefusal, stepById, stepMove, timedOf, type StepEdit, type StepSpec } from "@kiwi/core/steps.ts";
import { handLines } from "../src/cli/commands/lead.ts";

const T0 = 1_760_000_000_000;
const R = "o/r";
const S1 = "1".repeat(40);
const M1 = "9".repeat(40);
const HOUR = 3_600_000;
const at = (s: number) => T0 + s * 1_000;
const MERGE: StepSpec = { words: "merge", detector: { kind: "pr-merged" } };
const prAt: CheckArtifact = { kind: "pr", repo: R, pr: 7, sha: S1 };

const ids: Record<string, Identity> = {};
let roster: Roster;
beforeAll(async () => {
  for (const n of ["jow", "lead", "spare", "zed", "ann", "mac"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 1, active: true, kind: "agent", role: "lead" },
    { name: "spare", pk: ids.spare!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "zed", pk: ids.zed!.pk, owner: false, at: 3, active: true, kind: "agent" },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: 4, active: true, kind: "agent" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 5, active: true, kind: "agent" },
  ];
});

async function channel() {
  const log: Message[] = [];
  const say = async (from: string, kind: Kind, body: string, extra: Partial<Pick<Message, "to" | "ev" | "re">> = {}, ops: number | null = EVENT_OPS_VERSION): Promise<Message> => {
    const seq = log.length + 1;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: at(seq), ...(ops !== null ? { ops } : {}), ...extra };
    const p = await sign(ids[from]!, payload);
    const m = { ...p, seq, rts: at(seq), sigOk: await verify(p) };
    log.push(m);
    return m;
  };
  const ev = (from: string, e: Event, ops: number | null = EVENT_OPS_VERSION) => say(from, "event", "", { ev: e }, ops);
  const github = (items: Record<string, unknown>[]) => ev("jow", { op: "github", items: items.map((i) => ({ repo: R, at: at(log.length + 1), ...i })) } as Event);
  const opened = (t: number) => github([{ event: "pull_request", action: "opened", number: 7, state: "open", branch: `T${t}-x`, sha: S1 }]);
  const merged = (t: number) => github([{ event: "pull_request", action: "closed", number: 7, state: "closed", merged: true, merge: M1, branch: `T${t}-x`, sha: S1, happened: at(log.length) }]);
  const state = (now = at(10_000)) => fold(log, roster, now);
  const task = async (steps: StepSpec[]): Promise<number> => (await ev("lead", { op: "task.add", title: "export", owner: "ann", review: "mac", steps })).seq;
  const approve = async (t: number) => {
    await ev("ann", { op: "task.update", task: t, state: "review", at: S1 });
    await ev("mac", { op: "task.update", task: t, state: "done", verdict: "approved", round: state().tasks.get(t)!.rounds.length, at: S1 });
  };
  const landed = (from: string, t: number, step: string, said: { artifact?: CheckArtifact } = {}) => ev(from, { op: "task.landed", task: t, step, ...said });
  const edit = (from: string, t: number, change: StepEdit) => ev(from, { op: "task.steps", task: t, edit: change });
  const hand = (from: string, to: string, checkpoint?: string, ops: number | null = EVENT_OPS_VERSION) =>
    ev(from, { op: "lead.duty", to, from: state().duty?.since ?? 0, ...(checkpoint !== undefined ? { checkpoint } : {}) }, ops);
  await ev("jow", { op: "repos.set", repos: [R] });
  await ev("jow", { op: "branch.prefix.set", prefix: "T" });
  await ev("jow", { op: "lead.standby", name: "spare", on: true });
  await ev("jow", { op: "lead.standby", name: "zed", on: true });
  return { log, ev, say, opened, merged, state, task, approve, landed, edit, hand };
}

function baseAt(log: Message[], cut: number, now = at(10_000)): FoldBase {
  let base: FoldBase | null = null;
  fold(log.slice(0, cut), roster, now, null, null, null, (b) => void (base = b));
  if (!base) throw new Error("no base");
  return base;
}

function resumedAt(log: Message[], cut: number, now = at(10_000)): ChannelState {
  return fold(log.slice(cut), roster, now, null, null, baseAt(log, cut, now));
}

const fromOlder = (base: FoldBase): FoldBase => ({ ...structuredClone(base), rules: FOLD_RULES - 1, checkpoint: null });

const withoutOps = (log: readonly Message[]): Message[] => log.map((m) => omit(m, "ops"));

const progressOf = (s: ChannelState, t: number, id: string) => stepById(s.tasks.get(t)!, id)!.progress;

describe("a step wait is timed or a hold, one mechanism", () => {
  test("a timed wait reads as timed; a hold replaces it, and a timed edit on a held step is refused", async () => {
    const c = await channel();
    const t = await c.task([{ words: "soak", by: "zed", wait: { reason: "soak in hml", ms: 24 * HOUR } }, MERGE]);
    expect(timedOf(stepById(c.state().tasks.get(t)!, "s1")!)).toMatchObject({ kind: "timed", reason: "soak in hml", ms: 24 * HOUR });
    const hold = await c.edit("lead", t, { kind: "hold", id: "s1", reason: "until the release notes are in" });
    expect(stepById(c.state().tasks.get(t)!, "s1")!.wait).toEqual({ kind: "hold", reason: "until the release notes are in", by: "lead", seq: hold.seq });
    const timed = await c.edit("zed", t, { kind: "wait", id: "s1", reason: "another day", ms: HOUR });
    expect(c.state().rejected.get(timed.seq)).toBe("step s1 “soak” of T" + t + " is held by lead; unhold it first");
    const twice = await c.edit("lead", t, { kind: "hold", id: "s1", reason: "again" });
    expect(c.state().rejected.get(twice.seq)).toContain("is already held by lead");
    const byAgent = await c.edit("zed", t, { kind: "unhold", id: "s1" });
    expect(c.state().rejected.get(byAgent.seq)).toContain("only the lead on duty or a person lifts the hold");
  });

  test("while held, the landing is refused from a command and from the client, and nobody is paged to deliver it", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    await c.approve(t);
    await c.edit("lead", t, { kind: "hold", id: "s1", reason: "until the release notes are in" });
    const said = await c.landed("ann", t, "s1");
    const s = c.state();
    expect(s.rejected.get(said.seq)).toBe(`step s1 “merge” of T${t} is held by lead: until the release notes are in`);
    expect(landedStepRefusal(s.tasks.get(t)!, "s1")).toBe(`step s1 “merge” of T${t} is held by lead: until the release notes are in`);
    expect(stepMove(currentStep(s.tasks.get(t)!)!, "ann", at(900))).toEqual({ kind: "held", by: "lead", reason: "until the release notes are in" });
    expect(stepLines(s, s.tasks.get(t)!, at(900)).join("\n")).toContain("held by lead: until the release notes are in");
  });
});

describe("a snapshot from before waits had a kind", () => {
  test("restores the shipped {reason, ms, until} wait as timed, with its deadline", async () => {
    const c = await channel();
    const t = await c.task([{ words: "soak", by: "zed", wait: { reason: "soak in hml", ms: 24 * HOUR } }, MERGE]);
    await c.approve(t);
    const wait = timedOf(stepById(c.state().tasks.get(t)!, "s1")!);
    const until = wait?.until;
    expect(until).toBeNumber();
    const older = fromOlder(baseAt(c.log, c.log.length));
    const task = older.tasks.find((x) => x.id === t)!;
    const [first, ...rest] = task.steps!;
    Object.assign(task, { steps: [{ ...first, wait: { reason: "soak in hml", ms: 24 * HOUR, until } }, ...rest] });
    const s = fold([], roster, at(10_000), null, null, older);
    expect(stepById(s.tasks.get(t)!, "s1")!.wait).toEqual({ kind: "timed", reason: "soak in hml", ms: 24 * HOUR, until });
    expect(stepById(s.tasks.get(t)!, "s2")!.wait).toBeUndefined();
  });
});

describe("a hold on delivery crosses a handover (#19397 boxes 9 and 10)", () => {
  test("A's hold is listed for B after A → B and on restore; A can't lift it, B can, and then the landing goes through", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    await c.approve(t);
    await c.edit("lead", t, { kind: "hold", id: "s1", reason: "until the release notes are in" });
    const out = await c.hand("lead", "spare", `T${t} is approved and held on its merge.`);
    expect(c.state().rejected.has(out.seq)).toBe(false);
    const log = [...c.log];
    for (let cut = 1; cut <= log.length; cut++) {
      const s = cut === log.length ? c.state() : resumedAt(log, cut);
      expect({ cut, lead: s.lead, holds: heldSteps(s).map((h) => [h.task.id, h.step.id, h.hold.by]) }).toEqual({ cut, lead: "spare", holds: [[t, "s1", "lead"]] });
    }
    expect(takenOverLines(c.state(), "spare", at(10_000)).join("\n")).toContain(`T${t} step s1 “merge”, held by lead`);
    const stale = await c.edit("lead", t, { kind: "unhold", id: "s1" });
    expect(c.state().rejected.get(stale.seq)).toContain("only the lead on duty or a person lifts the hold");
    const lift = await c.edit("spare", t, { kind: "unhold", id: "s1" });
    expect(c.state().rejected.has(lift.seq)).toBe(false);
    const land = await c.landed("ann", t, "s1");
    const s = c.state();
    expect(s.rejected.has(land.seq)).toBe(false);
    expect(s.tasks.get(t)!.state).toBe("done");
  });

  test("the hold survives the round trip A → B → A, and A lifts it once it is back on duty", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    await c.approve(t);
    await c.edit("lead", t, { kind: "hold", id: "s1", reason: "until the release notes are in" });
    await c.hand("lead", "spare", `T${t} held on its merge.`);
    await c.hand("spare", "lead", `T${t} still held on its merge.`);
    expect(heldSteps(c.state()).map((h) => h.hold.by)).toEqual(["lead"]);
    const lift = await c.edit("lead", t, { kind: "unhold", id: "s1" });
    expect(c.state().rejected.has(lift.seq)).toBe(false);
    expect(heldSteps(c.state())).toEqual([]);
  });

  test("a merge seen on GitHub while held is recorded, not delivered; B's lift ends the step with that evidence and time, also after a restore in between", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    await c.opened(t);
    await c.approve(t);
    await c.edit("lead", t, { kind: "hold", id: "s1", reason: "until the release notes are in" });
    await c.hand("lead", "spare", `T${t} held on its merge.`);
    await c.merged(t);
    const seen = await c.landed("jow", t, "s1", { artifact: prAt });
    const held = c.state();
    expect(held.rejected.has(seen.seq)).toBe(false);
    expect(held.tasks.get(t)!.state).toBe("landing");
    expect(progressOf(held, t, "s1")).toMatchObject({ kind: "open", seen: { seq: seen.seq, by: "jow", at: at(seen.seq) } });
    expect(stepLines(held, held.tasks.get(t)!, at(10_000)).join("\n")).toContain("held by lead: until the release notes are in; delivered outside Kiwi");
    const lift = await c.edit("spare", t, { kind: "unhold", id: "s1" });
    const log = [...c.log];
    const want = { state: "done", end: { kind: "ended", end: { how: "detected", by: "jow", seq: seen.seq, ts: at(seen.seq) } } };
    for (let cut = 1; cut <= log.length; cut++) {
      const s = cut === log.length ? c.state() : resumedAt(log, cut);
      expect({ cut, state: s.tasks.get(t)!.state, end: progressOf(s, t, "s1") }).toMatchObject({ cut, ...want });
    }
    expect(c.state().rejected.has(lift.seq)).toBe(false);
    expect(c.log.filter((m) => m.ev?.op === "task.landed").length).toBe(1);
  });
});

describe("a handover from a writer before the checkpoint rule folds as it did (#19397 box 11)", () => {
  test("handovers without a checkpoint, signed without ops or below the rule, keep the lead on duty on replay and from an older snapshot", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    const out = await c.hand("lead", "spare", undefined, HANDOVER_CHECKPOINT_OPS - 1);
    const back = await c.hand("spare", "lead", undefined, null);
    const log = [...c.log];
    expect([...c.state().rejected.values()]).toEqual([]);
    for (let cut = 1; cut <= log.length; cut++) {
      const resumed = cut === log.length ? c.state() : resumedAt(log, cut);
      const older = fold(log.slice(cut), roster, at(10_000), null, null, fromOlder(baseAt(log, cut)));
      expect({ cut, lead: resumed.lead, older: older.lead, since: older.duty?.since, refused: older.rejected.size }).toEqual({ cut, lead: "lead", older: "lead", since: back.seq, refused: 0 });
    }
    expect(c.state().checkpoint).toBeNull();
    expect(out.ops).toBe(HANDOVER_CHECKPOINT_OPS - 1);
    const now = await c.hand("lead", "zed");
    expect(c.state().rejected.get(now.seq)).toContain("hands over with a checkpoint");
    const ok = await c.hand("lead", "zed", `T${t} waits for review.`);
    expect(c.state().rejected.has(ok.seq)).toBe(false);
  });

  test("a handover valid under the new rule folds the same for a reader that ignores ops", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    await c.hand("lead", "spare", `T${t} waits for review.`);
    await c.hand("spare", "zed", `T${t} still waits.`);
    const now = c.state();
    const legacy = fold(withoutOps(c.log), roster, at(10_000));
    expect({ lead: legacy.lead, duty: legacy.duty, checkpoint: legacy.checkpoint, refused: legacy.rejected.size }).toEqual({ lead: now.lead, duty: now.duty, checkpoint: now.checkpoint, refused: 0 });
  });
});

describe("the checkpoint is channel state (#19397 box 11)", () => {
  test("the lead on duty can't hand over without a fresh checkpoint that names everything open", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    const ask = await c.say("ann", "blocking", handedOver("ann", "Which database?", {}), { to: ["lead"] });
    const none = await c.hand("lead", "spare");
    expect(c.state().rejected.get(none.seq)).toContain("hands over with a checkpoint");
    const short = await c.hand("lead", "spare", `T${t} waits for review.`);
    expect(c.state().rejected.get(short.seq)).toContain(`leaves out #${ask.seq}`);
    const ok = await c.hand("lead", "spare", `T${t} waits for review; #${ask.seq} is the database choice.`);
    const s = c.state();
    expect(s.rejected.has(ok.seq)).toBe(false);
    expect(s.checkpoint).toEqual({ text: `T${t} waits for review; #${ask.seq} is the database choice.`, by: "lead", seq: ok.seq, at: at(ok.seq) });
  });

  test("a person's move keeps the last checkpoint, which the next lead on duty reads with its age, before and after a restore", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    const out = await c.hand("lead", "spare", `T${t} waits for review.`);
    const person = await c.hand("jow", "zed");
    expect(c.state().rejected.has(person.seq)).toBe(false);
    const log = [...c.log];
    const now = at(out.seq) + 2 * HOUR;
    for (let cut = 1; cut <= log.length; cut++) {
      const s = cut === log.length ? c.state(now) : resumedAt(log, cut, now);
      expect({ cut, lead: s.lead, cp: s.checkpoint?.seq }).toEqual({ cut, lead: "zed", cp: out.seq });
    }
    const s = c.state(now);
    expect(reentryText(s, "zed", now)).toContain(`T${t} waits for review.`);
    expect(reentryText(s, "zed", now)).toContain("2h ago");
    expect(reentryText(s, "spare", now) ?? "").not.toContain(`T${t} waits for review.`);
    expect(takenOverLines(s, "zed", now).join("\n")).toContain(`checkpoint by lead, 2h ago (#${out.seq})`);
  });

  test("a checkpoint the lead on duty writes while on duty is the one the next lead reads", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    await c.hand("lead", "spare", `T${t} waits for review.`);
    const note = await c.ev("spare", { op: "fact.set", key: "lead checkpoint/spare", value: `T${t} is in review with mac.` });
    await c.hand("jow", "zed");
    const s = c.state();
    expect(s.checkpoint).toMatchObject({ by: "spare", seq: note.seq, text: `T${t} is in review with mac.` });
    expect(reentryText(s, "zed", at(10_000))).toContain(`T${t} is in review with mac.`);
  });
});

describe("the return says what changed while off duty (#19397 box 14)", () => {
  test("asks answered, holds placed or lifted, tasks closed and specs ticked between the two duty events", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    const u = await c.task([MERGE]);
    const head = await c.say("jow", "msg", "plan the export");
    await c.ev("jow", { op: "spec.set", ask: head.seq, text: "- [ ] export runs\n- [ ] docs" });
    const ask = await c.say("ann", "blocking", handedOver("ann", "Which database?", {}), { to: ["lead"] });
    const out = await c.hand("lead", "spare", `T${t} and T${u} wait; #${ask.seq} is open.`);
    await c.say("spare", "msg", "sqlite", { re: [ask.seq], to: ["ann"] });
    const hold = await c.edit("spare", t, { kind: "hold", id: "s1", reason: "until the docs land" });
    await c.ev("jow", { op: "task.update", task: u, state: "done", close: `folded into T${t}` });
    await c.ev("jow", { op: "spec.set", ask: head.seq, text: "- [x] export runs\n- [ ] docs" });
    const back = await c.hand("spare", "lead", `T${t} is held until the docs land.`);
    const s = c.state();
    expect([...s.rejected.values()]).toEqual([]);
    const lines = offDutyLines(s, out.seq, back.seq).join("\n");
    expect(lines).toContain(`#${ask.seq}, answered by spare`);
    expect(lines).toContain(`T${t} s1 held by spare: until the docs land (#${hold.seq})`);
    expect(lines).toContain(`T${u} export`);
    expect(lines).toContain(`spec #${head.seq}: 1 box ticked`);
  });
});

describe("the handover command's report (#19397 boxes 11 and 14)", () => {
  test("taking over lists the outgoing lead's unanswered asks, the clock's steps for the Lead, holds and tasks in flight", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    const doing = await c.ev("ann", { op: "task.update", task: t, state: "doing" });
    const q = await c.say("lead", "ask", "Ship 2.0 today?", { to: ["jow"] });
    await c.hand("lead", "spare", `T${t} is being built; #${q.seq} waits for jow.`);
    const now = at(doing.seq) + 2.5 * QUIET_MS;
    const lines = takenOverLines(c.state(now), "spare", now).join("\n");
    expect(lines).toContain(`asks the Lead put to people, not answered yet:\n    #${q.seq} to jow, asked by lead`);
    expect(lines).toContain(`the clock's steps for the Lead:\n    T${t} export, quiet`);
    expect(lines).toContain("with ann: the Lead's step is due");
    expect(lines).toContain(`tasks in flight:\n    T${t} export: doing, ann`);
    expect(lines).toContain("holds: none");
  });

  test("the return covers every shift since the lead left, A → B → C → A, with what each answer said", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    const ask = await c.say("ann", "blocking", handedOver("ann", "Which database?", {}), { to: ["lead"] });
    const out = await c.hand("lead", "spare", `T${t} waits; #${ask.seq} is open.`);
    expect(handLines(c.state(), "spare", out.seq, at(10_000)).join("\n")).not.toContain("While off duty");
    const said = await c.say("spare", "msg", "sqlite, it ships in one file", { re: [ask.seq], to: ["ann"] });
    const hold = await c.edit("spare", t, { kind: "hold", id: "s1", reason: "until the docs land" });
    const mid = await c.hand("spare", "zed", `T${t} is held until the docs land.`);
    expect(handLines(c.state(), "zed", mid.seq, at(10_000)).join("\n")).not.toContain("While off duty");
    const lift = await c.edit("zed", t, { kind: "unhold", id: "s1" });
    const back = await c.hand("zed", "lead", `T${t} waits for review.`);
    expect([...c.state().rejected.values()]).toEqual([]);
    const full = handLines(c.state(), "lead", back.seq, at(10_000));
    const log = [...c.log];
    for (let cut = 1; cut < log.length; cut++) expect({ cut, lines: handLines(resumedAt(log, cut), "lead", back.seq, at(10_000)) }).toEqual({ cut, lines: full });
    const lines = full.join("\n");
    expect(lines).toContain("lead on duty: lead");
    expect(lines).toContain(`While off duty (#${out.seq} to #${back.seq}):`);
    expect(lines).toContain(`#${ask.seq}, answered by spare (#${said.seq}): sqlite, it ships in one file`);
    expect(lines).toContain(`T${t} s1 held by spare: until the docs land (#${hold.seq})`);
    expect(lines).toContain(`T${t} s1 lifted by zed (#${lift.seq})`);
  });
});

describe("a long absence keeps its whole report (#19397 box 14)", () => {
  test("an answer from A's first shift away is still in the return after hundreds of notes in the next shift, on replay and from any snapshot", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    const ask = await c.say("ann", "blocking", handedOver("ann", "Which region?", {}), { to: ["lead"] });
    const out = await c.hand("lead", "spare", `T${t} waits; #${ask.seq} is open.`);
    const said = await c.say("spare", "msg", "eu-west-3, the Paris region, for the latency budget", { re: [ask.seq], to: ["ann"] });
    const mid = await c.hand("spare", "zed", `T${t} waits for review.`);
    for (let n = 0; n < 160; n++) {
      await c.edit("zed", t, { kind: "hold", id: "s1", reason: `wait ${n}` });
      await c.edit("zed", t, { kind: "unhold", id: "s1" });
    }
    const back = await c.hand("zed", "lead", `T${t} waits for review.`);
    const s = c.state();
    expect([...s.rejected.values()]).toEqual([]);
    expect(s.offDuty?.notes.length).toBe(321);
    const full = handLines(s, "lead", back.seq, at(10_000));
    expect(full.join("\n")).toContain(`#${ask.seq}, answered by spare (#${said.seq}): eu-west-3, the Paris region, for the latency budget`);
    expect(full.filter((l) => l.includes(" lifted by zed ")).length).toBe(160);
    const log = [...c.log];
    const cuts = [out.seq, said.seq - 1, said.seq, mid.seq, mid.seq + 1, back.seq - 1, ...Array.from({ length: 12 }, (_, k) => 1 + k * 29)];
    for (const cut of cuts) expect({ cut, lines: handLines(resumedAt(log, cut), "lead", back.seq, at(10_000)) }).toEqual({ cut, lines: full });
  });

  test("a snapshot keeps notes only from the earliest departure of a lead who can still return", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    await c.hand("lead", "spare", `T${t} waits.`);
    await c.edit("spare", t, { kind: "hold", id: "s1", reason: "until the docs land" });
    await c.hand("spare", "lead", `T${t} is held.`);
    await c.ev("jow", { op: "lead.standby", name: "spare", on: false });
    const again = await c.hand("lead", "zed", `T${t} is held.`);
    const lift = await c.edit("zed", t, { kind: "unhold", id: "s1" });
    expect([...c.state().rejected.values()]).toEqual([]);
    expect(baseAt(c.log, c.log.length).offDuty).toEqual({ left: [["lead", again.seq]], notes: [{ kind: "unhold", task: t, step: "s1", by: "zed", seq: lift.seq }] });
  });
});

describe("the new shapes on the wire", () => {
  const sent = (ev: unknown): boolean => wellFormed({ v: PROTOCOL_VERSION, id: "x", from: "ann", kind: "event", body: "", ts: 1, sig: "s", pk: "p", ev } as unknown as Payload);
  test("a hold names its reason, an unhold only its step, and a handover's checkpoint is text within the limit", () => {
    expect(sent({ op: "task.steps", task: 7, edit: { kind: "hold", id: "s1", reason: "until the docs land" } })).toBe(true);
    expect(sent({ op: "task.steps", task: 7, edit: { kind: "hold", id: "s1" } })).toBe(false);
    expect(sent({ op: "task.steps", task: 7, edit: { kind: "hold", id: "s1", reason: "x", by: "lead" } })).toBe(false);
    expect(sent({ op: "task.steps", task: 7, edit: { kind: "unhold", id: "s1" } })).toBe(true);
    expect(sent({ op: "task.steps", task: 7, edit: { kind: "unhold", id: "s1", reason: "x" } })).toBe(false);
    expect(sent({ op: "lead.duty", to: "spare", from: 0, checkpoint: "T7 waits" })).toBe(true);
    expect(sent({ op: "lead.duty", to: "spare", from: 0 })).toBe(true);
    expect(sent({ op: "lead.duty", to: "spare", from: 0, checkpoint: "" })).toBe(false);
    expect(sent({ op: "lead.duty", to: "spare", from: 0, checkpoint: "x".repeat(CHECKPOINT_MAX_LENGTH + 1) })).toBe(false);
  });
});
