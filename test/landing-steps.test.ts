import { beforeAll, describe, expect, test } from "bun:test";
import type { CheckArtifact, CheckAsk } from "@kiwi/core/checks.ts";
import { formatTask, stepLines } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { prOfTask } from "@kiwi/core/prs.ts";
import { FOLD_RULES, PROTOCOL_VERSION, wellFormed, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { omit } from "@kiwi/core/omit.ts";
import { fold, type ChannelState, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { runSight, stepObservations } from "@kiwi/core/state/landing-steps.ts";
import { currentStep, stepById, stepMove, stepsOfThen, type StepEdit, type StepSpec } from "@kiwi/core/steps.ts";

const T0 = 1_760_000_000_000;
const R = "o/r";
const S1 = "1".repeat(40);
const M1 = "9".repeat(40);
const HOUR = 3_600_000;
const at = (s: number) => T0 + s * 1_000;
type Extra = Partial<Pick<Message, "to" | "ev" | "re" | "esc" | "choices" | "holds" | "check">>;

const ids: Record<string, Identity> = {};
let roster: Roster;
beforeAll(async () => {
  for (const n of ["jow", "lead", "ann", "mac", "zed"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 1, active: true, kind: "agent", role: "lead" },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 3, active: true, kind: "agent" },
    { name: "zed", pk: ids.zed!.pk, owner: false, at: 4, active: true, kind: "agent" },
  ];
});

async function channel() {
  const log: Message[] = [];
  const say = async (from: string, kind: Kind, body: string, extra: Extra = {}): Promise<Message> => {
    const seq = log.length + 1;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: at(seq), ...extra };
    const p = await sign(ids[from]!, payload);
    const m = { ...p, seq, rts: at(seq), sigOk: await verify(p) };
    log.push(m);
    return m;
  };
  const ev = (from: string, e: Event) => say(from, "event", "", { ev: e });
  const github = (items: Record<string, unknown>[]) => ev("jow", { op: "github", items: items.map((i) => ({ repo: R, at: at(log.length + 1), ...i })) } as Event);
  const opened = (t: number) => github([{ event: "pull_request", action: "opened", number: 7, state: "open", branch: `T${t}-x`, sha: S1 }]);
  const merged = (t: number) => github([{ event: "pull_request", action: "closed", number: 7, state: "closed", merged: true, merge: M1, branch: `T${t}-x`, sha: S1, happened: at(log.length) }]);
  const run = (id: number, title: string, conclusion?: string) =>
    github([{ event: "workflow_run", action: conclusion ? "completed" : "in_progress", run: id, title, started: at(log.length), ...(conclusion ? { conclusion } : {}) }]);
  const state = (now = at(10_000)) => fold(log, roster, now);
  const task = async (steps?: StepSpec[], then?: "merge" | "release:tag"): Promise<number> =>
    (await ev("lead", { op: "task.add", title: "export", owner: "ann", review: "mac", ...(steps ? { steps } : {}), ...(then ? { then } : {}) })).seq;
  const approve = async (t: number) => {
    await ev("ann", { op: "task.update", task: t, state: "review", at: S1 });
    await ev("mac", { op: "task.update", task: t, state: "done", verdict: "approved", round: state().tasks.get(t)!.rounds.length, at: S1 });
  };
  const landed = (from: string, t: number, step: string, said: { link?: string; note?: string; artifact?: CheckArtifact } = {}) => ev(from, { op: "task.landed", task: t, step, ...said });
  const edit = (from: string, t: number, change: StepEdit) => ev(from, { op: "task.steps", task: t, edit: change });
  await ev("jow", { op: "repos.set", repos: [R] });
  await ev("jow", { op: "branch.prefix.set", prefix: "T" });
  return { log, ev, say, github, opened, merged, run, state, task, approve, landed, edit };
}

const prAt: CheckArtifact = { kind: "pr", repo: R, pr: 7, sha: S1 };
const view = (s: ChannelState) => ({ github: s.github, tasks: s.tasks, prOf: (t: Parameters<typeof prOfTask>[2]) => prOfTask(s.github, s.branchPrefix, t) });
const ended = (s: ChannelState, t: number) => (s.tasks.get(t)!.steps ?? []).map((x) => `${x.id}:${x.progress.kind === "ended" ? x.progress.end.how : x.progress.seen ? "seen" : "open"}`);
const MERGE: StepSpec = { words: "merge", detector: { kind: "pr-merged" } };

