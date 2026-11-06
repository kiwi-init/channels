import { choiceIn, type CheckAsk } from "./checks.ts";
import type { ReviewCheck } from "./client/github.ts";
import { hasLanding, REVIEW_CHECK, type Event } from "./protocol.ts";
import { linkedPr, sameHead } from "./stage.ts";
import { checkPassed } from "./state/checks.ts";
import { landingReopens } from "./state/tasks.ts";
import { shaKey, type GithubCheck, type GithubPr, type GithubState } from "./state/github.ts";
import type { ChannelState, ReviewRound, Task } from "./state/types.ts";

export type Gate = { open: true } | { open: false; rejected: boolean; missing: string[] };

const approvedRound = (t: Task): ReviewRound | undefined => {
  const last = t.rounds.at(-1);
  return last?.result.kind === "approved" && last.stale === undefined ? last : undefined;
};

const runsAt = (github: GithubState, repo: string, sha: string): GithubCheck[] =>
  [...(github.checks.get(shaKey(repo, sha))?.values() ?? [])].filter((c) => c.name !== REVIEW_CHECK && c.run !== undefined);

export function shipGate(state: ChannelState, t: Task, pr: GithubPr | undefined = linkedPr(state, t)): Gate {
  const last = t.rounds.at(-1);
  if (last?.result.kind === "rejected") return { open: false, rejected: true, missing: ["changes requested"] };
  if (t.then === "run") return { open: false, rejected: false, missing: ["a run task pins a run id (T689)"] };
  if (!pr?.sha) return { open: false, rejected: false, missing: ["no linked PR with a head"] };
  const head = pr.sha;
  const missing: string[] = [];
  const round = approvedRound(t);
  if (!round) missing.push("an approval");
  else if (!round.at || !sameHead(round.at, head)) missing.push(`an approval at ${head.slice(0, 7)}`);
  for (const c of state.checks.values()) {
    if (!c.holds.includes(t.id) || c.phase !== "pre-ship" || c.supersededBy !== undefined) continue;
    const here = c.artifact.kind === "pr" && c.artifact.repo.toLowerCase() === pr.repo.toLowerCase() && c.artifact.pr === pr.number && sameHead(c.artifact.sha, head);
    if (!here || !checkPassed(c)) missing.push(`check #${c.seq}`);
  }
  if (round?.result.kind === "approved") {
    const runs = runsAt(state.github, pr.repo, head);
    for (const id of round.result.runs ?? []) {
      const run = runs.find((c) => c.run === id);
      if (run?.conclusion !== "success") missing.push(`CI run ${id}${run ? ` (${run.conclusion ?? "pending"})` : " (not at this head)"}`);
    }
  }
  return missing.length ? { open: false, rejected: false, missing } : { open: true };
}

function verdictOnly(t: Task, head: string): Gate | undefined {
  const last = t.rounds.at(-1);
  if (!last?.at || last.stale !== undefined || !sameHead(last.at, head)) return undefined;
  if (last.result.kind === "approved") return { open: true };
  if (last.result.kind === "rejected") return { open: false, rejected: true, missing: ["changes requested"] };
  return undefined;
}

export type ReviewPost = ReviewCheck & { pr: number };

const gateOf = (state: ChannelState, t: Task, pr: GithubPr & { sha: string }): Gate | undefined => (hasLanding(t.then) ? shipGate(state, t, pr) : verdictOnly(t, pr.sha));

type Held = { pr: GithubPr & { sha: string }; tasks: Task[] };

function heldPrs(state: ChannelState): Map<string, Held> {
  const byPr = new Map<string, Held>();
  for (const t of state.tasks.values()) {
    if (t.archived || (t.state === "done" && hasLanding(t.then))) continue;
    const pr = linkedPr(state, t);
    const sha = pr?.sha;
    if (!pr || !sha || pr.state !== "open") continue;
    const key = `${pr.repo.toLowerCase()}#${pr.number}`;
    const held = byPr.get(key) ?? { pr: { ...pr, sha }, tasks: [] };
    held.tasks.push(t);
    byPr.set(key, held);
  }
  return byPr;
}

const labelOf = (ids: readonly number[]): string => ids.map((id) => `T${id}`).join(", ");

const CONCLUSION: Record<ReviewCheck["verdict"], string | undefined> = { approved: "success", waiting: undefined, rejected: "failure" };

