import { beforeAll, describe, expect, test } from "bun:test";
import type { CheckAsk } from "@kiwi/core/checks.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { downgrades, reviewPosts, shipGate } from "@kiwi/core/ship-gate.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";

const T0 = 1_760_000_000_000;
const R = "o/r";
const S1 = "1".repeat(40);
const S2 = "2".repeat(40);
const OPTIONS = ["A: works on KDE", "B: not yet"];
type Extra = Partial<Pick<Message, "to" | "ev" | "re" | "esc" | "choices" | "holds" | "check">>;

const ids: Record<string, Identity> = {};
let roster: Roster;
beforeAll(async () => {
  for (const n of ["jow", "ann", "mac"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

function channel() {
  const log: Message[] = [];
  const say = async (from: string, kind: Kind, body: string, extra: Extra = {}): Promise<Message> => {
    const seq = log.length + 1;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: T0 + seq * 1_000, ...extra };
    const p = await sign(ids[from]!, payload);
    const m = { ...p, seq, rts: T0 + seq * 1_000, sigOk: await verify(p) };
    log.push(m);
    return m;
  };
  const ev = (from: string, e: Event) => say(from, "event", "", { ev: e });
  const github = (items: Record<string, unknown>[]) => ev("jow", { op: "github", items: items.map((i) => ({ repo: R, at: T0 + log.length * 1_000, ...i })) } as Event);
  const pr = (number: number, sha: string, task: number) => github([{ event: "pull_request", action: "opened", number, state: "open", branch: `T${task}-x`, sha }]);
  const ci = (sha: string, run: number, conclusion?: string) =>
    github([{ event: "check_run", sha, name: "build", run, status: conclusion ? "completed" : "in_progress", ...(conclusion ? { conclusion, happened: T0 + log.length * 1_000 } : {}) }]);
  const state = () => fold(log, roster, T0 + 3_600_000);
  const task = async (title = "export"): Promise<number> => (await ev("ann", { op: "task.add", title, owner: "ann", review: "mac" })).seq;
  const approve = async (t: number, at: string, runs?: number[]) => {
    await ev("ann", { op: "task.update", task: t, state: "review", at });
    await ev("mac", { op: "task.update", task: t, state: "done", verdict: "approved", round: state().tasks.get(t)!.rounds.length, at, ...(runs ? { runs } : {}) });
  };
  const askCheck = (t: number, check: CheckAsk) => say("ann", "blocking", "Check it on KDE", { to: ["jow"], esc: true, choices: OPTIONS, holds: [t], check });
  const answer = (ask: Message, body: string) => say("jow", "msg", body, { re: [ask.seq] });
  return { log, ev, github, pr, ci, state, task, approve, askCheck, answer };
}

async function landingChannel() {
  const c = channel();
  await c.ev("jow", { op: "branch.prefix.set", prefix: "T" });
  await c.ev("jow", { op: "landing.set", then: "merge" });
  return c;
}

describe("the ship gate (#623 §4)", () => {
  test("it opens only with an approval at the PR's head and every recorded CI run green", async () => {
    const c = await landingChannel();
    const t = await c.task();
    await c.pr(9, S1, t);
    await c.ci(S1, 11, "success");
    await c.approve(t, S1);
    const s = c.state();
    expect(s.tasks.get(t)!.rounds.at(-1)!.result).toMatchObject({ kind: "approved", runs: [11] });
    expect(shipGate(s, s.tasks.get(t)!)).toEqual({ open: true });
    expect(reviewPosts(s)).toEqual([{ repo: R, sha: S1, pr: 9, verdict: "approved", tasks: [t] }]);
  });

  test("a PASS posted while CI is pending turns green once CI completes, with no other event (case 13)", async () => {
    const c = await landingChannel();
    const t = await c.task();
    await c.pr(9, S1, t);
    await c.ci(S1, 11);
    await c.approve(t, S1);
    expect(reviewPosts(c.state())[0]).toMatchObject({ verdict: "waiting", note: `T${t}: CI run 11 (pending)` });
    await c.ci(S1, 11, "success");
    expect(reviewPosts(c.state())[0]).toMatchObject({ verdict: "approved" });
  });

  test("a CI run the reviewer recorded that isn't at the head keeps the gate shut", async () => {
    const c = await landingChannel();
    const t = await c.task();
    await c.pr(9, S1, t);
    await c.approve(t, S1, [77]);
    const s = c.state();
    expect(shipGate(s, s.tasks.get(t)!)).toEqual({ open: false, rejected: false, missing: ["CI run 77 (not at this head)"] });
  });

  test("an approval records only the linked repo's runs, even when another repo has a run at the same commit", async () => {
    const c = await landingChannel();
    const t = await c.task();
    await c.pr(9, S1, t);
    await c.ci(S1, 11, "success");
    await c.github([{ repo: "other/fork", event: "check_run", sha: S1, name: "build", run: 22, status: "completed", conclusion: "failure" }]);
    await c.approve(t, S1);
    const s = c.state();
    expect(s.tasks.get(t)!.rounds.at(-1)!.result).toMatchObject({ kind: "approved", runs: [11] });
    expect(shipGate(s, s.tasks.get(t)!)).toEqual({ open: true });
  });

  test("the approval snapshots CI from the same PR the gate checks: the open one, not an older merged one in another repo", async () => {
    const c = await landingChannel();
    const t = await c.task();
    await c.github([{ repo: "old/repo", event: "pull_request", action: "closed", number: 3, state: "closed", merged: true, branch: `T${t}-old`, sha: S2 }]);
    await c.pr(9, S1, t);
    await c.ci(S1, 11, "failure");
    await c.approve(t, S1);
    const s = c.state();
    expect(s.tasks.get(t)!.rounds.at(-1)!.result).toMatchObject({ kind: "approved", runs: [11] });
    expect(shipGate(s, s.tasks.get(t)!)).toEqual({ open: false, rejected: false, missing: ["CI run 11 (failure)"] });
  });

  test("reopening a landing task for review shuts the gate, so it posts waiting first", async () => {
    const c = await landingChannel();
    await c.ev("jow", { op: "repos.set", repos: [R] });
    const t = await c.task();
    await c.pr(9, S1, t);
    await c.approve(t, S1);
    expect(downgrades(c.state(), { from: "ann", body: "", ev: { op: "task.update", task: t, state: "review", at: S1 } })).toMatchObject([{ verdict: "waiting", tasks: [t] }]);
    expect(downgrades(c.state(), { from: "ann", body: "", ev: { op: "task.update", task: t, note: "still landing" } })).toEqual([]);
  });

  test("a new head after the approval sends the task back to review, with no round opened (a merge of main too)", async () => {
    const c = await landingChannel();
    const t = await c.task();
    await c.pr(9, S1, t);
    await c.approve(t, S1);
    expect(c.state().tasks.get(t)!.state).toBe("landing");
    await c.github([{ event: "pull_request", action: "synchronize", number: 9, state: "open", branch: `T${t}-x`, sha: S2 }]);
    const s = c.state();
    const task = s.tasks.get(t)!;
    expect(task.state).toBe("review");
    expect(task.rounds).toHaveLength(1);
    expect(task.rounds[0]!.stale).toBeDefined();
    expect(shipGate(s, task)).toMatchObject({ open: false, missing: ["an approval"] });
    expect(reviewPosts(s)[0]).toMatchObject({ sha: S2, verdict: "waiting" });
  });

  test("a pre-ship check passed for the same SHA in a different PR doesn't count (case 1)", async () => {
    const c = await landingChannel();
    const t = await c.task();
    await c.pr(9, S1, t);
    const ask = await c.askCheck(t, { phase: "pre-ship", decider: "jow", artifact: { kind: "pr", repo: R, pr: 10, sha: S1 } });
    await c.answer(ask, "A");
    await c.approve(t, S1);
    const s = c.state();
    expect(shipGate(s, s.tasks.get(t)!)).toEqual({ open: false, rejected: false, missing: [`check #${ask.seq}`] });
  });

  test("a pre-ship check that passed for this PR at its head opens the gate; a 'not yet' keeps it shut", async () => {
    const c = await landingChannel();
    const t = await c.task();
    await c.pr(9, S1, t);
    const ask = await c.askCheck(t, { phase: "pre-ship", decider: "jow", artifact: { kind: "pr", repo: R, pr: 9, sha: S1 } });
    await c.approve(t, S1);
    await c.answer(ask, "B");
    expect(shipGate(c.state(), c.state().tasks.get(t)!).open).toBe(false);
    await c.answer(ask, "A");
    expect(shipGate(c.state(), c.state().tasks.get(t)!)).toEqual({ open: true });
  });

  test("a PR shared by two tasks is green only when both gates are open (case 2)", async () => {
    const c = await landingChannel();
    const a = await c.task("a");
    const b = await c.task("b");
    await c.pr(9, S1, a);
    await c.ev("ann", { op: "task.update", task: b, proof: { url: `https://github.com/${R}/pull/9` } });
    await c.approve(a, S1);
    const post = reviewPosts(c.state());
    expect(post).toHaveLength(1);
    expect(post[0]).toMatchObject({ pr: 9, verdict: "waiting", tasks: [a, b] });
    await c.approve(b, S1);
    expect(reviewPosts(c.state())[0]).toMatchObject({ verdict: "approved", tasks: [a, b] });
  });

  test("a check already posted with the same result isn't posted again", async () => {
    const c = await landingChannel();
    const t = await c.task();
    await c.pr(9, S1, t);
    await c.approve(t, S1);
    await c.github([{ event: "check_run", sha: S1, name: "kiwi/review", run: 900, status: "completed", conclusion: "success" }]);
    expect(reviewPosts(c.state())).toEqual([]);
  });

  test("without a landing step, kiwi/review keeps today's meaning: a verdict at its commit, nothing while unjudged", async () => {
    const c = channel();
    await c.ev("jow", { op: "branch.prefix.set", prefix: "T" });
    const t = await c.task();
    await c.pr(9, S1, t);
    expect(reviewPosts(c.state())).toEqual([]);
    await c.approve(t, S1);
    expect(reviewPosts(c.state())).toEqual([{ repo: R, sha: S1, pr: 9, verdict: "approved", tasks: [t] }]);
  });
});

describe("the downgrade a gate-shutting change posts first (#623 rule 1)", () => {
  const reject = (t: number) => ({ from: "mac", body: "", ev: { op: "task.update" as const, task: t, state: "doing" as const, verdict: "rejected" as const, round: 1 } });
  const preShip = (t: number) => ({ from: "ann", body: "Check it", holds: [t], check: { phase: "pre-ship" as const, decider: "jow", artifact: { kind: "pr" as const, repo: R, pr: 9, sha: S1 } } });

  test("a rejection posts failure at the linked PR's head; a new pre-ship check posts waiting; a repo that isn't connected gets nothing", async () => {
    const c = await landingChannel();
    const t = await c.task();
    await c.pr(9, S1, t);
    expect(downgrades(c.state(), reject(t))).toEqual([]);
    await c.ev("jow", { op: "repos.set", repos: [R] });
    expect(downgrades(c.state(), reject(t))).toEqual([{ repo: R, sha: S1, verdict: "rejected", tasks: [t], note: `T${t}: changes requested` }]);
    expect(downgrades(c.state(), preShip(t))).toEqual([{ repo: R, sha: S1, verdict: "waiting", tasks: [t], note: `T${t}: a pre-ship check isn't passed` }]);
    expect(downgrades(c.state(), { from: "ann", body: "hello" })).toEqual([]);
  });

  test("without a landing step only a rejection downgrades, as checks don't gate kiwi/review there", async () => {
    const c = channel();
    await c.ev("jow", { op: "branch.prefix.set", prefix: "T" });
    await c.ev("jow", { op: "repos.set", repos: [R] });
    const t = await c.task();
    await c.pr(9, S1, t);
    expect(downgrades(c.state(), preShip(t))).toEqual([]);
    expect(downgrades(c.state(), reject(t))).toMatchObject([{ verdict: "rejected" }]);
  });

  test("on a PR shared with a rejected task, a new check keeps kiwi/review failed instead of lifting it to waiting", async () => {
    const c = await landingChannel();
    await c.ev("jow", { op: "repos.set", repos: [R] });
    const a = await c.task("a");
    const b = await c.task("b");
    await c.pr(9, S1, a);
    await c.ev("ann", { op: "task.update", task: b, proof: { url: `https://github.com/${R}/pull/9` } });
    await c.ev("ann", { op: "task.update", task: a, state: "review", at: S1 });
    await c.ev("mac", { op: "task.update", task: a, state: "doing", verdict: "rejected", round: 1 });
    expect(downgrades(c.state(), preShip(b))).toEqual([{ repo: R, sha: S1, verdict: "rejected", tasks: [a, b], note: `T${b}: a pre-ship check isn't passed` }]);
  });

  test("only the check's decider or the owner withdrawing a pass downgrades", async () => {
    const c = await landingChannel();
    await c.ev("jow", { op: "repos.set", repos: [R] });
    const t = await c.task();
    await c.pr(9, S1, t);
    const ask = await c.askCheck(t, { phase: "pre-ship", decider: "jow", artifact: { kind: "pr", repo: R, pr: 9, sha: S1 } });
    expect(downgrades(c.state(), { from: "jow", body: "B", re: [ask.seq] })).toMatchObject([{ verdict: "waiting" }]);
    expect(downgrades(c.state(), { from: "jow", body: "A", re: [ask.seq] })).toEqual([]);
    expect(downgrades(c.state(), { from: "mac", body: "B", re: [ask.seq] })).toEqual([]);
  });
});
