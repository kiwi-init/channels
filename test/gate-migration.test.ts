import { beforeAll, describe, expect, test } from "bun:test";
import type { CheckArtifact, CheckAsk } from "@kiwi/core/checks.ts";
import { formatStatus, reviewRuleWarning } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { FOLD_RULES, PROTOCOL_VERSION, wellFormed, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState, type FoldBase, type Roster } from "@kiwi/core/state.ts";

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
  const say = async (from: string, kind: Kind, body: string, extra: Extra = {}, rts?: number): Promise<Message> => {
    const seq = log.length + 1;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: at(seq), ...extra };
    const p = await sign(ids[from]!, payload);
    const m = { ...p, seq, rts: rts ?? at(seq), sigOk: await verify(p) };
    log.push(m);
    return m;
  };
  const ev = (from: string, e: Event) => say(from, "event", "", { ev: e });
  const github = (items: Record<string, unknown>[]) => ev("jow", { op: "github", items: items.map((i) => ({ repo: R, at: at(log.length + 1), ...i })) } as Event);
  const opened = (t: number, sha: string) => github([{ event: "pull_request", action: "opened", number: 7, state: "open", branch: `T${t}-x`, sha }]);
  const merged = (t: number, sha: string, when: number = at(log.length + 1)) =>
    github([{ event: "pull_request", action: "closed", number: 7, state: "closed", merged: true, merge: M1, branch: `T${t}-x`, sha, happened: when }]);
  const ci = (sha: string, run: number, conclusion: string | undefined, when: number) =>
    github([{ event: "check_run", sha, name: "build", run, attempt: 1, status: conclusion ? "completed" : "in_progress", ...(conclusion ? { conclusion } : {}), happened: when }]);
  const state = () => fold(log, roster, at(10_000));
  const task = async (): Promise<number> => (await ev("ann", { op: "task.add", title: "export", owner: "ann", review: "mac" })).seq;
  const review = (t: number, sha: string) => ev("ann", { op: "task.update", task: t, state: "review", at: sha });
  const verdict = (t: number, sha: string, runs?: number[]) =>
    ev("mac", { op: "task.update", task: t, state: "done", verdict: "approved", round: state().tasks.get(t)!.rounds.length, at: sha, ...(runs ? { runs } : {}) });
  const approve = async (t: number, sha: string, runs?: number[]) => {
    await review(t, sha);
    await verdict(t, sha, runs);
  };
  const askCheck = (t: number, check: CheckAsk) => say("ann", "blocking", "Check it on KDE", { to: ["jow"], esc: true, choices: OPTIONS, holds: [t], check });
  const answer = (ask: Message, body: string) => say("jow", "msg", body, { re: [ask.seq] });
  const land = (from: string, t: number, artifact: CheckArtifact) => ev(from, { op: "task.landed", task: t, artifact });
  await ev("jow", { op: "branch.prefix.set", prefix: "T" });
  await ev("jow", { op: "landing.set", then } as Event);
  return { log, ev, say, github, opened, merged, ci, state, task, review, verdict, approve, askCheck, answer, land };
}

type Channel = Awaited<ReturnType<typeof channel>>;

const prAt = (sha: string): CheckArtifact => ({ kind: "pr", repo: R, pr: 7, sha });
const kde = (sha: string, phase: CheckAsk["phase"] = "pre-ship"): CheckAsk => ({ phase, decider: "jow", artifact: prAt(sha) });

function baseAt(log: Message[], cut: number): FoldBase {
  const kept: { base?: FoldBase } = {};
  fold(log.slice(0, cut), roster, at(10_000), null, null, null, (b) => (kept.base = b));
  if (!kept.base) throw new Error("the fold kept no base");
  return kept.base;
}

const shape = (s: ChannelState) => ({
  tasks: [...s.tasks.values()],
  checks: [...s.checks.values()],
  rejected: [...s.rejected],
  asks: s.openAsks.map((m) => m.seq),
});

function sameFromEverySnapshot(c: Channel): void {
  const whole = shape(c.state());
  for (let cut = 3; cut <= c.log.length; cut++) {
    const base = baseAt(c.log, cut);
    expect({ cut, ...shape(fold(c.log.slice(base.n), roster, at(10_000), null, null, base)) }).toEqual({ cut, ...whole });
  }
}