describe("landing is a list of steps (#3930 §3)", () => {
  test("case 8: a six-step landing with no repo connected finishes through task landed, the last with a note and no link", async () => {
    const c = await channel();
    await c.ev("jow", { op: "repos.set", repos: [] });
    const t = await c.task([
      { words: "owner completes the PR in Azure DevOps", by: "jow" },
      { words: "owner approves Deploy HML", by: "jow" },
      { words: "hml check, soak 24h", by: "zed", wait: { reason: "soak in hml", ms: 24 * HOUR } },
      { words: "cut prd release", by: "zed" },
      { words: "three prd gates", by: "jow" },
      { words: "prd health check", by: "zed" },
    ]);
    expect(
      c
        .state()
        .tasks.get(t)!
        .steps!.map((x) => x.id),
    ).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    await c.approve(t);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    await c.landed("jow", t, "s1", { link: "https://dev.azure.com/o/p/_git/r/pullrequest/9" });
    await c.landed("jow", t, "s2");
    const soaking = c.state(at(c.log.length + 60));
    expect(currentStep(soaking.tasks.get(t)!)!.id).toBe("s3");
    expect(stepMove(currentStep(soaking.tasks.get(t)!)!, "ann", at(c.log.length + 60))).toMatchObject({ kind: "waiting", reason: "soak in hml" });
    const shown = stepLines(soaking, soaking.tasks.get(t)!, at(c.log.length + 60)).join("\n");
    expect(shown).toContain("steps (2 of 6 ended, s3 is current):");
    expect(shown).toMatch(/✓ s1 {2}owner completes the PR in Azure DevOps\s+jow {2}done .* https:\/\/dev\.azure\.com/);
    expect(shown).toMatch(/→ s3 {2}hml check, soak 24h\s+zed {2}not before 24h from now: soak in hml/);
    expect(formatTask(soaking, soaking.tasks.get(t)!, at(c.log.length + 60))).toContain(shown);
    for (const [who, step] of [
      ["zed", "s3"],
      ["zed", "s4"],
      ["jow", "s5"],
    ] as const)
      await c.landed(who, t, step);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    const last = await c.landed("zed", t, "s6", { note: "health endpoint green for 10 minutes" });
    const s = c.state();
    expect(s.rejected.size).toBe(0);
    expect(s.tasks.get(t)).toMatchObject({ state: "done", closedSeq: last.seq });
    expect(stepById(s.tasks.get(t)!, "s6")!.progress).toMatchObject({ kind: "ended", end: { how: "said", by: "zed", note: "health endpoint green for 10 minutes" } });
  });

  test("case 9: a PR merging while a person's step before it is open leaves that step open with its mover; the merge step ends when reached", async () => {
    const c = await channel();
    const t = await c.task([{ words: "check the build on KDE", by: "jow" }, MERGE]);
    await c.opened(t);
    await c.approve(t);
    await c.merged(t);
    expect(stepObservations(view(c.state())).map((o) => [o.task.id, o.step.id, o.artifact])).toEqual([[t, "s2", prAt]]);
    await c.landed("jow", t, "s2", { artifact: prAt });
    const waiting = c.state();
    expect(waiting.rejected.size).toBe(0);
    expect(waiting.tasks.get(t)!.state).toBe("landing");
    expect(ended(waiting, t)).toEqual(["s1:open", "s2:seen"]);
    expect(stepMove(currentStep(waiting.tasks.get(t)!)!, "ann", at(900))).toEqual({ kind: "member", name: "jow" });
    expect(stepObservations(view(waiting))).toEqual([]);
    await c.landed("jow", t, "s1");
    const s = c.state();
    expect(ended(s, t)).toEqual(["s1:said", "s2:detected"]);
    expect(s.tasks.get(t)!.state).toBe("done");
  });

  test("case 10: a run step moves nobody while its run is in time, and its named member when it overruns, fails or can't be seen", async () => {
    const c = await channel();
    await c.run(1, "warm-up", "success");
    const t = await c.task([
      { words: "prd pipeline", by: "zed", run: { id: "deploy-7", expected: HOUR } },
      { words: "prd health check", by: "zed" },
    ]);
    await c.approve(t);
    const armed = at(c.log.length);
    const step = (s: ChannelState) => currentStep(s.tasks.get(t)!)!;
    const move = (s: ChannelState, now: number) => stepMove(step(s), "ann", now, runSight(s.github, s.tasks.get(t)!, step(s)));
    const unseen = c.state();
    expect(runSight(unseen.github, unseen.tasks.get(t)!, step(unseen))).toBe("unseen");
    expect(move(unseen, armed + 60_000)).toEqual({ kind: "run", behind: "zed", due: armed + HOUR });
    expect(move(unseen, armed + HOUR)).toEqual({ kind: "member", name: "zed", why: "run overran" });
    await c.run(70, "deploy-7");
    const running = c.state();
    expect(runSight(running.github, running.tasks.get(t)!, step(running))).toBe("running");
    expect(move(running, armed + 60_000)).toMatchObject({ kind: "run", behind: "zed" });
    expect(stepLines(running, running.tasks.get(t)!, armed + 60_000).join("\n")).toContain("run deploy-7 is expected within 59m; nobody is paged meanwhile");
    await c.run(70, "deploy-7", "failure");
    const failed = c.state();
    expect(move(failed, armed + 60_000)).toEqual({ kind: "member", name: "zed", why: "run failed" });
    expect(stepObservations(view(failed))).toEqual([]);
    const refused = await c.landed("jow", t, "s1", { artifact: { kind: "run", id: "deploy-7" } });
    expect(c.state().rejected.get(refused.seq)).toBe("run deploy-7 hasn't succeeded where Kiwi can see it");
    await c.github([{ event: "workflow_run", action: "in_progress", run: 70, attempt: 2, title: "deploy-7", started: at(c.log.length) }]);
    await c.github([{ event: "workflow_run", action: "completed", run: 70, attempt: 2, title: "deploy-7", started: at(c.log.length), conclusion: "success" }]);
    const green = c.state();
    expect(stepObservations(view(green)).map((o) => [o.step.id, o.artifact])).toEqual([["s1", { kind: "run", id: "deploy-7" }]]);
    await c.landed("jow", t, "s1", { artifact: { kind: "run", id: "deploy-7" } });
    expect(ended(c.state(), t)).toEqual(["s1:detected", "s2:open"]);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
  });

  test("a run step with no run named, or in a channel that doesn't hold its runs, is its member's at once; a run that finished early ends its step at its turn", async () => {
    const blind = await channel();
    const b = await blind.task([{ words: "prd pipeline", by: "zed", run: { expected: HOUR } }]);
    await blind.approve(b);
    const sb = blind.state();
    expect(stepMove(currentStep(sb.tasks.get(b)!)!, "ann", at(blind.log.length) + 1, runSight(sb.github, sb.tasks.get(b)!, currentStep(sb.tasks.get(b)!)!))).toEqual({
      kind: "member",
      name: "zed",
      why: "run can't be seen",
    });
    await blind.edit("zed", b, { kind: "run", id: "s1", run: "deploy-9" });
    const named = blind.state();
    expect(named.rejected.size).toBe(0);
    expect(runSight(named.github, named.tasks.get(b)!, currentStep(named.tasks.get(b)!)!)).toBe("blind");
    await blind.landed("zed", b, "s1", { note: "pipeline 4411 finished green" });
    expect(blind.state().tasks.get(b)!.state).toBe("done");

    const c = await channel();
    await c.run(1, "warm-up", "success");
    const t = await c.task([
      { words: "smoke test", by: "jow" },
      { words: "prd pipeline", by: "zed", run: { id: "deploy-3", expected: HOUR } },
    ]);
    await c.run(30, "deploy-3", "success");
    await c.approve(t);
    await c.landed("jow", t, "s2", { artifact: { kind: "run", id: "deploy-3" } });
    expect(ended(c.state(), t)).toEqual(["s1:open", "s2:seen"]);
    await c.landed("jow", t, "s1");
    expect(c.state().tasks.get(t)).toMatchObject({ state: "done" });
    expect(c.state().rejected.size).toBe(0);
  });

  test("case 16: a repeated task landed for a step that already ended does nothing, and the next step stays open", async () => {
    const c = await channel();
    const t = await c.task([{ words: "tag the build" }, { words: "publish the notes" }]);
    await c.approve(t);
    const first = await c.landed("ann", t, "s1");
    const again = await c.landed("ann", t, "s1");
    const s = c.state();
    expect(s.rejected.has(first.seq) || s.rejected.has(again.seq)).toBe(false);
    expect(ended(s, t)).toEqual(["s1:said", "s2:open"]);
    expect(stepById(s.tasks.get(t)!, "s1")!.progress).toMatchObject({ end: { seq: first.seq } });
    expect(s.tasks.get(t)!.state).toBe("landing");
  });

  test("case 17: a task landed naming a step that isn't current is refused with the current one named, and so is one sent before a reorder moved its step", async () => {
    const c = await channel();
    const t = await c.task([{ words: "tag the build" }, { words: "publish the notes" }, { words: "tell the list" }]);
    await c.approve(t);
    const early = await c.landed("ann", t, "s3");
    expect(c.state().rejected.get(early.seq)).toBe(
      `step s3 “tell the list” of T${t} isn't the current one: its current step is s1 “tag the build”. A retry resends the step id it first carried; to end another step, name that one with --step`,
    );
    const none = await c.landed("ann", t, "s9");
    expect(c.state().rejected.get(none.seq)).toBe(`T${t} has no step s9: its current step is s1 “tag the build”`);
    await c.edit("lead", t, { kind: "move", id: "s1" });
    const stale = await c.landed("ann", t, "s1");
    const s = c.state();
    expect(s.tasks.get(t)!.steps!.map((x) => x.id)).toEqual(["s2", "s3", "s1"]);
    expect(s.rejected.get(stale.seq)).toContain(`step s1 “tag the build” of T${t} isn't the current one: its current step is s2 “publish the notes”`);
    expect(ended(s, t)).toEqual(["s2:open", "s3:open", "s1:open"]);
  });

  test("case 18: the same PR-merged observation arriving twice ends one step", async () => {
    const c = await channel();
    const t = await c.task([MERGE, { words: "tell the list" }]);
    await c.opened(t);
    await c.approve(t);
    const before = await c.landed("jow", t, "s1", { artifact: prAt });
    expect(c.state().rejected.get(before.seq)).toBe(`T${t}'s PR #7 hasn't merged`);
    await c.merged(t);
    await c.landed("jow", t, "s1", { artifact: prAt });
    await c.landed("lead", t, "s1", { artifact: prAt });
    const s = c.state();
    expect(s.rejected.size).toBe(1);
    expect(ended(s, t)).toEqual(["s1:detected", "s2:open"]);
    expect(s.tasks.get(t)!.state).toBe("landing");
    expect(s.tasks.get(t)!.notes.filter((n) => n.text.startsWith("step s1")).length).toBe(1);
  });

  test("case 19: a pre-ship question becomes a step before the first; answering it once ends the step, and nobody is asked twice", async () => {
    const c = await channel();
    const t = await c.task([MERGE]);
    await c.opened(t);
    const check: CheckAsk = { phase: "pre-ship", decider: "jow", artifact: prAt };
    const ask = await c.say("ann", "blocking", "Check it on KDE", { to: ["jow"], esc: true, choices: ["A: works on KDE", "B: not yet"], holds: [t], check });
    const asked = c.state().tasks.get(t)!;
    expect(asked.steps!.map((x) => [x.id, x.words, x.by, x.detector])).toEqual([
      ["s2", `check #${ask.seq}`, "jow", { kind: "answered", ask: ask.seq }],
      ["s1", "merge", undefined, { kind: "pr-merged" }],
    ]);
    await c.approve(t);
    await c.merged(t);
    await c.landed("jow", t, "s1", { artifact: prAt });
    const held = c.state();
    expect(held.tasks.get(t)!.state).toBe("landing");
    expect(ended(held, t)).toEqual(["s2:open", "s1:seen"]);
    expect(stepMove(currentStep(held.tasks.get(t)!)!, "ann", at(900))).toEqual({ kind: "member", name: "jow" });
    await c.say("jow", "msg", "A: works on KDE", { re: [ask.seq] });
    const s = c.state();
    expect(ended(s, t)).toEqual(["s2:detected", "s1:detected"]);
    expect(s.tasks.get(t)!.state).toBe("done");
    expect(c.log.filter((m) => m.choices?.length).length).toBe(1);
    expect(s.tasks.get(t)!.steps!.filter((x) => x.detector?.kind === "answered").length).toBe(1);
  });

  test("a question answered with its second option leaves its step open; closing the question removes the step", async () => {
    const c = await channel();
    const t = await c.task([{ words: "tell the list" }]);
    const check: CheckAsk = { phase: "pre-ship", decider: "jow", artifact: { kind: "run", id: "job-1" } };
    const ask = await c.say("ann", "blocking", "Check it", { to: ["jow"], esc: true, choices: ["A: yes", "B: not yet"], holds: [t], check });
    await c.say("jow", "msg", "B: not yet", { re: [ask.seq] });
    expect(ended(c.state(), t)).toEqual(["s2:open", "s1:open"]);
    await c.ev("ann", { op: "ask.close", ask: ask.seq });
    expect(ended(c.state(), t)).toEqual(["s1:open"]);
  });
});

