import { choiceIn, runPin, type CheckAsk } from "./checks.ts";
import type { ReviewCheck } from "./client/github.ts";
import { hasLanding, isReviewCheck, type Event } from "./protocol.ts";
import { prLinks, taskOfPr } from "./prs.ts";
import { linkedPr, sameHead } from "./stage.ts";
import { atRun, checkPassed } from "./state/checks.ts";
import { landingReopens, landingTouchedByClose } from "./state/tasks.ts";
import { prKey, shaKey, type GithubCheck, type GithubPr, type GithubState } from "./state/github.ts";
import type { ChannelState, ReviewRound, Task } from "./state/types.ts";

export type Gate = { open: true } | { open: false; rejected: boolean; missing: string[] };

const approvedRound = (t: Task): ReviewRound | undefined => {
  const last = t.rounds.at(-1);
  return last?.result.kind === "approved" && last.stale === undefined ? last : undefined;
};

const runsAt = (github: GithubState, repo: string, sha: string): GithubCheck[] =>
  [...(github.checks.get(shaKey(repo, sha))?.values() ?? [])].filter((c) => !isReviewCheck(c.name) && c.run !== undefined);

function runGate(state: ChannelState, t: Task): Gate {
  const id = t.run?.id;
  if (!id) return { open: false, rejected: false, missing: [`a run id: kiwi task proof T${t.id} --run ID`] };
  const missing: string[] = [];
  const round = approvedRound(t);
  if (!round) missing.push("an approval");
  else if (round.at !== runPin(id)) missing.push(`an approval at run ${id}`);
  const pre = [...state.checks.values()].filter((c) => c.holds.includes(t.id) && c.phase === "pre-ship" && c.supersededBy === undefined);
  if (!pre.length) missing.push(`a pre-ship check passed for run ${id}`);
  for (const c of pre) if (!atRun(c, id) || !checkPassed(c)) missing.push(`check #${c.seq}`);
  return missing.length ? { open: false, rejected: false, missing } : { open: true };
}

