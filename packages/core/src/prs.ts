import { inlineText } from "./membership.ts";
import { REVIEW_CHECK } from "./protocol.ts";
import type { Task } from "./state/types.ts";
import { prChecks, prKey, rulesOf, type ChannelState, type GithubPr, type GithubState } from "./state.ts";
import { artifactText, doneGate, gateNow, landingPr } from "./done-gate.ts";

export interface PrChecks {
  passed: number;
  failed: string[];
  running: number;
  required?: string[];
  waiting?: string[];
}

export const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);

export function checksOf(state: ChannelState, pr: GithubPr): PrChecks | undefined {
  const runs = prChecks(state.github, pr);
  const required = rulesOf(state.github, pr.repo)?.required;
  if (required?.length) {
    const ran = new Map(runs.map((r) => [r.name, r.conclusion]));
    const failed = required.filter((n) => FAILED.has(ran.get(n) ?? ""));
    const waiting = required.filter((n) => !ran.get(n));
    return { passed: required.length - failed.length - waiting.length, failed, running: waiting.length, required, waiting };
  }
  if (!runs.length) return undefined;
  const failed = runs.filter((r) => r.conclusion && FAILED.has(r.conclusion)).map((r) => r.name);
  const running = runs.filter((r) => !r.conclusion).length;
  return { passed: runs.length - failed.length - running, failed, running };
}

export function rulesText(r: { required: readonly string[]; merge: readonly string[] }): string {
  const checks = r.required.length ? `${r.required.map((c) => inlineText(c, 60)).join(", ")} must pass` : "no required checks";
  return `${checks}; merges by ${r.merge.length ? r.merge.join(" or ") : "no method GitHub allows"}`;
}

const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;

export function prLinks(text: string): { url: string; repo: string; number: number }[] {
  const seen = new Map<string, { url: string; repo: string; number: number }>();
  for (const m of text.matchAll(PR_URL)) seen.set(m[0], { url: m[0], repo: m[1]!, number: Number(m[2]) });
  return [...seen.values()];
}

type TaskPr = { pr: GithubPr; checks?: PrChecks };

const prIndexes = new WeakMap<ChannelState["github"], Map<number, TaskPr>>();

const rankPr = (p: GithubPr): number => (p.state === "open" ? 1 : 0);

const betterPr = (p: GithubPr, held: GithubPr | undefined): boolean => !held || rankPr(p) > rankPr(held) || (rankPr(p) === rankPr(held) && p.at > held.at);

export function proofPr(github: GithubState, t: Pick<Task, "proof">): GithubPr | undefined {
  for (const p of [...(t.proof ?? [])].reverse())
    for (const l of prLinks(p.url)) {
      const pr = github.prs.get(prKey(l.repo, l.number));
      if (pr) return pr;
    }
  return undefined;
}

export function prOfTask(github: GithubState, prefix: string | null, t: Pick<Task, "id" | "proof">): GithubPr | undefined {
  let best: GithubPr | undefined;
  for (const p of github.prs.values()) if (taskOfBranch(p.branch, prefix) === t.id && betterPr(p, best)) best = p;
  return best ?? proofPr(github, t);
}

function taskPrIndex(state: ChannelState): Map<number, TaskPr> {
  const known = prIndexes.get(state.github);
  if (known) return known;
  const best = new Map<number, GithubPr>();
  for (const p of state.github.prs.values()) {
    const id = taskOfBranch(p.branch, state.branchPrefix);
    if (id === null) continue;
    if (betterPr(p, best.get(id))) best.set(id, p);
  }
  const index = new Map<number, TaskPr>();
  for (const [id, pr] of best) {
    const checks = checksOf(state, pr);
    index.set(id, checks ? { pr, checks } : { pr });
  }
  prIndexes.set(state.github, index);
  return index;
}

export function taskPr(state: ChannelState, id: number): TaskPr | undefined {
  return taskPrIndex(state).get(id);
}

const branchRes = new Map<string, RegExp>();

export function taskOfBranch(branch: string | undefined, prefix: string | null): number | null {
  if (!branch || !prefix) return null;
  let re = branchRes.get(prefix);
  if (!re) branchRes.set(prefix, (re = new RegExp(`^(?:[\\w.-]+\\/)?${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d{1,9})(?:$|[-_/.])`, "i")));
  const m = re.exec(branch);
  return m ? Number(m[1]) : null;
}

export function reviewNotRequired(state: Pick<ChannelState, "landing" | "repos" | "github">): string[] {
  if (state.landing !== "merge") return [];
  return state.repos.filter((repo) => !rulesOf(state.github, repo)?.required.includes(REVIEW_CHECK));
}

export function landingWaits(state: ChannelState, task: Task): string | null {
  const gate = doneGate(state, task);
  if (gate?.kind === "bypassed") return `shipped while its ship gate was shut (missing ${gate.missing.join(", ")}): a person closes it with a reason`;
  if (task.state !== "landing" || !task.then || task.then === "none") return null;
  if (!gate) return null;
  if (gate.kind === "landed") return `is ready to land at ${artifactText(gate.artifact)}: the owner's app marks it landed`;
  const pr = landingPr(state, task);
  if (pr?.state === "closed") return `waits: PR #${pr.number} was closed without merging`;
  return personMerge(state, task)?.text ?? `waits for ${gate.why}`;
}

function personMerge(state: ChannelState, task: Task): { ready: boolean; text: string } | undefined {
  const now = state.merges === "people" ? gateNow(state, task) : undefined;
  if (!now) return undefined;
  const pr = `PR #${now.pr.number}`;
  if (now.missing.length) return { ready: false, text: `waits for its ship gate (missing ${now.missing.join(", ")}) before a person merges ${pr}` };
  const checks = checksOf(state, now.pr);
  if (checks?.failed.length) return { ready: false, text: `isn't ready for a person to merge: ${pr}'s ${checks.failed.join(", ")} failed` };
  if (checks && checks.running > 0) return { ready: false, text: `waits for ${pr}'s checks to pass before a person merges it` };
  return { ready: true, text: `is ready for a person to merge ${pr}` };
}

export const readyForPerson = (state: ChannelState, task: Task): boolean => personMerge(state, task)?.ready === true;