describe("what a detector saw is tied to what it watches (#3930 §3)", () => {
  test("a step given another run forgets the old run's success: the new run has to succeed, or its member ends the step", async () => {
    const c = await channel();
    await c.run(1, "warm-up", "success");
    const t = await c.task([
      { words: "smoke test", by: "jow" },
      { words: "prd pipeline", by: "zed", run: { id: "old-run", expected: HOUR } },
    ]);
    await c.run(40, "old-run", "success");
    await c.approve(t);
    await c.landed("jow", t, "s2", { artifact: { kind: "run", id: "old-run" } });
    expect(ended(c.state(), t)).toEqual(["s1:open", "s2:seen"]);
    await c.edit("zed", t, { kind: "run", id: "s2", run: "new-run" });
    expect(ended(c.state(), t)).toEqual(["s1:open", "s2:open"]);
    await c.landed("jow", t, "s1");
    expect(ended(c.state(), t)).toEqual(["s1:said", "s2:open"]);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    const stale = await c.landed("jow", t, "s2", { artifact: { kind: "run", id: "old-run" } });
    expect(c.state().rejected.get(stale.seq)).toBe(`step s2 “prd pipeline” of T${t} doesn't wait on run old-run`);
    await c.run(41, "new-run", "success");
    await c.landed("jow", t, "s2", { artifact: { kind: "run", id: "new-run" } });
    expect(c.state().tasks.get(t)!.state).toBe("done");
    const same = await channel();
    await same.run(1, "warm-up", "success");
    const u = await same.task([
      { words: "smoke test", by: "jow" },
      { words: "prd pipeline", by: "zed", run: { id: "old-run", expected: HOUR } },
    ]);
    await same.run(40, "old-run", "success");
    await same.landed("jow", u, "s2", { artifact: { kind: "run", id: "old-run" } });
    await same.edit("zed", u, { kind: "run", id: "s2", run: "old-run", expected: 2 * HOUR });
    expect(ended(same.state(), u)).toEqual(["s1:open", "s2:seen"]);
  });

  test("an ordinary question is a detector too: the first option from someone it asked ends the step, also when it came before the step's turn or before the step", async () => {
    const c = await channel();
    const ask = await c.say("ann", "blocking", "Ship to prd?", { to: ["jow"], esc: true, choices: ["A: ship it", "B: hold"] });
    const t = await c.task([{ words: "tag the build" }, { words: "owner says ship", by: "jow", detector: { kind: "answered", ask: ask.seq } }]);
    await c.approve(t);
    await c.say("mac", "msg", "A: ship it", { re: [ask.seq] });
    expect(ended(c.state(), t)).toEqual(["s1:open", "s2:open"]);
    await c.say("jow", "msg", "B: hold", { re: [ask.seq] });
    expect(ended(c.state(), t)).toEqual(["s1:open", "s2:open"]);
    await c.say("jow", "msg", "A: ship it", { re: [ask.seq] });
    expect(ended(c.state(), t)).toEqual(["s1:open", "s2:seen"]);
    await c.landed("ann", t, "s1");
    const s = c.state();
    expect(ended(s, t)).toEqual(["s1:said", "s2:detected"]);
    expect(s.tasks.get(t)!.state).toBe("done");
    expect(s.rejected.size).toBe(0);
    const later = await c.task([{ words: "owner says ship", by: "jow", detector: { kind: "answered", ask: ask.seq } }, { words: "tell the list" }]);
    expect(ended(c.state(), later)).toEqual(["s1:seen", "s2:open"]);
    const kept: { base?: FoldBase } = {};
    fold(c.log, roster, at(10_000), null, null, null, (b) => (kept.base = b));
    if (!kept.base) throw new Error("the fold kept no base");
    const third = await c.task([{ words: "owner says ship", by: "jow", detector: { kind: "answered", ask: ask.seq } }]);
    const replayed = fold(c.log.slice(kept.base.n), roster, at(10_000), null, null, kept.base);
    expect(ended(replayed, third)).toEqual(["s1:seen"]);
    const closed = await channel();
    const q = await closed.say("ann", "blocking", "Ship?", { to: ["jow"], esc: true, choices: ["A: yes", "B: no"] });
    const v = await closed.task([{ words: "owner says ship", by: "jow", detector: { kind: "answered", ask: q.seq } }]);
    await closed.ev("ann", { op: "ask.close", ask: q.seq });
    await closed.say("jow", "msg", "A: yes", { re: [q.seq] });
    expect(ended(closed.state(), v)).toEqual(["s1:open"]);
  });

  test("a question's second option, a snapshot, then its first option: the whole log and the tail from the snapshot agree", async () => {
    const through = (c: Awaited<ReturnType<typeof channel>>, base: FoldBase) => fold(c.log.slice(base.n), roster, at(10_000), null, null, base);
    const cut = (c: Awaited<ReturnType<typeof channel>>): FoldBase => {
      const kept: { base?: FoldBase } = {};
      fold(c.log, roster, at(10_000), null, null, null, (b) => (kept.base = b));
      if (!kept.base) throw new Error("the fold kept no base");
      return kept.base;
    };
    const c = await channel();
    const ask = await c.say("ann", "blocking", "Ship to prd?", { to: ["jow"], esc: true, choices: ["A: yes", "B: hold"] });
    const t = await c.task([{ words: "owner says ship", by: "jow", detector: { kind: "answered", ask: ask.seq } }]);
    await c.approve(t);
    await c.say("jow", "msg", "B: hold", { re: [ask.seq] });
    const base = cut(c);
    await c.say("jow", "msg", "A: yes", { re: [ask.seq] });
    expect(c.state().tasks.get(t)!.state).toBe("done");
    expect(through(c, base).tasks.get(t)!.state).toBe("done");
    expect(ended(through(c, base), t)).toEqual(ended(c.state(), t));

    const late = await channel();
    const q = await late.say("ann", "blocking", "Ship to prd?", { to: ["jow"], esc: true, choices: ["A: yes", "B: hold"] });
    await late.say("jow", "msg", "B: hold", { re: [q.seq] });
    const before = cut(late);
    const u = await late.task([{ words: "owner says ship", by: "jow", detector: { kind: "answered", ask: q.seq } }]);
    await late.approve(u);
    const attached = cut(late);
    await late.say("jow", "msg", "A: yes", { re: [q.seq] });
    const whole = late.state();
    expect(ended(whole, u)).toEqual(["s1:open"]);
    expect(whole.tasks.get(u)!.state).toBe("landing");
    expect(ended(through(late, before), u)).toEqual(ended(whole, u));
    expect(ended(through(late, attached), u)).toEqual(ended(whole, u));

    const open = await channel();
    const o = await open.say("ann", "blocking", "Ship to prd?", { to: ["jow"], esc: true, choices: ["A: yes", "B: hold"] });
    const unanswered = cut(open);
    const v = await open.task([{ words: "owner says ship", by: "jow", detector: { kind: "answered", ask: o.seq } }]);
    await open.approve(v);
    await open.say("jow", "msg", "A: yes", { re: [o.seq] });
    expect(open.state().tasks.get(v)!.state).toBe("done");
    expect(through(open, unanswered).tasks.get(v)!.state).toBe("done");
  });

  test("a snapshot from before steps turns its open pre-ship question into a step once, and one answer ends it", async () => {
    const c = await channel();
    const t = await c.task(undefined, "merge");
    await c.opened(t);
    const check: CheckAsk = { phase: "pre-ship", decider: "jow", artifact: prAt };
    const ask = await c.say("ann", "blocking", "Check it on KDE", { to: ["jow"], esc: true, choices: ["A: works on KDE", "B: not yet"], holds: [t], check });
    await c.approve(t);
    const kept: { base?: FoldBase } = {};
    fold(c.log, roster, at(10_000), null, null, null, (b) => (kept.base = b));
    if (!kept.base) throw new Error("the fold kept no base");
    const older: FoldBase = { ...kept.base, rules: FOLD_RULES - 1, tasks: kept.base.tasks.map((x) => omit(x, "steps", "stepCount")) };
    const migrated = fold(c.log.slice(older.n), roster, at(10_000), null, null, older);
    expect(migrated.tasks.get(t)!.steps!.map((x) => [x.id, x.words, x.by, x.from])).toEqual([
      ["s2", `check #${ask.seq}`, "jow", "check"],
      ["s1", "merge", undefined, "then"],
    ]);
    const next: { base?: FoldBase } = {};
    fold(c.log.slice(older.n), roster, at(10_000), null, null, older, (b) => (next.base = b));
    if (!next.base) throw new Error("the fold kept no base");
    expect(next.base.rules).toBe(FOLD_RULES - 1);
    const twice = fold([], roster, at(10_000), null, null, { ...next.base, rules: FOLD_RULES - 1 });
    expect(twice.tasks.get(t)!.steps!.map((x) => x.id)).toEqual(["s2", "s1"]);
    await c.say("jow", "msg", "A: works on KDE", { re: [ask.seq] });
    const answered = fold(c.log.slice(older.n), roster, at(10_000), null, null, older);
    expect(ended(answered, t)).toEqual(["s2:detected", "s1:open"]);
    expect(answered.tasks.get(t)!.state).toBe("landing");
    const before = await channel();
    const u = await before.task(undefined, "merge");
    await before.opened(u);
    const early = await before.say("ann", "blocking", "Check it on KDE", { to: ["jow"], esc: true, choices: ["A: works on KDE", "B: not yet"], holds: [u], check });
    await before.say("jow", "msg", "A: works on KDE", { re: [early.seq] });
    await before.approve(u);
    const cut: { base?: FoldBase } = {};
    fold(before.log, roster, at(10_000), null, null, null, (b) => (cut.base = b));
    if (!cut.base) throw new Error("the fold kept no base");
    const old: FoldBase = { ...cut.base, rules: FOLD_RULES - 1, tasks: cut.base.tasks.map((x) => omit(x, "steps", "stepCount")) };
    expect(ended(fold([], roster, at(10_000), null, null, old), u)).toEqual(["s2:detected", "s1:open"]);
  });
});