export function reviewPosts(state: ChannelState): ReviewPost[] {
  const out: ReviewPost[] = [];
  for (const { pr, tasks } of heldPrs(state).values()) {
    const gates = tasks.flatMap((t) => {
      const gate = gateOf(state, t, pr);
      return gate ? [{ t, gate }] : [];
    });
    if (!gates.length) continue;
    const shut = gates.flatMap(({ t, gate }) => (gate.open ? [] : [{ t, gate }]));
    const verdict: ReviewCheck["verdict"] = !shut.length ? "approved" : shut.some(({ gate }) => !gate.open && gate.rejected) ? "rejected" : "waiting";
    const posted = state.github.checks.get(shaKey(pr.repo, pr.sha))?.get(REVIEW_CHECK);
    if (posted && (CONCLUSION[verdict] === undefined ? !posted.conclusion : posted.conclusion === CONCLUSION[verdict])) continue;
    const note = shut.map(({ t, gate }) => `T${t.id}: ${gate.open ? "" : gate.missing.join(", ")}`).join("; ");
    out.push({ repo: pr.repo, sha: pr.sha, pr: pr.number, verdict, tasks: gates.map(({ t }) => t.id).sort((a, b) => a - b), ...(note ? { note } : {}) });
  }
  return out.sort((a, b) => a.repo.localeCompare(b.repo) || a.pr - b.pr);
}

export interface Outgoing {
  from: string;
  body: string;
  re?: readonly number[];
  ev?: Event;
  check?: CheckAsk;
  holds?: readonly number[];
}

function shutBy(state: ChannelState, m: Outgoing): { tasks: Set<number>; rejected: boolean } {
  const tasks = new Set<number>();
  const ev = m.ev;
  const rejected = ev?.op === "task.update" && ev.verdict === "rejected";
  const gated = (id: number) => hasLanding(state.tasks.get(id)?.then);
  if (ev?.op === "task.update") {
    const task = state.tasks.get(ev.task);
    const reopens = ev.state === "review" || ev.state === "doing" || ev.state === "todo" || (!!task && landingReopens(task, ev));
    if (rejected || (reopens && (gated(ev.task) || hasLanding(ev.then)))) tasks.add(ev.task);
  }
  if (m.check?.phase === "pre-ship") for (const id of m.holds ?? []) if (gated(id)) tasks.add(id);
  const owner = [...state.members.values()].find((x) => x.owner)?.name;
  for (const id of m.re ?? []) {
    const c = state.checks.get(id);
    if (!c || c.phase !== "pre-ship" || c.closed !== undefined || c.supersededBy !== undefined || (m.from !== c.decider && m.from !== owner)) continue;
    const choice = choiceIn(m.body, c.choices);
    if (choice && choice !== c.choices[0]) for (const t of c.holds) if (gated(t)) tasks.add(t);
  }
  return { tasks, rejected };
}

export function downgrades(state: ChannelState, m: Outgoing): ReviewCheck[] {
  const { tasks: shut, rejected } = shutBy(state, m);
  if (!shut.size) return [];
  const connected = new Set(state.repos.map((r) => r.toLowerCase()));
  const out: ReviewCheck[] = [];
  for (const { pr, tasks } of heldPrs(state).values()) {
    const hit = tasks.filter((t) => shut.has(t.id)).map((t) => t.id);
    if (!hit.length || !connected.has(pr.repo.toLowerCase())) continue;
    const already = tasks.some((t) => {
      const gate = shut.has(t.id) ? undefined : gateOf(state, t, pr);
      return gate?.open === false && gate.rejected;
    });
    const verdict = rejected || already ? "rejected" : "waiting";
    out.push({
      repo: pr.repo,
      sha: pr.sha,
      verdict,
      tasks: tasks.map((t) => t.id).sort((a, b) => a - b),
      note: `${labelOf(hit)}: ${rejected ? "changes requested" : "a pre-ship check isn't passed"}`,
    });
  }
  return out;
}

export async function postDowngrades(state: ChannelState, m: Outgoing, post: (c: ReviewCheck) => Promise<unknown>): Promise<void> {
  for (const c of downgrades(state, m)) {
    try {
      await post(c);
    } catch (err) {
      throw new Error(downgradeRefusal(c, err), { cause: err });
    }
  }
}

export const downgradeRefusal = (c: ReviewCheck, err: unknown): string =>
  `kiwi/review on ${c.repo}@${c.sha.slice(0, 7)} has to turn ${c.verdict} before this goes out, and the relay didn't confirm it (${err instanceof Error && err.message ? err.message : "no answer"}): nothing was sent, try again`;
