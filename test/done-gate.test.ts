import { beforeAll, describe, expect, test } from "bun:test";
import type { CheckArtifact, CheckAsk } from "@kiwi/core/checks.ts";
import { doneGate, inRange, landingsDue, runBlind, runStarts } from "@kiwi/core/done-gate.ts";
import { landingWaits } from "@kiwi/core/prs.ts";
import { shipGate } from "@kiwi/core/ship-gate.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { FOLD_RULES, PROTOCOL_VERSION, wellFormed, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { omit } from "@kiwi/core/omit.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";

const T0 = 1_760_000_000_000;
const R = "o/r";
const S1 = "1".repeat(40);
const S2 = "2".repeat(40);
const M1 = "9".repeat(40);
const OPTIONS = ["A: works on KDE", "B: not yet"];
const at = (s: number) => T0 + s * 1_000;
type Extra = Partial<Pick<Message, "to" | "ev" | "re" | "esc" | "choices" | "holds" | "check">>;

const ids: Record<string, Identity> = {};
let roster: Roster;
beforeAll(async () => {
  for (const n of ["jow", "ann", "mac", "zed"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "zed", pk: ids.zed!.pk, owner: false, at: 3, active: true, kind: "agent" },
  ];
});

async function channel(then: string = "merge") {
  const log: Message[] = [];
  const say = async (from: string, kind: Kind, body: string, extra: Extra = {}, rts?: number | "none"): Promise<Message> => {
    const seq = log.length + 1;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: at(seq), ...extra };
    const p = await sign(ids[from]!, payload);
    const m = { ...p, seq, ...(rts === "none" ? {} : { rts: rts ?? at(seq) }), sigOk: await verify(p) };
    log.push(m);
    return m;
  };
  const ev = (from: string, e: Event, rts?: number) => say(from, "event", "", { ev: e }, rts);
  const github = (items: Record<string, unknown>[]) => ev("jow", { op: "github", items: items.map((i) => ({ repo: R, at: at(log.length + 1), ...i })) } as Event);
  const opened = (t: number, sha: string) => github([{ event: "pull_request", action: "opened", number: 7, state: "open", branch: `T${t}-x`, sha }]);
  const merged = (t: number, sha: string, when: number) =>
    github([{ event: "pull_request", action: "closed", number: 7, state: "closed", merged: true, merge: M1, branch: `T${t}-x`, sha, happened: when }]);
  const ci = (sha: string, run: number, conclusion: string | undefined, when: number | undefined, attempt = 1) =>
    github([
      {
        event: "check_run",
        sha,
        name: "build",
        run,
        attempt,
        status: conclusion ? "completed" : "in_progress",
        ...(conclusion ? { conclusion } : {}),
        ...(when !== undefined ? { happened: when } : {}),
      },
    ]);
  const state = () => fold(log, roster, at(10_000));
  const task = async (): Promise<number> => (await ev("ann", { op: "task.add", title: "export", owner: "ann", review: "mac" })).seq;
  const approve = async (t: number, sha: string, runs?: number[]) => {
    await ev("ann", { op: "task.update", task: t, state: "review", at: sha });
    await ev("mac", { op: "task.update", task: t, state: "done", verdict: "approved", round: state().tasks.get(t)!.rounds.length, at: sha, ...(runs ? { runs } : {}) });
  };
  const askCheck = (t: number, check: CheckAsk) => say("ann", "blocking", "Check it on KDE", { to: ["jow"], esc: true, choices: OPTIONS, holds: [t], check });
  const answer = (ask: Message, body: string, rts?: number | "none") => say("jow", "msg", body, { re: [ask.seq] }, rts);
  const land = (from: string, t: number, artifact: CheckArtifact) => ev(from, { op: "task.landed", task: t, artifact });
  await ev("jow", { op: "branch.prefix.set", prefix: "T" });
  await ev("jow", { op: "landing.set", then } as Event);
  return { log, ev, say, github, opened, merged, ci, state, task, approve, askCheck, answer, land };
}

const prAt = (sha: string): CheckArtifact => ({ kind: "pr", repo: R, pr: 7, sha });
const kde = (sha: string): CheckAsk => ({ phase: "pre-ship", decider: "jow", artifact: prAt(sha) });