describe("steps are edited by the lead or a person, and never reopen review (#3930 §3)", () => {
  test("add, move, reassign, skip with a reason and remove keep the task landing with its approval; ids are never reused", async () => {
    const c = await channel();
    const t = await c.task([{ words: "tag the build" }, { words: "publish the notes" }]);
    await c.approve(t);
    const rounds = c.state().tasks.get(t)!.rounds;
    const byAgent = await c.edit("ann", t, { kind: "add", step: { words: "tell the list" } });
    expect(c.state().rejected.get(byAgent.seq)).toBe(`only a person or the lead changes T${t}'s steps`);
    await c.edit("lead", t, { kind: "add", step: { words: "smoke test", by: "jow" }, before: "s1" });
    await c.edit("jow", t, { kind: "remove", id: "s2" });
    await c.edit("lead", t, { kind: "add", step: { words: "tell the list" } });
    await c.edit("lead", t, { kind: "by", id: "s1", by: "zed" });
    await c.edit("jow", t, { kind: "skip", id: "s3", why: "no smoke environment today" });
    const s = c.state();
    expect(s.rejected.size).toBe(1);
    expect(s.tasks.get(t)!.steps!.map((x) => [x.id, x.words, x.by])).toEqual([
      ["s3", "smoke test", "jow"],
      ["s1", "tag the build", "zed"],
      ["s4", "tell the list", undefined],
    ]);
    expect(ended(s, t)).toEqual(["s3:skipped", "s1:open", "s4:open"]);
    expect(s.tasks.get(t)).toMatchObject({ state: "landing", approvedBy: "mac" });
    expect(s.tasks.get(t)!.rounds).toEqual(rounds);
    const notMover = await c.landed("ann", t, "s1");
    expect(c.state().rejected.get(notMover.seq)).toBe(`only zed, the lead or a person ends step s1 “tag the build” of T${t}`);
    await c.landed("zed", t, "s1");
    const stranger = await c.landed("mac", t, "s4");
    expect(c.state().rejected.get(stranger.seq)).toBe(`only ann, the lead or a person ends step s4 “tell the list” of T${t}`);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    await c.edit("lead", t, { kind: "skip", id: "s4", why: "the list is retired" });
    expect(c.state().tasks.get(t)!.state).toBe("done");
  });

  test("a step's own mover sets its wait or its run; anyone else is refused; an ended step can't change", async () => {
    const c = await channel();
    const t = await c.task([
      { words: "soak in hml", by: "zed" },
      { words: "prd pipeline", by: "zed" },
    ]);
    await c.approve(t);
    const other = await c.edit("mac", t, { kind: "wait", id: "s1", reason: "soak", ms: HOUR });
    expect(c.state().rejected.get(other.seq)).toBe(`only a person or the lead changes T${t}'s steps, or zed for this one`);
    const set = await c.edit("zed", t, { kind: "wait", id: "s1", reason: "soak a full day", ms: 24 * HOUR });
    expect(stepById(c.state().tasks.get(t)!, "s1")!.wait).toEqual({ reason: "soak a full day", ms: 24 * HOUR, until: at(set.seq) + 24 * HOUR });
    const noSpan = await c.edit("zed", t, { kind: "run", id: "s2", run: "deploy-1" });
    expect(c.state().rejected.get(noSpan.seq)).toBe(`step s2 “prd pipeline” of T${t} needs how long its run is expected to take`);
    await c.edit("zed", t, { kind: "run", id: "s2", run: "deploy-1", expected: HOUR });
    expect(stepById(c.state().tasks.get(t)!, "s2")!.run).toEqual({ id: "deploy-1", expected: HOUR });
    await c.landed("zed", t, "s1");
    const late = await c.edit("lead", t, { kind: "skip", id: "s1", why: "too late" });
    expect(c.state().rejected.get(late.seq)).toBe(`step s1 “soak in hml” of T${t} has already ended`);
    expect(stepById(c.state().tasks.get(t)!, "s2")!.run).toMatchObject({ id: "deploy-1", due: expect.any(Number) });
  });

  test("the owner sets a channel default that each new task copies; --then none on a task opts out", async () => {
    const c = await channel();
    const byAgent = await c.ev("ann", { op: "landing.set", then: null, steps: [{ words: "ship it" }] });
    expect(c.state().rejected.has(byAgent.seq)).toBe(true);
    await c.ev("jow", { op: "landing.set", then: null, steps: [MERGE, { words: "tell the list", by: "zed" }] });
    const a = await c.task();
    const b = (await c.ev("lead", { op: "task.add", title: "docs", owner: "ann", then: "none" })).seq;
    const own = await c.task([{ words: "only this" }]);
    const s = c.state();
    expect(s.tasks.get(a)!.steps!.map((x) => [x.id, x.words, x.by])).toEqual([
      ["s1", "merge", undefined],
      ["s2", "tell the list", "zed"],
    ]);
    expect(s.tasks.get(a)!.then).toBeUndefined();
    expect(s.tasks.get(b)!.steps).toBeUndefined();
    expect(s.tasks.get(own)!.steps!.map((x) => x.words)).toEqual(["only this"]);
    await c.ev("ann", { op: "task.update", task: b, state: "done" });
    expect(c.state().tasks.get(b)!.state).toBe("done");
  });
});