describe("a log written under the ship gate folds to the same end (#3930 §6)", () => {
  test("a merge at the approved head and its owner's old landing event finish the task at that event, once", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    await c.merged(t, S1);
    const first = await c.land("jow", t, prAt(S1));
    const second = await c.land("jow", t, prAt(S1));
    const s = c.state();
    expect(s.tasks.get(t)).toMatchObject({ state: "done", closedSeq: first.seq });
    expect(s.rejected.has(second.seq)).toBe(false);
    expect(s.tasks.get(t)!.notes.filter((n) => n.text.startsWith("landed")).length).toBe(1);
    expect(s.tasks.get(t)!.steps?.map((x) => x.progress.kind)).toEqual(["ended"]);
    sameFromEverySnapshot(c);
  });

  test("an old landing event sent before the merge stays refused, and the later one lands", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    const early = await c.land("jow", t, prAt(S1));
    expect(c.state().rejected.get(early.seq)).toBe(`T${t} hasn't landed: its PR hasn't merged`);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    await c.merged(t, S1);
    const valid = await c.land("jow", t, prAt(S1));
    expect(c.state().tasks.get(t)).toMatchObject({ state: "done", closedSeq: valid.seq });
    sameFromEverySnapshot(c);
  });

  test("an old landing event naming another head than the merged one stays refused", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    await c.merged(t, S1);
    const stale = await c.land("jow", t, prAt(S2));
    expect(c.state().rejected.get(stale.seq)).toBe(`T${t} lands at o/r#7 at ${S1.slice(0, 7)}, not o/r#7 at ${S2.slice(0, 7)}`);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    sameFromEverySnapshot(c);
  });

  test("only the owner's app, the lead or the lander posts an old landing event", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    await c.merged(t, S1);
    const forged = await c.land("zed", t, prAt(S1));
    expect(c.state().rejected.get(forged.seq)).toBe(`only the owner's app, the lead or ann lands T${t}`);
    await c.land("ann", t, prAt(S1));
    expect(c.state().tasks.get(t)!.state).toBe("done");
    sameFromEverySnapshot(c);
  });

  test("a PR merged before its approval: the old landing event stays refused, and the close with a reason ends it", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.review(t, S1);
    await c.merged(t, S1);
    await c.verdict(t, S1);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    const refused = await c.land("jow", t, prAt(S1));
    expect(c.state().rejected.get(refused.seq)).toBe(`T${t}'s PR #7 merged without an approval before the merge: a person closes it with a reason`);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    const closed = await c.ev("jow", { op: "task.update", task: t, state: "done", close: "merged before its review: read after" });
    expect(c.state().tasks.get(t)).toMatchObject({ state: "done", closedSeq: closed.seq, closedWith: "merged before its review: read after" });
    sameFromEverySnapshot(c);
  });

  test("a merge at a head the approval doesn't cover: the old landing event stays refused", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    await c.merged(t, S2);
    const refused = await c.land("jow", t, prAt(S2));
    expect(c.state().rejected.get(refused.seq)).toBe(`T${t}'s PR #7 merged without an approval at ${S2.slice(0, 7)}: a person closes it with a reason`);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    sameFromEverySnapshot(c);
  });

  test("a recorded CI run that wasn't green at the merge keeps the old landing event refused; a late report of an early green lets it land", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.ci(S1, 11, undefined, 0);
    await c.approve(t, S1, [11]);
    const merge = at(c.log.length + 5);
    await c.merged(t, S1, merge);
    const refused = await c.land("jow", t, prAt(S1));
    expect(c.state().rejected.get(refused.seq)).toBe(`T${t}'s PR #7 merged without CI run 11 green before the merge: a person closes it with a reason`);
    await c.ci(S1, 11, "success", merge - 2_000);
    const landed = await c.land("jow", t, prAt(S1));
    expect(c.state().tasks.get(t)).toMatchObject({ state: "done", closedSeq: landed.seq });
    sameFromEverySnapshot(c);
  });

  test("release:tag and release:npm tasks end every old-value step on their old landing event", async () => {
    const tag = await channel("release:tag");
    const a = await tag.task();
    await tag.opened(a, S1);
    await tag.approve(a, S1);
    await tag.merged(a, S1);
    const unreleased = await tag.land("jow", a, prAt(S1));
    expect(tag.state().rejected.get(unreleased.seq)).toBe(`T${a} hasn't landed: it waits for a release that contains PR #7`);
    expect(tag.state().tasks.get(a)!.state).toBe("landing");
    await tag.ev("jow", { op: "github.release", repo: R, tag: "v1.0.0", at: at(tag.log.length + 1), shas: [M1], prs: [] });
    const released = await tag.land("jow", a, prAt(S1));
    expect(tag.state().tasks.get(a)).toMatchObject({ state: "done", closedSeq: released.seq });
    expect(
      tag
        .state()
        .tasks.get(a)!
        .steps?.map((x) => x.words),
    ).toEqual(["merge", "release"]);
    sameFromEverySnapshot(tag);

    const npm = await channel("release:npm:@scope/lib@^1.2.0");
    const b = await npm.task();
    await npm.opened(b, S1);
    await npm.approve(b, S1);
    await npm.merged(b, S1);
    const other = await npm.land("jow", b, { kind: "npm", pkg: "left-pad", version: "1.3.0" });
    expect(npm.state().rejected.get(other.seq)).toBe(`T${b} doesn't publish left-pad`);
    const published = await npm.land("jow", b, { kind: "npm", pkg: "@scope/lib", version: "1.3.0" });
    expect(npm.state().tasks.get(b)).toMatchObject({ state: "done", closedSeq: published.seq });
    sameFromEverySnapshot(npm);
  });

  test("a run task lands on its old landing event for the run it declared, and no other", async () => {
    const c = await channel("run");
    const t = await c.task();
    await c.ev("ann", { op: "task.update", task: t, run: { id: "job-1", started: at(1) } });
    await c.approve(t, "run:job-1");
    const other = await c.land("jow", t, { kind: "run", id: "job-2" });
    expect(c.state().rejected.get(other.seq)).toBe(`run job-2 isn't T${t}'s run`);
    const landed = await c.land("jow", t, { kind: "run", id: "job-1" });
    expect(c.state().tasks.get(t)).toMatchObject({ state: "done", closedSeq: landed.seq, run: { id: "job-1" } });
    sameFromEverySnapshot(c);
  });

  test("a changed outcome: an old landing event once refused only for a check passed after the merge is accepted now", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    const ask = await c.askCheck(t, kde(S1));
    await c.approve(t, S1);
    await c.merged(t, S1);
    await c.answer(ask, "A: works on KDE");
    const landed = await c.land("jow", t, prAt(S1));
    expect(c.state().rejected.has(landed.seq)).toBe(false);
    expect(c.state().tasks.get(t)).toMatchObject({ state: "done", closedSeq: landed.seq });
    sameFromEverySnapshot(c);
  });

  test("a changed outcome (owner #4529): an old landing event for a run whose start was never reported, once refused, is accepted now", async () => {
    const c = await channel("run");
    const t = await c.task();
    await c.ev("ann", { op: "task.update", task: t, run: { id: "job-1" } });
    await c.approve(t, "run:job-1");
    const landed = await c.land("jow", t, { kind: "run", id: "job-1" });
    expect(c.state().rejected.has(landed.seq)).toBe(false);
    expect(c.state().tasks.get(t)).toMatchObject({ state: "done", closedSeq: landed.seq });
    sameFromEverySnapshot(c);
  });

  test("a changed outcome (owner #4529): an old landing event for the task's package at a version outside its range and with no post check, once refused, is accepted now", async () => {
    const c = await channel("release:npm:@scope/lib@^1.2.0");
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    await c.merged(t, S1);
    const early = await c.land("jow", t, prAt(S1));
    expect(c.state().rejected.get(early.seq)).toBe(`T${t} hasn't landed: it waits for its package on npm`);
    const landed = await c.land("jow", t, { kind: "npm", pkg: "@scope/lib", version: "9.0.0" });
    expect(c.state().rejected.has(landed.seq)).toBe(false);
    expect(c.state().tasks.get(t)).toMatchObject({ state: "done", closedSeq: landed.seq });
    sameFromEverySnapshot(c);
  });

  test("an unchanged outcome: an old landing event for a release:tag task with no release that contains its PR stays refused", async () => {
    const c = await channel("release:tag");
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    await c.merged(t, S1);
    const early = await c.land("jow", t, prAt(S1));
    expect(c.state().rejected.get(early.seq)).toBe(`T${t} hasn't landed: it waits for a release that contains PR #7`);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    sameFromEverySnapshot(c);
  });

  test("changing an old task's landing value while it lands still sends it back to review, and the same value changes nothing", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    await c.ev("jow", { op: "task.update", task: t, then: "merge" });
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    expect(
      c
        .state()
        .tasks.get(t)!
        .steps?.map((x) => x.id),
    ).toEqual(["s1"]);
    await c.ev("jow", { op: "task.update", task: t, then: "release:tag" });
    expect(c.state().tasks.get(t)!.state).toBe("review");
    expect(
      c
        .state()
        .tasks.get(t)!
        .steps?.map((x) => x.words),
    ).toEqual(["merge", "release"]);
    await c.ev("jow", { op: "task.update", task: t, then: "none" });
    expect(c.state().tasks.get(t)!.steps).toBeUndefined();
    sameFromEverySnapshot(c);
  });

  test("a base kept under the older rules loses its landing value, landed record and run times, and keeps its steps", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.ev("ann", { op: "task.update", task: t, run: { id: "job-1" } });
    await c.approve(t, S1);
    const kept = baseAt(c.log, c.log.length);
    const older: FoldBase = {
      ...kept,
      rules: FOLD_RULES - 1,
      merges: "people",
      tasks: kept.tasks.map((x) => ({ ...x, then: "merge", landed: { key: "k" }, ...(x.run ? { run: { ...x.run, blind: true, reportedStart: at(1) } } : {}) })),
    } as FoldBase;
    const again = fold(c.log.slice(older.n), roster, at(10_000), null, null, older).tasks.get(t)!;
    expect(again).toEqual(c.state().tasks.get(t)!);
    expect(Object.keys(again)).not.toContain("then");
    expect(Object.keys(again)).not.toContain("landed");
  });
});