describe("the done gate (#623 §5)", () => {
  test("a merge at the approved head with the gate open lands the task once, by its owner's app", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    expect(doneGate(c.state(), c.state().tasks.get(t)!)).toEqual({ kind: "waiting", why: "PR #7 to merge" });
    await c.merged(t, S1, at(c.log.length + 1));
    expect(landingsDue(c.state()).map((l) => l.key)).toEqual([`T${t}:pr:o/r#7@${S1}`]);
    const first = await c.land("jow", t, prAt(S1));
    const second = await c.land("jow", t, prAt(S1));
    const s = c.state();
    expect(s.tasks.get(t)!.state).toBe("done");
    expect(s.tasks.get(t)!.landed).toEqual({ key: `T${t}:pr:o/r#7@${S1}`, artifact: prAt(S1), seq: first.seq, by: "jow" });
    expect(s.rejected.has(second.seq)).toBe(false);
    expect(s.tasks.get(t)!.notes.filter((n) => n.text.startsWith("landed")).length).toBe(1);
    expect(landingsDue(s)).toEqual([]);
  });

  test("case 3 and the T27 replay: a pass after a premature merge leaves the task landing with a bypass, and only a close with a reason ends it", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    const ask = await c.askCheck(t, kde(S1));
    await c.approve(t, S1);
    await c.merged(t, S1, at(c.log.length + 1));
    await c.answer(ask, "A: works on KDE");
    const s = c.state();
    expect(doneGate(s, s.tasks.get(t)!)).toEqual({ kind: "bypassed", missing: [`check #${ask.seq} passed before the merge`] });
    const refused = await c.land("jow", t, prAt(S1));
    expect(c.state().rejected.get(refused.seq)).toContain("shipped while its ship gate was shut");
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    await c.ev("jow", { op: "task.update", task: t, state: "done", close: "merged before the KDE check: checked by hand after" });
    const closed = c.state().tasks.get(t)!;
    expect(closed.state).toBe("done");
    expect(closed.closedWith).toBe("merged before the KDE check: checked by hand after");
    expect(closed.landed).toBeUndefined();
  });

  test("a merge GitHub dates before an answer that arrived first is still a bypass: the gate goes by when things happened", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    const ask = await c.askCheck(t, kde(S1));
    await c.approve(t, S1);
    const answered = await c.answer(ask, "A: works on KDE");
    await c.merged(t, S1, (answered.rts ?? 0) - 500);
    const s = c.state();
    expect(doneGate(s, s.tasks.get(t)!)?.kind).toBe("bypassed");
  });

  test("an answer with no trusted time counts as late", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    const ask = await c.askCheck(t, kde(S1));
    await c.approve(t, S1);
    await c.say("jow", "msg", "A: works on KDE", { re: [ask.seq] }, "none");
    await c.merged(t, S1, at(c.log.length + 1));
    expect(doneGate(c.state(), c.state().tasks.get(t)!)?.kind).toBe("bypassed");
  });

  test("evidence is judged as it stood at the merge: a pass taken back, a close or a replacement afterwards doesn't undo a landing", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    const ask = await c.askCheck(t, kde(S1));
    await c.approve(t, S1);
    await c.answer(ask, "A: works on KDE");
    await c.merged(t, S1, at(c.log.length + 1));
    await c.answer(ask, "B: not yet");
    expect(doneGate(c.state(), c.state().tasks.get(t)!)?.kind).toBe("landed");
    await c.ev("ann", { op: "ask.close", ask: ask.seq });
    await c.say("ann", "blocking", "Check it again", { to: ["jow"], esc: true, choices: OPTIONS, holds: [t], check: { ...kde(S1), replaces: ask.seq } });
    expect(doneGate(c.state(), c.state().tasks.get(t)!)?.kind).toBe("landed");
  });

  test("a check passed and then answered no before the merge keeps the gate shut", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    const ask = await c.askCheck(t, kde(S1));
    await c.approve(t, S1);
    await c.answer(ask, "A: works on KDE");
    await c.answer(ask, "B: not yet");
    await c.merged(t, S1, at(c.log.length + 1));
    expect(doneGate(c.state(), c.state().tasks.get(t)!)?.kind).toBe("bypassed");
  });

  test("a recorded CI run counts by when it finished: a late report of an early green holds, a rerun failing after the merge doesn't undo it", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.ci(S1, 11, undefined, 0);
    await c.approve(t, S1, [11]);
    const merge = at(c.log.length + 5);
    await c.merged(t, S1, merge);
    expect(doneGate(c.state(), c.state().tasks.get(t)!)).toEqual({ kind: "bypassed", missing: ["CI run 11 green before the merge"] });
    await c.ci(S1, 11, "success", merge - 2_000);
    expect(doneGate(c.state(), c.state().tasks.get(t)!)?.kind).toBe("landed");
    await c.ci(S1, 11, undefined, merge + 30_000, 2);
    await c.ci(S1, 11, "failure", merge + 60_000, 2);
    expect(doneGate(c.state(), c.state().tasks.get(t)!)?.kind).toBe("landed");
  });

  test("case 11: a task.landed with missing evidence is refused", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    const early = await c.land("jow", t, prAt(S1));
    expect(c.state().rejected.get(early.seq)).toBe(`T${t} hasn't landed: it waits for PR #7 to merge`);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
  });

  test("case 12: a task.landed naming a stale artifact is refused", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    await c.merged(t, S1, at(c.log.length + 1));
    const stale = await c.land("jow", t, prAt(S2));
    expect(c.state().rejected.get(stale.seq)).toBe(`T${t} lands at o/r#7 at ${S1.slice(0, 7)}, not o/r#7 at ${S2.slice(0, 7)}`);
  });

  test("only the owner's app, the lead or the lander posts task.landed", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    await c.merged(t, S1, at(c.log.length + 1));
    const forged = await c.land("zed", t, prAt(S1));
    expect(c.state().rejected.get(forged.seq)).toBe(`only the owner's app, the lead or ann lands T${t}`);
    await c.land("ann", t, prAt(S1));
    expect(c.state().tasks.get(t)!.state).toBe("done");
  });

  test("a merge at another head than the approved one is a bypass", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    await c.merged(t, S2, at(c.log.length + 1));
    const s = c.state();
    expect(s.tasks.get(t)!.state).toBe("landing");
    expect(doneGate(s, s.tasks.get(t)!)).toEqual({ kind: "bypassed", missing: [`an approval at ${S2.slice(0, 7)}`] });
  });

  test("release:tag needs a release that contains the merge commit, which may come after the merge", async () => {
    const c = await channel("release:tag");
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    await c.merged(t, S1, at(c.log.length + 1));
    expect(doneGate(c.state(), c.state().tasks.get(t)!)).toEqual({ kind: "waiting", why: "a release that contains PR #7" });
    await c.ev("jow", { op: "github.release", repo: R, tag: "v1.0.0", at: at(c.log.length + 1), shas: [M1], prs: [] });
    expect(doneGate(c.state(), c.state().tasks.get(t)!)).toEqual({ kind: "landed", artifact: prAt(S1) });
  });

  test("case 6: a tag without the npm publish stays landing; a passed post check for a version in range lands it", async () => {
    const c = await channel("release:npm:@scope/lib@^1.2.0");
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    await c.merged(t, S1, at(c.log.length + 1));
    await c.ev("jow", { op: "github.release", repo: R, tag: "v1.3.0", at: at(c.log.length + 1), shas: [M1], prs: [7] });
    expect(doneGate(c.state(), c.state().tasks.get(t)!)).toEqual({ kind: "waiting", why: "a passed post check for @scope/lib@^1.2.0 on npm" });
    const wrong = await c.say("ann", "blocking", "npm view @scope/lib@2.0.0", {
      to: ["jow"],
      esc: true,
      choices: ["A: published", "B: not there"],
      holds: [t],
      check: { phase: "post", decider: "jow", artifact: { kind: "npm", pkg: "@scope/lib", version: "2.0.0" } },
    });
    await c.answer(wrong, "A: published");
    expect(doneGate(c.state(), c.state().tasks.get(t)!)?.kind).toBe("waiting");
    const post = await c.say("ann", "blocking", "npm view @scope/lib@1.3.0", {
      to: ["jow"],
      esc: true,
      choices: ["A: published", "B: not there"],
      holds: [t],
      check: { phase: "post", decider: "jow", artifact: { kind: "npm", pkg: "@scope/lib", version: "1.3.0" } },
    });
    await c.answer(post, "A: published");
    const artifact: CheckArtifact = { kind: "npm", pkg: "@scope/lib", version: "1.3.0" };
    expect(doneGate(c.state(), c.state().tasks.get(t)!)).toEqual({ kind: "landed", artifact });
    await c.land("jow", t, artifact);
    expect(c.state().tasks.get(t)!.landed?.key).toBe(`T${t}:npm:@scope/lib@1.3.0`);
  });

  describe("run tasks (T1269)", () => {
    const job = (id: string): CheckArtifact => ({ kind: "run", id });
    const runCheck = (phase: CheckAsk["phase"], id: string): CheckAsk => ({ phase, decider: "jow", artifact: job(id) });
    async function crowd(c: Awaited<ReturnType<typeof channel>>, first: number, count: number, started: number) {
      for (let done = 0; done < count; done += 50)
        await c.github(
          Array.from({ length: Math.min(50, count - done) }, (_, k) => ({
            event: "workflow_run",
            run: first + done + k,
            name: "CI",
            title: `ci-${first + done + k}`,
            sha: S1,
            status: "completed",
            started,
          })),
        );
    }
    async function runTask(seen = 0) {
      const c = await channel("run");
      await crowd(c, 1, seen, at(0));
      const t = await c.task();
      const declare = (id: string, started?: number) => c.ev("ann", { op: "task.update", task: t, run: { id, ...(started !== undefined ? { started } : {}) } });
      const approveRun = async (id: string) => {
        await c.ev("ann", { op: "task.update", task: t, state: "review", at: `run:${id}` });
        await c.ev("mac", { op: "task.update", task: t, state: "done", verdict: "approved", round: c.state().tasks.get(t)!.rounds.length, at: `run:${id}` });
      };
      const ask = (phase: CheckAsk["phase"], id: string) =>
        c.say("ann", "blocking", "Is the run good?", { to: ["jow"], esc: true, choices: ["A: good", "B: not yet"], holds: [t], check: runCheck(phase, id) });
      const answer = (m: Message) => c.answer(m, "A: good");
      const passed = async (phase: CheckAsk["phase"], id: string) => answer(await ask(phase, id));
      const gate = () => doneGate(c.state(), c.state().tasks.get(t)!);
      return { c, t, declare, approveRun, ask, answer, passed, gate };
    }

    test("a run approved at its declared id, cleared before it started and confirmed after, still waits with only the start its runner reports", async () => {
      const r = await runTask(1);
      await r.declare("job-1");
      const pre = await r.ask("pre-ship", "job-1");
      await r.approveRun("job-1");
      expect(shipGate(r.c.state(), r.c.state().tasks.get(r.t)!)).toEqual({ open: false, rejected: false, missing: [`check #${pre.seq}`] });
      await r.answer(pre);
      expect(shipGate(r.c.state(), r.c.state().tasks.get(r.t)!)).toEqual({ open: true });
      expect(r.gate()).toEqual({ kind: "waiting", why: runStarts("job-1") });
      await r.declare("job-1", at(r.c.log.length) + 500);
      await r.passed("post", "job-1");
      expect(r.gate()).toEqual({ kind: "waiting", why: runStarts("job-1") });
      expect(landingsDue({ ...r.c.state(), tasks: r.c.state().tasks })).toEqual([]);
      const landed = await r.c.land("jow", r.t, job("job-1"));
      expect(r.c.state().rejected.get(landed.seq)).toBe(`T${r.t} hasn't landed: it waits for ${runStarts("job-1")}`);
      await r.c.ev("jow", { op: "task.update", task: r.t, state: "done", close: "job-1 ran clean, checked by hand" });
      expect(r.c.state().tasks.get(r.t)!).toMatchObject({ state: "done", closedWith: "job-1 ran clean, checked by hand" });
    });

    test("a reported start later than the real one can't turn a late pre-ship pass into a landing", async () => {
      const r = await runTask(1);
      await r.declare("job-1");
      const ask = await r.c.say("ann", "blocking", "Is the run good?", { to: ["jow"], esc: true, choices: ["A: good", "B: not yet"], holds: [r.t], check: runCheck("pre-ship", "job-1") });
      await r.approveRun("job-1");
      const realStart = at(r.c.log.length) + 100;
      const answer = await r.c.answer(ask, "A: good");
      expect(answer.rts!).toBeGreaterThan(realStart);
      await r.declare("job-1", at(r.c.log.length) + 500);
      await r.passed("post", "job-1");
      expect(r.gate()).toEqual({ kind: "waiting", why: runStarts("job-1") });
      expect(landingsDue({ ...r.c.state(), tasks: r.c.state().tasks })).toEqual([]);
    });

    test("a post check answered with no trusted receipt time can't land a run", async () => {
      const r = await runTask();
      await r.declare("job-1");
      const pre = await r.ask("pre-ship", "job-1");
      await r.approveRun("job-1");
      await r.answer(pre);
      await r.declare("job-1", at(r.c.log.length) + 500);
      const post = await r.c.say("ann", "blocking", "Did it work?", { to: ["jow"], esc: true, choices: ["A: good", "B: not yet"], holds: [r.t], check: runCheck("post", "job-1") });
      await r.c.answer(post, "A: good", "none");
      expect(r.gate()?.kind).toBe("waiting");
      expect(landingsDue({ ...r.c.state(), tasks: r.c.state().tasks })).toEqual([]);
    });

    test("case 7: a run confirmation quoting a different run id doesn't count", async () => {
      const r = await runTask(1);
      await r.declare("job-1");
      const pre = await r.ask("pre-ship", "job-1");
      await r.approveRun("job-1");
      await r.answer(pre);
      await r.declare("job-1", at(r.c.log.length) + 500);
      await r.passed("post", "job-2");
      expect(r.gate()).toEqual({ kind: "waiting", why: runStarts("job-1") });
      const wrong = await r.c.land("jow", r.t, job("job-2"));
      expect(r.c.state().rejected.get(wrong.seq)).toBe(`T${r.t} hasn't landed: it waits for ${runStarts("job-1")}`);
      expect(r.c.state().tasks.get(r.t)!.state).toBe("landing");
    });

    test("case 14: a pre-ship check answered after the run's start counts as a bypass", async () => {
      const r = await runTask();
      await r.declare("job-1");
      const ask = await r.c.say("ann", "blocking", "Is the run good?", { to: ["jow"], esc: true, choices: ["A: good", "B: not yet"], holds: [r.t], check: runCheck("pre-ship", "job-1") });
      await r.approveRun("job-1");
      const started = at(r.c.log.length) + 500;
      await r.c.answer(ask, "A: good");
      await r.declare("job-1", started);
      await r.passed("post", "job-1");
      expect(r.gate()).toEqual({ kind: "bypassed", missing: [`check #${ask.seq} passed before the run`] });
      expect(landingsDue({ ...r.c.state(), tasks: r.c.state().tasks })).toEqual([]);
    });

    test("an approval pinned to another run, or none before the start, is a bypass", async () => {
      const r = await runTask();
      await r.declare("job-1");
      const pre = await r.ask("pre-ship", "job-1");
      await r.approveRun("job-0");
      await r.answer(pre);
      expect(shipGate(r.c.state(), r.c.state().tasks.get(r.t)!)).toEqual({ open: false, rejected: false, missing: ["an approval at run job-1"] });
      await r.declare("job-1", at(r.c.log.length) + 500);
      expect(r.gate()).toEqual({ kind: "bypassed", missing: ["an approval at run job-1"] });
    });

    test("case 15: started 10:00, pre-ship pass 10:05, proof at 10:10 with no start time: it stays landing and never lands by itself", async () => {
      const r = await runTask();
      await r.declare("job-1");
      const pre = await r.ask("pre-ship", "job-1");
      await r.approveRun("job-1");
      await r.answer(pre);
      await r.c.ev("ann", { op: "task.update", task: r.t, run: { id: "job-1" }, note: "ran" });
      await r.passed("post", "job-1");
      expect(r.gate()?.kind).toBe("waiting");
      expect(landingsDue({ ...r.c.state(), tasks: r.c.state().tasks })).toEqual([]);
      const forced = await r.c.land("jow", r.t, job("job-1"));
      expect(r.c.state().rejected.get(forced.seq)).toStartWith(`T${r.t} hasn't landed`);
      expect(r.c.state().tasks.get(r.t)!.state).toBe("landing");
      await r.c.ev("jow", { op: "task.update", task: r.t, state: "done", close: "ran by hand, no start time" });
      expect(r.c.state().tasks.get(r.t)!.closedWith).toBe("ran by hand, no start time");
    });

    test("a start time is the run's own: one later than the proof's receipt is refused, and the first one recorded stays", async () => {
      const r = await runTask();
      await r.declare("job-1");
      const future = await r.declare("job-1", at(r.c.log.length + 5));
      expect(r.c.state().rejected.get(future.seq)).toBe("run job-1 can't have started after its proof arrived");
      expect(r.c.state().tasks.get(r.t)!.run).toMatchObject({ id: "job-1" });
      expect(r.c.state().tasks.get(r.t)!.run?.reportedStart).toBeUndefined();
      const first = at(r.c.log.length);
      await r.declare("job-1", first);
      const moved = await r.declare("job-1", first + 100);
      expect(r.c.state().rejected.get(moved.seq)).toBe(`run job-1's start is already recorded`);
      expect(r.c.state().tasks.get(r.t)!.run?.reportedStart).toBe(first);
    });

    test("once approved, only a person or the lead declares another run, and that sends it back to review at the new run", async () => {
      const r = await runTask();
      await r.declare("job-1");
      await r.approveRun("job-1");
      const swap = await r.declare("job-2");
      expect(r.c.state().rejected.get(swap.seq)).toBe(`only a person or the lead declares another run for T${r.t} once it's approved`);
      await r.c.ev("jow", { op: "task.update", task: r.t, run: { id: "job-2" } });
      const t = r.c.state().tasks.get(r.t)!;
      expect(t.state).toBe("review");
      expect(t.run?.id).toBe("job-2");
      expect(t.rounds.at(-1)).toMatchObject({ at: "run:job-2", result: { kind: "open" } });
    });

    test("run is well formed with a run id and an optional start time", () => {
      const base = { v: 1, id: "x", from: "ann", kind: "event", body: "", ts: 1 };
      expect(wellFormed({ ...base, ev: { op: "task.update", task: 3, run: { id: "batch/job-1" } } })).toBe(true);
      expect(wellFormed({ ...base, ev: { op: "task.update", task: 3, run: { id: "job-1", started: T0 } } })).toBe(true);
      expect(wellFormed({ ...base, ev: { op: "task.update", task: 3, run: { id: "job 1" } } })).toBe(false);
      expect(wellFormed({ ...base, ev: { op: "task.update", task: 3, run: { id: "job-1", started: -1 } } })).toBe(false);
      expect(wellFormed({ ...base, ev: { op: "task.update", task: 3, run: { id: "job-1", extra: 1 } } })).toBe(false);
      expect(wellFormed({ ...base, ev: { op: "task.update", task: 3, at: `run:${"j".repeat(200)}` } })).toBe(true);
    });

    describe("GitHub's start for the declared run (T2183)", () => {
      const workflow = (r: Awaited<ReturnType<typeof runTask>>, run: number, title: string, started: number, from = "jow") =>
        r.c.ev(from, {
          op: "github",
          items: [{ event: "workflow_run", repo: R, at: at(r.c.log.length + 1), action: "requested", run, name: "deploy", title, status: "queued", sha: S1, happened: started, started }],
        } as Event);
      const now = (r: Awaited<ReturnType<typeof runTask>>) => at(r.c.log.length);
      async function cleared() {
        const r = await runTask(1);
        await r.declare("job-1");
        const pre = await r.ask("pre-ship", "job-1");
        await r.approveRun("job-1");
        await r.answer(pre);
        return r;
      }

      test("a workflow run named for the declared id, started after the approval and the pre-ship pass, lands on a post check answered after it, once", async () => {
        const r = await cleared();
        const started = now(r) + 500;
        await workflow(r, 4242, "job-1", started);
        expect(r.c.state().tasks.get(r.t)!.run?.start).toMatchObject({ repo: R, run: 4242, title: "job-1", started });
        expect(r.gate()).toEqual({ kind: "waiting", why: "a passed post check at run job-1, answered after it started" });
        await r.passed("post", "job-1");
        expect(r.gate()).toEqual({ kind: "landed", artifact: job("job-1") });
        expect(landingsDue({ ...r.c.state(), tasks: r.c.state().tasks }).map((d) => d.key)).toEqual([`T${r.t}:run:job-1`]);
        await r.c.land("jow", r.t, job("job-1"));
        const again = await r.c.land("ann", r.t, job("job-1"));
        const t = r.c.state().tasks.get(r.t)!;
        expect(t).toMatchObject({ state: "done", landed: { key: `T${r.t}:run:job-1`, by: "jow" } });
        expect(r.c.state().rejected.get(again.seq)).toBeUndefined();
        expect(t.notes.filter((n) => n.text.startsWith("landed:"))).toHaveLength(1);
      });

      test("a post check answered before GitHub's start doesn't confirm the run", async () => {
        const r = await cleared();
        await r.passed("post", "job-1");
        await workflow(r, 4242, "job-1", now(r) + 500);
        expect(r.gate()).toEqual({ kind: "waiting", why: "a passed post check at run job-1, answered after it started" });
        const forced = await r.c.land("jow", r.t, job("job-1"));
        expect(r.c.state().rejected.get(forced.seq)).toStartWith(`T${r.t} hasn't landed`);
      });

      test("the earliest start under the name counts: an earlier run is a bypass, whatever order GitHub's news comes in", async () => {
        const r = await runTask(1);
        const early = now(r) + 500;
        await r.declare("job-1");
        const pre = await r.ask("pre-ship", "job-1");
        await r.approveRun("job-1");
        await r.answer(pre);
        await workflow(r, 4243, "job-1", now(r) + 500);
        await workflow(r, 4242, "job-1", early);
        await r.passed("post", "job-1");
        expect(r.c.state().tasks.get(r.t)!.run?.start).toMatchObject({ run: 4242, started: early });
        expect(r.gate()?.kind).toBe("bypassed");
        expect(r.gate()).toMatchObject({ missing: expect.arrayContaining(["an approval before the run"]) });
        expect(landingsDue({ ...r.c.state(), tasks: r.c.state().tasks })).toEqual([]);
      });

      test("a run declared by GitHub's numeric id after it started is found, and shows as a bypass", async () => {
        const r = await runTask(1);
        await workflow(r, 4242, "Deploy", now(r) + 500);
        await r.declare("4242");
        const pre = await r.ask("pre-ship", "4242");
        await r.approveRun("4242");
        await r.answer(pre);
        expect(r.c.state().tasks.get(r.t)!.run?.start).toMatchObject({ run: 4242 });
        expect(r.gate()).toEqual({ kind: "bypassed", missing: ["an approval before the run", "a pre-ship check passed before the run"] });
      });

      test("no start comes from a run under another name, a CI job with the same id, or GitHub news from anyone but the owner's app", async () => {
        const r = await cleared();
        await workflow(r, 4242, "job-2", now(r) + 500);
        await r.c.ci(S1, 1, undefined, now(r) + 500);
        await r.c.github([{ event: "check_run", run: 4243, name: "job-1", status: "in_progress", sha: S1, happened: now(r) + 500, started: now(r) + 500 }]);
        const forged = await workflow(r, 4244, "job-1", now(r) + 500, "ann");
        expect(r.c.state().rejected.get(forged.seq)).toBe("only the owner's app posts GitHub's news");
        expect(r.c.state().tasks.get(r.t)!.run?.start).toBeUndefined();
        expect(r.gate()).toEqual({ kind: "waiting", why: runStarts("job-1") });
      });

      test("a reported start earlier than GitHub's still shows the bypass it reveals", async () => {
        const r = await runTask(1);
        await r.declare("job-1");
        const claimed = now(r);
        const pre = await r.ask("pre-ship", "job-1");
        await r.approveRun("job-1");
        await r.answer(pre);
        await r.declare("job-1", claimed);
        await workflow(r, 4242, "job-1", now(r) + 500);
        await r.passed("post", "job-1");
        expect(r.gate()).toMatchObject({ kind: "bypassed", missing: expect.arrayContaining(["an approval before the run"]) });
      });

      test("another run declared by a person drops the old run's start and finds the new one's", async () => {
        const r = await cleared();
        await workflow(r, 4242, "job-1", now(r) + 500);
        await r.c.ev("jow", { op: "task.update", task: r.t, run: { id: "job-2" } });
        expect(r.c.state().tasks.get(r.t)!.run).toMatchObject({ id: "job-2" });
        expect(r.c.state().tasks.get(r.t)!.run?.start).toBeUndefined();
      });

      async function landed(r: Awaited<ReturnType<typeof runTask>>) {
        await workflow(r, 4243, "job-1", now(r) + 500);
        await r.passed("post", "job-1");
        await r.c.land("jow", r.t, job("job-1"));
        expect(r.c.state().tasks.get(r.t)!.state).toBe("done");
      }

      test("an earlier run under the name, reported after the task landed, sends it back to landing with the bypass, live and from a snapshot", async () => {
        const r = await runTask(1);
        const early = now(r) + 500;
        await r.declare("job-1");
        const pre = await r.ask("pre-ship", "job-1");
        await r.approveRun("job-1");
        await r.answer(pre);
        await landed(r);
        const kept: { base?: FoldBase } = {};
        fold(r.c.log, roster, at(10_000), null, null, null, (b) => (kept.base = b));
        if (!kept.base) throw new Error("the fold kept no base");
        const n = kept.base.n;
        await workflow(r, 4242, "job-1", early);
        const live = r.c.state();
        const replayed = fold(r.c.log.slice(n), roster, at(10_000), null, null, kept.base);
        for (const s of [live, replayed]) {
          const t = s.tasks.get(r.t)!;
          expect(t.state).toBe("landing");
          expect(t.landed).toBeUndefined();
          expect(t.run?.start?.started).toBe(early);
          expect(doneGate(s, t)).toMatchObject({ kind: "bypassed", missing: expect.arrayContaining(["an approval before the run"]) });
          expect(t.notes.at(-1)?.text).toBe(`GitHub reports run 4242 for job-1, started earlier: its landing at run job-1 no longer holds, so it's back to landing`);
          expect(landingsDue({ ...s, tasks: s.tasks })).toEqual([]);
        }
      });

      test("an earlier run that still started after the gate opened leaves the landing alone", async () => {
        const r = await cleared();
        const opened = now(r) + 100;
        await landed(r);
        await workflow(r, 4244, "job-1", opened);
        const t = r.c.state().tasks.get(r.t)!;
        expect(t).toMatchObject({ state: "done", run: { start: { run: 4244, started: opened } } });
        expect(t.landed?.key).toBe(`T${r.t}:run:job-1`);
      });

      test("a task a person closed with a reason stays closed when an earlier run turns up", async () => {
        const r = await runTask(1);
        const early = now(r) + 500;
        await r.declare("job-1");
        await r.approveRun("job-1");
        await r.c.ev("jow", { op: "task.update", task: r.t, state: "done", close: "ran by hand" });
        await workflow(r, 4242, "job-1", early);
        expect(r.c.state().tasks.get(r.t)!).toMatchObject({ state: "done", closedWith: "ran by hand" });
      });

      test("runs forgotten since the task was created keep it from landing, even after a snapshot: an earlier run under the name could be among them", async () => {
        const r = await runTask(1);
        await workflow(r, 4242, "job-1", now(r) + 500);
        await crowd(r.c, 5000, 500, now(r) + 500);
        await r.declare("job-1");
        const pre = await r.ask("pre-ship", "job-1");
        await r.approveRun("job-1");
        await r.answer(pre);
        await workflow(r, 4243, "job-1", now(r) + 500);
        await r.passed("post", "job-1");
        expect(r.c.state().tasks.get(r.t)!.run).toMatchObject({ blind: true, start: { run: 4243 } });
        expect(r.gate()).toEqual({ kind: "waiting", why: runBlind("job-1") });
        const forced = await r.c.land("jow", r.t, job("job-1"));
        expect(r.c.state().rejected.get(forced.seq)).toBe(`T${r.t} hasn't landed: it waits for ${runBlind("job-1")}`);
        const kept: { base?: FoldBase } = {};
        fold(r.c.log, roster, at(10_000), null, null, null, (b) => (kept.base = b));
        if (!kept.base) throw new Error("the fold kept no base");
        expect(kept.base.github?.runsForgotten).toBeGreaterThanOrEqual(r.c.state().tasks.get(r.t)!.createdRts!);
        const n = kept.base.n;
        await r.c.ev("jow", { op: "task.update", task: r.t, run: { id: "job-2" } });
        const replayed = fold(r.c.log.slice(n), roster, at(10_000), null, null, kept.base);
        expect(replayed.tasks.get(r.t)!.run).toMatchObject({ id: "job-2", blind: true });
      });

      test("runs that started before the task was created, then were forgotten, don't hold it back", async () => {
        const r = await runTask(501);
        expect(r.c.state().github.runsForgotten).toBeLessThan(r.c.state().tasks.get(r.t)!.createdRts!);
        await r.declare("job-1");
        const pre = await r.ask("pre-ship", "job-1");
        await r.approveRun("job-1");
        await r.answer(pre);
        await workflow(r, 4243, "job-1", now(r) + 500);
        await r.passed("post", "job-1");
        expect(r.gate()).toEqual({ kind: "landed", artifact: job("job-1") });
      });

      test("a task created before Kiwi held any GitHub run start can't land by itself", async () => {
        const r = await runTask();
        await r.declare("job-1");
        const pre = await r.ask("pre-ship", "job-1");
        await r.approveRun("job-1");
        await r.answer(pre);
        await workflow(r, 4243, "job-1", now(r) + 500);
        await r.passed("post", "job-1");
        expect(r.gate()).toEqual({ kind: "waiting", why: runBlind("job-1") });
      });

      test("a run under the name that started before the task is out of scope, kept, forgotten or seen again alike (#2442, #2447)", async () => {
        const gates = [];
        for (const forget of [false, true]) {
          const r = await runTask(1);
          if (forget) await crowd(r.c, 5000, 500, at(0));
          expect(r.c.state().github.runs.has(`${R}/1`)).toBe(!forget);
          await r.declare("ci-1");
          const pre = await r.ask("pre-ship", "ci-1");
          await r.approveRun("ci-1");
          await r.answer(pre);
          await workflow(r, 4243, "ci-1", now(r) + 500);
          await r.passed("post", "ci-1");
          await workflow(r, 1, "ci-1", at(0));
          const t = r.c.state().tasks.get(r.t)!;
          expect(t.run).toMatchObject({ start: { run: 4243 } });
          expect(t.run?.blind).toBeUndefined();
          gates.push(r.gate());
        }
        expect(gates).toEqual([
          { kind: "landed", artifact: job("ci-1") },
          { kind: "landed", artifact: job("ci-1") },
        ]);
      });

      test("a task whose creation has no relay receipt time can't land by itself", async () => {
        const c = await channel("run");
        await crowd(c, 1, 1, at(0));
        const add = await c.say("ann", "event", "", { ev: { op: "task.add", title: "export", owner: "ann", review: "mac" } }, "none");
        await c.ev("ann", { op: "task.update", task: add.seq, run: { id: "job-1" } });
        const t = c.state().tasks.get(add.seq)!;
        expect(t.createdRts).toBeUndefined();
        expect(t.run).toMatchObject({ id: "job-1", blind: true });
      });

      test("a task restored without its creation receipt time can't land by itself, whatever its stored run says (#2744)", async () => {
        const r = await cleared();
        const kept: { base?: FoldBase } = {};
        fold(r.c.log, roster, at(10_000), null, null, null, (b) => (kept.base = b));
        if (!kept.base) throw new Error("the fold kept no base");
        const base: FoldBase = { ...kept.base, tasks: kept.base.tasks.map((t) => omit(t, "createdRts")) };
        await workflow(r, 4243, "job-1", now(r) + 500);
        await r.passed("post", "job-1");
        const replayed = fold(r.c.log.slice(base.n), roster, at(10_000), null, null, base);
        expect(doneGate(replayed, replayed.tasks.get(r.t)!)).toEqual({ kind: "waiting", why: runBlind("job-1") });
      });

      test("a snapshot from older fold rules keeps no run evidence: its runs, marks and bound starts are dropped, and declared runs turn blind (#2744)", async () => {
        const r = await cleared();
        await workflow(r, 4242, "job-1", now(r) + 500);
        const kept: { base?: FoldBase } = {};
        fold(r.c.log, roster, at(10_000), null, null, null, (b) => (kept.base = b));
        if (!kept.base?.github) throw new Error("the fold kept no base");
        const older: FoldBase = { ...kept.base, rules: FOLD_RULES - 1, github: { ...kept.base.github, runsSince: 3, runsForgotten: 40 } };
        await r.passed("post", "job-1");
        const later = await r.c.task();
        const replayed = fold(r.c.log.slice(older.n), roster, at(10_000), null, null, older);
        expect(replayed.github).toMatchObject({ runsSince: null, runsForgotten: null });
        expect(replayed.github.runs.size).toBe(0);
        const t = replayed.tasks.get(r.t)!;
        expect(t.run).toMatchObject({ id: "job-1", blind: true });
        expect(t.run?.start).toBeUndefined();
        expect(doneGate(replayed, t)).toEqual({ kind: "waiting", why: runBlind("job-1") });
        expect(replayed.tasks.get(later)!.createdRts).toBeDefined();
      });
    });
  });

  test("task.landed is well formed only with a task and an artifact", () => {
    const base = { v: 1, id: "x", from: "jow", kind: "event", body: "", ts: 1 };
    expect(wellFormed({ ...base, ev: { op: "task.landed", task: 3, artifact: prAt(S1) } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "task.landed", task: 3, artifact: { kind: "pr", repo: R, pr: 7, sha: "abc" } } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "task.landed", task: 3 } })).toBe(false);
  });

  describe("a rerun of a recorded CI run counts as it stood at the merge (#1365)", () => {
    async function rerun() {
      const c = await channel();
      const t = await c.task();
      await c.opened(t, S1);
      await c.ci(S1, 11, undefined, at(1));
      await c.ci(S1, 11, "success", at(2));
      await c.approve(t, S1, [11]);
      return { c, t, merge: at(c.log.length + 20) };
    }

    test("a rerun started before the merge and still running at it shuts the gate", async () => {
      const { c, t, merge } = await rerun();
      await c.ci(S1, 11, undefined, merge - 5_000, 2);
      await c.merged(t, S1, merge);
      expect(doneGate(c.state(), c.state().tasks.get(t)!)).toEqual({ kind: "bypassed", missing: ["CI run 11 green before the merge"] });
    });

    test("a rerun started before the merge whose green is reported late still holds", async () => {
      const { c, t, merge } = await rerun();
      await c.ci(S1, 11, undefined, merge - 5_000, 2);
      await c.merged(t, S1, merge);
      await c.ci(S1, 11, "success", merge - 1_000, 2);
      expect(doneGate(c.state(), c.state().tasks.get(t)!)?.kind).toBe("landed");
    });

    test("a rerun that started after the merge doesn't count against it", async () => {
      const { c, t, merge } = await rerun();
      await c.merged(t, S1, merge);
      await c.ci(S1, 11, undefined, merge + 5_000, 2);
      await c.ci(S1, 11, "failure", merge + 9_000, 2);
      expect(doneGate(c.state(), c.state().tasks.get(t)!)?.kind).toBe("landed");
    });

    test("a newer run of the same check, running or failed at the merge, shuts the gate the recorded run passed", async () => {
      const pending = await rerun();
      await pending.c.ci(S1, 12, undefined, pending.merge - 5_000);
      await pending.c.merged(pending.t, S1, pending.merge);
      expect(doneGate(pending.c.state(), pending.c.state().tasks.get(pending.t)!)).toEqual({ kind: "bypassed", missing: ["CI run 11 green before the merge"] });
      const failed = await rerun();
      await failed.c.ci(S1, 12, undefined, failed.merge - 5_000);
      await failed.c.ci(S1, 12, "failure", failed.merge - 2_000);
      await failed.c.merged(failed.t, S1, failed.merge);
      expect(doneGate(failed.c.state(), failed.c.state().tasks.get(failed.t)!)?.kind).toBe("bypassed");
    });

    test("a newer run of the same check that starts after the merge doesn't count against it", async () => {
      const { c, t, merge } = await rerun();
      await c.merged(t, S1, merge);
      await c.ci(S1, 12, undefined, merge + 5_000);
      await c.ci(S1, 12, "failure", merge + 9_000);
      expect(doneGate(c.state(), c.state().tasks.get(t)!)?.kind).toBe("landed");
    });

    test("a newer run of the same check with no trusted start time counts as started before the merge", async () => {
      const { c, t, merge } = await rerun();
      await c.merged(t, S1, merge);
      await c.ci(S1, 12, undefined, undefined);
      expect(doneGate(c.state(), c.state().tasks.get(t)!)?.kind).toBe("bypassed");
    });

    test("a rerun with no trusted start time counts as started before the merge", async () => {
      const { c, t, merge } = await rerun();
      await c.merged(t, S1, merge);
      await c.ci(S1, 11, undefined, undefined, 2);
      expect(doneGate(c.state(), c.state().tasks.get(t)!)?.kind).toBe("bypassed");
    });
  });

  describe("a merge before the approval is a bypass too (#1365)", () => {
    test("an unapproved task whose PR merges shows the bypass, and an agent can't cancel it away", async () => {
      const c = await channel();
      const t = await c.task();
      await c.opened(t, S1);
      await c.ev("ann", { op: "task.update", task: t, state: "review", at: S1 });
      await c.merged(t, S1, at(c.log.length + 1));
      const s = c.state();
      expect(s.tasks.get(t)!.state).toBe("review");
      expect(doneGate(s, s.tasks.get(t)!)).toEqual({ kind: "bypassed", missing: ["an approval before the merge"] });
      expect(landingWaits(s, s.tasks.get(t)!)).toBe("shipped while its ship gate was shut (missing an approval before the merge): a person closes it with a reason");
      const cancel = await c.ev("mac", { op: "task.update", task: t, state: "cancelled", note: "merged anyway" });
      expect(c.state().rejected.get(cancel.seq)).toBe(`T${t} shipped while its ship gate was shut: only a person or the lead closes it, with a reason`);
      const late = await c.ev("mac", { op: "task.update", task: t, state: "done", verdict: "approved", round: 1, at: S1 });
      expect(c.state().rejected.has(late.seq)).toBe(false);
      expect(c.state().tasks.get(t)!.state).toBe("landing");
      expect(doneGate(c.state(), c.state().tasks.get(t)!)?.kind).toBe("bypassed");
      await c.ev("jow", { op: "task.update", task: t, state: "done", close: "merged before review: reviewed after" });
      expect(c.state().tasks.get(t)!.state).toBe("done");
      expect(doneGate(c.state(), c.state().tasks.get(t)!)).toBeUndefined();
    });

    test("a task whose review was rejected and whose PR merged anyway is a bypass", async () => {
      const c = await channel();
      const t = await c.task();
      await c.opened(t, S1);
      await c.ev("ann", { op: "task.update", task: t, state: "review", at: S1 });
      await c.ev("mac", { op: "task.update", task: t, state: "doing", verdict: "rejected", round: 1, at: S1, note: "fix it" });
      await c.merged(t, S1, at(c.log.length + 1));
      const s = c.state();
      expect(s.tasks.get(t)!.state).toBe("doing");
      expect(doneGate(s, s.tasks.get(t)!)).toEqual({ kind: "bypassed", missing: ["an approval before the merge"] });
    });

    test("a task that isn't merged and isn't landing shows nothing", async () => {
      const c = await channel();
      const t = await c.task();
      await c.opened(t, S1);
      expect(doneGate(c.state(), c.state().tasks.get(t)!)).toBeUndefined();
    });
  });
});

describe("npm ranges for release:npm", () => {
  test.each([
    ["1.2.3", "1.2.3", true],
    ["1.2.4", "1.2.3", false],
    ["1.9.0", "^1.2.0", true],
    ["2.0.0", "^1.2.0", false],
    ["1.1.9", "^1.2.0", false],
    ["0.2.5", "^0.2.3", true],
    ["0.3.0", "^0.2.3", false],
    ["0.0.4", "^0.0.3", false],
    ["1.2.9", "~1.2.3", true],
    ["1.3.0", "~1.2.3", false],
    ["1.4.0", "1.x", true],
    ["2.0.0", "1.x", false],
    ["1.2.7", "1.2", true],
    ["3.1.4", "*", true],
    ["1.2.3-beta.1", "^1.2.0", false],
    ["1.2.3-beta.1", "1.2.3-beta.1", true],
    ["1.2.3", ">=1.0.0", false],
    ["1.2.3", "1.x.3", false],
  ])("%s in %s is %p", (version, range, ok) => {
    expect(inRange(version, range)).toBe(ok);
  });
});