export function shipGate(state: ChannelState, t: Task, pr: GithubPr | undefined = linkedPr(state, t)): Gate {
  const last = t.rounds.at(-1);
  if (last?.result.kind === "rejected") return { open: false, rejected: true, missing: ["changes requested"] };
  if (t.then === "run") return runGate(state, t);
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

type AtHead = GithubPr & { sha: string };

type Commit = { repo: string; sha: string; prs: AtHead[]; claimed: boolean; claims: { t: Task; pr: AtHead }[] };

const gating = (t: Task): boolean => !(t.state === "done" && hasLanding(t.then));

function proofClaims(state: ChannelState): Map<string, Task[]> {
  const out = new Map<string, Task[]>();
  for (const t of state.tasks.values()) {
    if (t.archived) continue;
    for (const p of t.proof ?? [])
      for (const l of prLinks(p.url)) {
        const key = prKey(l.repo, l.number);
        const list = out.get(key) ?? [];
        if (!list.includes(t)) list.push(t);
        out.set(key, list);
      }
  }
  return out;
}

function claimantsOf(state: ChannelState, pr: GithubPr, proofs: ReadonlyMap<string, Task[]>): Task[] {
  const id = taskOfPr(pr, state);
  const byBranch = id === null ? undefined : state.tasks.get(id);
  const all = [...(byBranch && !byBranch.archived ? [byBranch] : []), ...(proofs.get(prKey(pr.repo, pr.number)) ?? [])];
  return [...new Set(all)];
}

function commitsOf(state: ChannelState): Map<string, Commit> {
  const proofs = proofClaims(state);
  const out = new Map<string, Commit>();
  for (const p of state.github.prs.values()) {
    if (p.state !== "open" || !p.sha) continue;
    const pr: AtHead = { ...p, sha: p.sha };
    const key = shaKey(pr.repo, pr.sha);
    const commit = out.get(key) ?? { repo: pr.repo, sha: pr.sha, prs: [], claimed: false, claims: [] };
    const claimants = claimantsOf(state, pr, proofs);
    commit.prs.push(pr);
    commit.claimed ||= claimants.length > 0;
    for (const t of claimants) if (gating(t)) commit.claims.push({ t, pr });
    out.set(key, commit);
  }
  return out;
}

const idsOf = (claims: readonly { t: Task }[]): number[] => [...new Set(claims.map(({ t }) => t.id))].sort((a, b) => a - b);

const labelOf = (ids: readonly number[]): string => ids.map((id) => `T${id}`).join(", ");

const CONCLUSION: Record<ReviewCheck["verdict"], string | undefined> = { approved: "success", waiting: undefined, rejected: "failure" };

export const UNCLAIMED = "no Kiwi task claims this PR";

const NO_VERDICT = "no verdict at this head yet";

const UNJUDGED: Gate = { open: false, rejected: false, missing: [NO_VERDICT] };

const postedAt = (state: ChannelState, check: string, repo: string, sha: string): GithubCheck | undefined => state.github.checks.get(shaKey(repo, sha))?.get(check);

const connectedRepos = (state: ChannelState): Set<string> => new Set(state.repos.map((r) => r.toLowerCase()));

export function reviewPosts(state: ChannelState, check: string): ReviewPost[] {
  const out: ReviewPost[] = [];
  const connected = connectedRepos(state);
  for (const c of commitsOf(state).values()) {
    const at = { repo: c.repo, sha: c.sha, pr: Math.min(...c.prs.map((p) => p.number)) };
    const posted = postedAt(state, check, c.repo, c.sha);
    if (!c.claimed) {
      if (connected.has(c.repo.toLowerCase()) && posted?.conclusion !== "success") out.push({ ...at, verdict: "approved", tasks: [], note: UNCLAIMED });
      continue;
    }
    if (!c.claims.length) continue;
    const judged = c.claims.map(({ t, pr }) => ({ t, gate: gateOf(state, t, pr) }));
    if (judged.every(({ gate }) => !gate)) {
      const ids = idsOf(c.claims);
      if (posted?.conclusion === "success") out.push({ ...at, verdict: "waiting", tasks: ids, note: `${labelOf(ids)}: ${NO_VERDICT}` });
      continue;
    }
    const gates = judged.map(({ t, gate }) => ({ t, gate: gate ?? UNJUDGED }));
    const shut = gates.flatMap(({ t, gate }) => (gate.open ? [] : [{ t, gate }]));
    const verdict: ReviewCheck["verdict"] = !shut.length ? "approved" : shut.some(({ gate }) => !gate.open && gate.rejected) ? "rejected" : "waiting";
    if (posted && (CONCLUSION[verdict] === undefined ? !posted.conclusion : posted.conclusion === CONCLUSION[verdict])) continue;
    const note = [...new Set(shut.map(({ t, gate }) => `T${t.id}: ${gate.open ? "" : gate.missing.join(", ")}`))].join("; ");
    out.push({ ...at, verdict, tasks: idsOf(gates), ...(note ? { note } : {}) });
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
  const removed = ev?.op === "ask.close" ? ev.ask : m.check?.replaces;
  if (removed !== undefined) for (const t of landingTouchedByClose(state.tasks, state.checks, removed)) tasks.add(t.id);
  const owner = [...state.members.values()].find((x) => x.owner)?.name;
  for (const id of m.re ?? []) {
    const c = state.checks.get(id);
    if (!c || c.phase !== "pre-ship" || c.closed !== undefined || c.supersededBy !== undefined || (m.from !== c.decider && m.from !== owner)) continue;
    const choice = choiceIn(m.body, c.choices);
    if (choice && choice !== c.choices[0]) for (const t of c.holds) if (gated(t)) tasks.add(t);
  }
  return { tasks, rejected };
}

function claimedBy(state: ChannelState, check: string, m: Outgoing, commits: ReadonlyMap<string, Commit>, taken: ReadonlySet<string>): ReviewCheck[] {
  const ev = m.ev;
  if (ev?.op !== "task.update" || !ev.proof || !state.tasks.has(ev.task)) return [];
  const connected = connectedRepos(state);
  return prLinks(ev.proof.url).flatMap((link) => {
    const pr = state.github.prs.get(prKey(link.repo, link.number));
    if (!pr?.sha || pr.state !== "open" || !connected.has(pr.repo.toLowerCase())) return [];
    const key = shaKey(pr.repo, pr.sha);
    const commit = commits.get(key);
    const claims = commit?.claims ?? [];
    if (taken.has(key) || claims.some(({ t, pr: at }) => t.id === ev.task && at.number === pr.number)) return [];
    if (postedAt(state, check, pr.repo, pr.sha)?.conclusion === "failure") return [];
    const tasks = [...new Set([...idsOf(claims), ev.task])].sort((a, b) => a - b);
    return [{ repo: pr.repo, sha: pr.sha, verdict: "waiting" as const, tasks, note: `T${ev.task}: just linked to this PR, so its gate isn't open yet` }];
  });
}

export function downgrades(state: ChannelState, check: string, m: Outgoing): ReviewCheck[] {
  const commits = commitsOf(state);
  const shutDown = shutDowngrades(state, m, commits);
  return [...shutDown, ...claimedBy(state, check, m, commits, new Set(shutDown.map((c) => shaKey(c.repo, c.sha))))];
}

function shutDowngrades(state: ChannelState, m: Outgoing, commits: ReadonlyMap<string, Commit>): ReviewCheck[] {
  const { tasks: shut, rejected } = shutBy(state, m);
  if (!shut.size) return [];
  const connected = connectedRepos(state);
  const out: ReviewCheck[] = [];
  for (const c of commits.values()) {
    const hit = idsOf(c.claims.filter(({ t }) => shut.has(t.id)));
    if (!hit.length || !connected.has(c.repo.toLowerCase())) continue;
    const already = c.claims.some(({ t, pr }) => {
      const gate = shut.has(t.id) ? undefined : gateOf(state, t, pr);
      return gate?.open === false && gate.rejected;
    });
    const verdict = rejected || already ? "rejected" : "waiting";
    out.push({
      repo: c.repo,
      sha: c.sha,
      verdict,
      tasks: idsOf(c.claims),
      note: `${labelOf(hit)}: ${rejected ? "changes requested" : "a pre-ship check isn't passed"}`,
    });
  }
  return out;
}

export async function postDowngrades(state: ChannelState, check: string, m: Outgoing, post: (c: ReviewCheck) => Promise<{ ticket?: string }>): Promise<string[]> {
  const tickets: string[] = [];
  for (const c of downgrades(state, check, m)) {
    try {
      const r = await post(c);
      if (r.ticket) tickets.push(r.ticket);
    } catch (err) {
      throw new Error(downgradeRefusal(c, err), { cause: err });
    }
  }
  return tickets;
}

export const downgradeRefusal = (c: ReviewCheck, err: unknown): string =>
  `kiwi/review on ${c.repo}@${c.sha.slice(0, 7)} has to turn ${c.verdict} before this goes out, and the relay didn't confirm it (${err instanceof Error && err.message ? err.message : "no answer"}): nothing was sent, try again`;