describe("with the gate gone, an old merge step ends like any other (#3930 §5, case 14)", () => {
  test("the PR-merged observation ends it and finishes the task", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    await c.merged(t, S1);
    const seen = await c.ev("jow", { op: "task.landed", task: t, step: "s1", artifact: prAt(S1) });
    expect(c.state().rejected.has(seen.seq)).toBe(false);
    expect(c.state().tasks.get(t)).toMatchObject({ state: "done", closedSeq: seen.seq });
    expect(c.state().tasks.get(t)!.notes.at(-1)!.text).toBe(`step s1 “merge” ended: o/r#7 at ${S1.slice(0, 7)}`);
    sameFromEverySnapshot(c);
  });

  test("a merge seen before the approval is remembered, and the approval finishes the task", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.review(t, S1);
    await c.merged(t, S1);
    await c.ev("jow", { op: "task.landed", task: t, step: "s1", artifact: prAt(S1) });
    expect(c.state().tasks.get(t)!.state).toBe("review");
    await c.verdict(t, S1);
    expect(c.state().tasks.get(t)!.state).toBe("done");
    expect(c.state().tasks.get(t)!.notes.at(-1)!.text).toBe(`step s1 “merge” ended: o/r#7 at ${S1.slice(0, 7)}, which merged before its approval`);
    sameFromEverySnapshot(c);
  });

  test("a task that was a bypass, approved after its PR merged, is plain landing: the observation ends it and the note says the merge came first", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.review(t, S1);
    await c.merged(t, S1);
    await c.verdict(t, S1);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    await c.ev("jow", { op: "task.landed", task: t, step: "s1", artifact: prAt(S1) });
    expect(c.state().tasks.get(t)!.state).toBe("done");
    expect(c.state().tasks.get(t)!.notes.at(-1)!.text).toBe(`step s1 “merge” ended: o/r#7 at ${S1.slice(0, 7)}, which merged before its approval`);
    sameFromEverySnapshot(c);
  });

  test("with no merge time from GitHub, or no relay time on the approval, the note says nothing about the order", async () => {
    const untimed = await channel();
    const a = await untimed.task();
    await untimed.opened(a, S1);
    await untimed.review(a, S1);
    await untimed.github([{ event: "pull_request", action: "closed", number: 7, state: "closed", merged: true, merge: M1, branch: `T${a}-x`, sha: S1 }]);
    await untimed.verdict(a, S1);
    await untimed.ev("jow", { op: "task.landed", task: a, step: "s1", artifact: prAt(S1) });
    expect(untimed.state().tasks.get(a)!.notes.at(-1)!.text).toBe(`step s1 “merge” ended: o/r#7 at ${S1.slice(0, 7)}`);
    sameFromEverySnapshot(untimed);

    const unstamped = await channel();
    const b = await unstamped.task();
    await unstamped.opened(b, S1);
    await unstamped.review(b, S1);
    await unstamped.merged(b, S1);
    await unstamped.verdict(b, S1);
    const approval = unstamped.log.at(-1)!;
    delete approval.rts;
    await unstamped.ev("jow", { op: "task.landed", task: b, step: "s1", artifact: prAt(S1) });
    expect(unstamped.state().tasks.get(b)).toMatchObject({ state: "done" });
    expect(unstamped.state().tasks.get(b)!.notes.at(-1)!.text).toBe(`step s1 “merge” ended: o/r#7 at ${S1.slice(0, 7)}`);
  });

  test("its lander says it done, with no gate to refuse it", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.approve(t, S1);
    const said = await c.ev("ann", { op: "task.landed", task: t, step: "s1", note: "merged by hand in Azure DevOps" });
    expect(c.state().rejected.has(said.seq)).toBe(false);
    expect(c.state().tasks.get(t)!.state).toBe("done");
    sameFromEverySnapshot(c);
  });

  test("an agent cancels a task whose PR merged unapproved: nothing calls it a bypass", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    await c.merged(t, S1);
    const cancelled = await c.ev("ann", { op: "task.update", task: t, state: "cancelled", note: "superseded" });
    expect(c.state().rejected.has(cancelled.seq)).toBe(false);
  });
});

