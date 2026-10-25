import { inlineText } from "./membership.ts";
import { prChecks, rulesOf, type ChannelState, type GithubPr } from "./state.ts";

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

function taskPrIndex(state: ChannelState): Map<number, TaskPr> {
  const known = prIndexes.get(state.github);
  if (known) return known;
  const rank = (p: GithubPr) => (p.state === "open" ? 1 : 0);
  const best = new Map<number, GithubPr>();
  for (const p of state.github.prs.values()) {
    const id = taskOfBranch(p.branch, state.branchPrefix);
    if (id === null) continue;
    const held = best.get(id);
    if (!held || rank(p) > rank(held) || (rank(p) === rank(held) && p.at > held.at)) best.set(id, p);
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