describe("tasks from before steps keep landing (#3930 §6)", () => {
  test("case 14: a task in landing under --then merge has one step and finishes when its PR merges", async () => {
    const c = await channel();
    const t = await c.task(undefined, "merge");
    await c.opened(t);
    await c.approve(t);
    const landing = c.state().tasks.get(t)!;
    expect(landing.state).toBe("landing");
    expect(landing.steps!.map((x) => [x.id, x.words, x.from, x.detector])).toEqual([["s1", "merge", "then", { kind: "pr-merged" }]]);
    expect(stepObservations(view(c.state()))).toEqual([]);
    await c.merged(t);
    const post = await c.ev("jow", { op: "task.landed", task: t, artifact: prAt });
    const s = c.state();
    expect(s.rejected.size).toBe(0);
    expect(s.tasks.get(t)).toMatchObject({ state: "done", closedSeq: post.seq, landed: { key: `T${t}:pr:o/r#7@${S1}` } });
    expect(ended(s, t)).toEqual(["s1:detected"]);
  });

  test("the old values map to steps, and a snapshot from before steps gives its open tasks theirs", async () => {
    expect(stepsOfThen("merge").map((x) => x.words)).toEqual(["merge"]);
    expect(stepsOfThen("release:tag").map((x) => x.words)).toEqual(["merge", "release"]);
    expect(stepsOfThen("release:npm:@kiwi/cli@^1.2.0").map((x) => x.words)).toEqual(["merge", "publish @kiwi/cli@^1.2.0"]);
    expect(stepsOfThen("run").map((x) => x.words)).toEqual(["run"]);
    expect(stepsOfThen("none")).toEqual([]);
    const c = await channel();
    const t = await c.task(undefined, "release:tag");
    await c.opened(t);
    await c.approve(t);
    const kept: { base?: FoldBase } = {};
    fold(c.log, roster, at(10_000), null, null, null, (b) => (kept.base = b));
    if (!kept.base) throw new Error("the fold kept no base");
    const older: FoldBase = { ...kept.base, rules: FOLD_RULES - 1, tasks: kept.base.tasks.map((x) => omit(x, "steps", "stepCount")) };
    const again = fold(c.log.slice(older.n), roster, at(10_000), null, null, older);
    expect(again.tasks.get(t)!.state).toBe("landing");
    expect(again.tasks.get(t)!.steps!.map((x) => [x.id, x.words, x.from])).toEqual([
      ["s1", "merge", "then"],
      ["s2", "release", "then"],
    ]);
  });

  test("the old finish ends only the steps its value made: a step added by hand keeps the task landing, before the merge step or after it", async () => {
    const after = await channel();
    const a = await after.task(undefined, "merge");
    await after.opened(a);
    await after.approve(a);
    await after.edit("lead", a, { kind: "add", step: { words: "check the build on KDE", by: "jow" } });
    expect(after.state().tasks.get(a)).toMatchObject({ state: "landing", approvedBy: "mac" });
    await after.merged(a);
    await after.ev("jow", { op: "task.landed", task: a, artifact: prAt });
    expect(after.state().rejected.size).toBe(0);
    expect(ended(after.state(), a)).toEqual(["s1:detected", "s2:open"]);
    expect(after.state().tasks.get(a)!.state).toBe("landing");
    expect(stepMove(currentStep(after.state().tasks.get(a)!)!, "ann", at(900))).toEqual({ kind: "member", name: "jow" });
    await after.landed("jow", a, "s2");
    expect(after.state().tasks.get(a)!.state).toBe("done");

    const before = await channel();
    const b = await before.task(undefined, "merge");
    await before.opened(b);
    await before.approve(b);
    await before.edit("jow", b, { kind: "add", step: { words: "check the build on KDE", by: "jow" }, before: "s1" });
    await before.merged(b);
    await before.ev("jow", { op: "task.landed", task: b, artifact: prAt });
    expect(ended(before.state(), b)).toEqual(["s2:open", "s1:seen"]);
    expect(before.state().tasks.get(b)!.state).toBe("landing");
    await before.landed("jow", b, "s2");
    expect(ended(before.state(), b)).toEqual(["s2:said", "s1:detected"]);
    expect(before.state().tasks.get(b)!.state).toBe("done");
  });

  test("a step from an old value ends through its gate: an agent can't say it done, and no step observation stands in for it", async () => {
    const c = await channel();
    const t = await c.task(undefined, "merge");
    await c.opened(t);
    await c.approve(t);
    const said = await c.landed("ann", t, "s1");
    expect(c.state().rejected.get(said.seq)).toBe(`step s1 “merge” of T${t} ends through its landing gate: a person or the lead can end it by hand`);
    await c.merged(t);
    const seen = await c.landed("jow", t, "s1", { artifact: prAt });
    expect(c.state().rejected.get(seen.seq)).toBe(`T${t}'s step s1 “merge” ends through its landing gate, not a step observation`);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
  });
});