describe("old checks stay questions that hold their task (#3930 §6)", () => {
  test("an unanswered pre-ship check is a step before the merge, and its decider's first option ends it", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    const ask = await c.askCheck(t, kde(S1));
    await c.approve(t, S1);
    const open = c.state();
    expect(open.tasks.get(t)!.steps?.map((x) => [x.words, x.progress.kind])).toEqual([
      [`check #${ask.seq}`, "open"],
      ["merge", "open"],
    ]);
    expect(open.openAsks.map((m) => m.seq)).toEqual([ask.seq]);
    await c.say("mac", "msg", "A: works on KDE", { re: [ask.seq] });
    expect(c.state().tasks.get(t)!.steps?.[0]?.progress.kind).toBe("open");
    await c.answer(ask, "A: works on KDE");
    expect(c.state().tasks.get(t)!.steps?.[0]?.progress.kind).toBe("ended");
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    sameFromEverySnapshot(c);
  });

  test("a passing answer given before the approval ends the step when its turn comes", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    const ask = await c.askCheck(t, kde(S1));
    await c.answer(ask, "A: works on KDE");
    expect(c.state().tasks.get(t)!.steps?.[0]?.progress).toMatchObject({ kind: "open", seen: { saw: `#${ask.seq} answered “A: works on KDE”` } });
    await c.approve(t, S1);
    expect(
      c
        .state()
        .tasks.get(t)!
        .steps?.map((x) => x.progress.kind),
    ).toEqual(["ended", "open"]);
    sameFromEverySnapshot(c);
  });

  test("a replacement retargets the step and takes the old question out of the open asks", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    const first = await c.askCheck(t, kde(S1));
    const second = await c.say("ann", "blocking", "Check it again", { to: ["jow"], esc: true, choices: OPTIONS, holds: [t], check: { ...kde(S1), replaces: first.seq } });
    const s = c.state();
    expect(s.openAsks.map((m) => m.seq)).toEqual([second.seq]);
    expect(s.tasks.get(t)!.steps?.map((x) => x.words)).toEqual([`check #${second.seq}`, "merge"]);
    await c.answer(first, "A: works on KDE");
    expect(c.state().tasks.get(t)!.steps?.[0]?.progress).toEqual({ kind: "open" });
    await c.answer(second, "A: works on KDE");
    await c.approve(t, S1);
    expect(
      c
        .state()
        .tasks.get(t)!
        .steps?.map((x) => x.progress.kind),
    ).toEqual(["ended", "open"]);
    sameFromEverySnapshot(c);
  });

  test("a post check is a question that holds the task and adds no step", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    const ask = await c.askCheck(t, kde(S1, "post"));
    expect(
      c
        .state()
        .tasks.get(t)!
        .steps?.map((x) => x.words),
    ).toEqual(["merge"]);
    expect(c.state().openAsks.map((m) => m.seq)).toEqual([ask.seq]);
    await c.answer(ask, "A: works on KDE");
    expect(c.state().openAsks).toEqual([]);
    sameFromEverySnapshot(c);
  });

  test("a base kept under the older rules drops each check's artifact and times", async () => {
    const c = await channel();
    const t = await c.task();
    await c.opened(t, S1);
    const ask = await c.askCheck(t, kde(S1));
    await c.answer(ask, "A: works on KDE");
    const kept = baseAt(c.log, c.log.length);
    const older = { ...kept, rules: FOLD_RULES - 1, checks: kept.checks?.map((x) => ({ ...x, artifact: prAt(S1), askedAt: at(1), answer: x.answer && { ...x.answer, at: at(2) } })) } as FoldBase;
    const again = fold(c.log.slice(older.n), roster, at(10_000), null, null, older);
    expect([...again.checks.values()]).toEqual([...c.state().checks.values()]);
    expect(Object.keys(again.checks.get(ask.seq)!)).not.toContain("artifact");
  });
});