describe("the wire shapes of steps", () => {
  const sent = (ev: unknown): boolean => wellFormed({ v: PROTOCOL_VERSION, id: "x", from: "ann", kind: "event", body: "", ts: 1, sig: "s", pk: "p", ev } as unknown as Payload);

  test("a step needs words; a run names who is behind it; a landed names a step id, with a link or a note or what a detector saw", () => {
    expect(sent({ op: "task.add", title: "t", steps: [{ words: "merge", detector: { kind: "pr-merged" } }] })).toBe(true);
    expect(sent({ op: "task.add", title: "t", steps: [] })).toBe(false);
    expect(sent({ op: "task.add", title: "t", steps: [{ words: " " }] })).toBe(false);
    expect(sent({ op: "task.add", title: "t", then: "merge", steps: [{ words: "x" }] })).toBe(false);
    expect(sent({ op: "task.add", title: "t", steps: [{ words: "pipeline", run: { expected: HOUR } }] })).toBe(false);
    expect(sent({ op: "task.add", title: "t", steps: [{ words: "pipeline", by: "zed", run: { id: "deploy-1", expected: HOUR } }] })).toBe(true);
    expect(sent({ op: "task.add", title: "t", steps: [{ words: "soak", wait: { reason: "", ms: HOUR } }] })).toBe(false);
    expect(sent({ op: "task.landed", task: 3, step: "s1" })).toBe(true);
    expect(sent({ op: "task.landed", task: 3, step: "s1", link: "https://x.test/run/1", note: "green" })).toBe(true);
    expect(sent({ op: "task.landed", task: 3, step: "s1", link: "http://x.test" })).toBe(false);
    expect(sent({ op: "task.landed", task: 3, step: "1" })).toBe(false);
    expect(sent({ op: "task.landed", task: 3, step: "s1", artifact: prAt })).toBe(true);
    expect(sent({ op: "task.landed", task: 3, step: "s1", artifact: prAt, note: "and a note" })).toBe(false);
    expect(sent({ op: "task.landed", task: 3, artifact: prAt })).toBe(true);
    expect(sent({ op: "task.steps", task: 3, edit: { kind: "skip", id: "s2", why: "not needed" } })).toBe(true);
    expect(sent({ op: "task.steps", task: 3, edit: { kind: "skip", id: "s2" } })).toBe(false);
    expect(sent({ op: "task.steps", task: 3, edit: { kind: "move", id: "s2", before: "s2" } })).toBe(false);
    expect(sent({ op: "landing.set", then: null, steps: [{ words: "merge" }] })).toBe(true);
    expect(sent({ op: "landing.set", then: "merge", steps: [{ words: "merge" }] })).toBe(false);
  });
});