describe("events the gate used still parse", () => {
  const base = { v: 1, id: "x", from: "jow", kind: "event", body: "", ts: 1 };

  test("an old landing event, a run with a start time, a landing value and who merges", () => {
    expect(wellFormed({ ...base, ev: { op: "task.landed", task: 3, artifact: prAt(S1) } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "task.landed", task: 3 } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "task.update", task: 3, run: { id: "job-1", started: T0 } } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "task.update", task: 3, then: "release:tag" } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "merges.set", by: "people" } })).toBe(true);
  });

  test("who merges folds to nothing", async () => {
    const c = await channel();
    const set = await c.ev("zed", { op: "merges.set", by: "people" });
    expect(c.state().rejected.has(set.seq)).toBe(false);
    expect(Object.keys(c.state())).not.toContain("merges");
  });
});

describe("kiwi status names a repo that still requires the retired check (#3930 §5, case 15)", () => {
  const CHECK = "kiwi/review/room-1";
  const status = (c: Channel) => formatStatus({ alias: "contrib", check: CHECK, me: "jow", state: c.state(), online: new Map(), unread: 0 });
  const rules = (c: Channel, repo: string, required: string[]) => c.ev("jow", { op: "github.rules", repo, branch: "main", required, merge: ["squash"] });

  test("with the requirement read: a warning and an owner step; unread or gone: none", async () => {
    const c = await channel();
    await c.ev("jow", { op: "repos.set", repos: [R, "o/other"] });
    expect(reviewRuleWarning(c.state(), CHECK)).toBeNull();
    await rules(c, R, ["build", CHECK]);
    await rules(c, "o/other", ["build"]);
    const warning = `warning: ${R} still requires ${CHECK}, which Kiwi has retired: it answers every pull request there green until the requirement is gone (an owner step: remove it from the repo's ruleset)`;
    expect(reviewRuleWarning(c.state(), CHECK)).toBe(warning);
    expect(status(c)).toContain(warning);
    expect(status(c)).not.toContain("who merges");
    await rules(c, R, ["build"]);
    expect(reviewRuleWarning(c.state(), CHECK)).toBeNull();
    expect(status(c)).not.toContain("still requires");
  });
});
