import type { CheckArtifact } from "./checks.ts";
import { hasLanding, REVIEW_CHECK, type Landing } from "./protocol.ts";
import { prOfTask } from "./prs.ts";
import { sameHead } from "./stage.ts";
import { askedBefore, checkPassed, passedAt, replacedBefore, type CheckState } from "./state/checks.ts";
import { releaseOf, shaKey, succeededBy, type GithubPr, type GithubState } from "./state/github.ts";
import { heldBefore } from "./state/times.ts";
import type { ReviewRound, Task } from "./state/types.ts";

export type DoneGate = { kind: "landed"; artifact: CheckArtifact } | { kind: "waiting"; why: string } | { kind: "bypassed"; missing: string[] };

export interface GateView {
  github: GithubState;
  checks: ReadonlyMap<number, CheckState>;
  branchPrefix: string | null;
}

export const landingPr = (view: GateView, t: Task): GithubPr | undefined => prOfTask(view.github, view.branchPrefix, t);

function approvalAt(t: Task, x: number): ReviewRound | undefined {
  const current = t.rounds.filter((r) => r.rts === undefined || r.rts <= x).at(-1);
  return current?.result.kind === "approved" && heldBefore(current.result.rts, x) ? current : undefined;
}

const atPr = (c: CheckState, pr: GithubPr, head: string): boolean =>
  c.artifact.kind === "pr" && c.artifact.repo.toLowerCase() === pr.repo.toLowerCase() && c.artifact.pr === pr.number && sameHead(c.artifact.sha, head);

export function heldAtShipping(view: GateView, t: Task, pr: GithubPr, head: string, shipped: number): string[] {
  const missing: string[] = [];
  const round = approvalAt(t, shipped);
  if (!round) missing.push("an approval before the merge");
  else if (!round.at || !sameHead(round.at, head)) missing.push(`an approval at ${head.slice(0, 7)}`);
  for (const c of view.checks.values()) {
    if (!c.holds.includes(t.id) || c.phase !== "pre-ship" || !askedBefore(c, shipped) || replacedBefore(c, shipped)) continue;
    if (!atPr(c, pr, head) || !passedAt(c, shipped)) missing.push(`check #${c.seq} passed before the merge`);
  }
  const runs = [...(view.github.checks.get(shaKey(pr.repo, head))?.values() ?? [])].filter((c) => c.name !== REVIEW_CHECK);
  for (const id of round?.result.kind === "approved" ? (round.result.runs ?? []) : []) if (!runs.some((c) => succeededBy(c, id, shipped))) missing.push(`CI run ${id} green before the merge`);
  return missing;
}

const PLAIN = /^(\d+)\.(\d+)\.(\d+)$/;
const RANGE = /^([~^]?)(\d+|[x*])(?:\.(\d+|[x*]))?(?:\.(\d+|[x*]))?$/;

const order = (a: readonly number[], b: readonly number[]): number => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0);

export function inRange(version: string, range: string): boolean {
  if (version === range) return true;
  const v = PLAIN.exec(version);
  const r = RANGE.exec(range);
  if (!v || !r) return false;
  const have = [Number(v[1]), Number(v[2]), Number(v[3])];
  const given = [r[2], r[3], r[4]].map((part) => (part === undefined || part === "x" || part === "*" ? undefined : Number(part)));
  const wild = given.findIndex((n) => n === undefined);
  const fixed = wild === -1 ? 3 : wild;
  if (given.slice(fixed).some((n) => n !== undefined)) return false;
  if (fixed === 0) return true;
  const lo = given.map((n) => n ?? 0);
  if (!r[1] && fixed === 3) return order(have, lo) === 0;
  const first = lo.findIndex((n) => n !== 0);
  const bump = r[1] === "^" ? (first === -1 || first >= fixed ? fixed - 1 : first) : r[1] === "~" ? Math.min(1, fixed - 1) : fixed - 1;
  const hi = lo.map((n, i) => (i < bump ? n : i === bump ? n + 1 : 0));
  return order(have, lo) >= 0 && order(have, hi) < 0;
}

function npmStep(then: Landing): { pkg: string; range: string } | undefined {
  if (!then.startsWith("release:npm:")) return undefined;
  const spec = then.slice("release:npm:".length);
  const at = spec.lastIndexOf("@");
  return at > 0 ? { pkg: spec.slice(0, at), range: spec.slice(at + 1) } : undefined;
}

export function doneGate(view: GateView, t: Task): DoneGate | undefined {
  if (t.state !== "landing" || !t.then || !hasLanding(t.then)) return undefined;
  if (t.then === "run") return { kind: "waiting", why: "a person to close it with a reason: run tasks don't land on their own yet" };
  const pr = landingPr(view, t);
  if (!pr) return { kind: "waiting", why: "its PR to be linked and merged" };
  if (pr.state === "open") return { kind: "waiting", why: `PR #${pr.number} to merge` };
  if (pr.state === "closed") return { kind: "waiting", why: `a merged PR: #${pr.number} was closed without merging` };
  if (!pr.sha) return { kind: "bypassed", missing: [`PR #${pr.number}'s head at the merge`] };
  if (pr.mergedAt === undefined) return { kind: "bypassed", missing: [`GitHub's time for the merge of PR #${pr.number}`] };
  const missing = heldAtShipping(view, t, pr, pr.sha, pr.mergedAt);
  if (missing.length) return { kind: "bypassed", missing };
  const merged: CheckArtifact = { kind: "pr", repo: pr.repo, pr: pr.number, sha: pr.sha };
  if (t.then === "merge") return { kind: "landed", artifact: merged };
  if (t.then === "release:tag") return releaseOf(view.github, pr) ? { kind: "landed", artifact: merged } : { kind: "waiting", why: `a release that contains PR #${pr.number}` };
  const step = npmStep(t.then);
  if (!step) return { kind: "waiting", why: `a step Kiwi can read: ${t.then}` };
  const post = [...view.checks.values()].find(
    (c) => c.phase === "post" && c.holds.includes(t.id) && c.artifact.kind === "npm" && c.artifact.pkg === step.pkg && inRange(c.artifact.version, step.range) && checkPassed(c),
  );
  return post?.artifact.kind === "npm" ? { kind: "landed", artifact: post.artifact } : { kind: "waiting", why: `a passed post check for ${step.pkg}@${step.range} on npm` };
}

export const artifactKey = (task: number, a: CheckArtifact): string =>
  `T${task}:${a.kind === "pr" ? `pr:${a.repo.toLowerCase()}#${a.pr}@${a.sha}` : a.kind === "run" ? `run:${a.id}` : `npm:${a.pkg}@${a.version}`}`;

export const artifactText = (a: CheckArtifact): string => (a.kind === "pr" ? `${a.repo}#${a.pr} at ${a.sha.slice(0, 7)}` : a.kind === "run" ? `run ${a.id}` : `${a.pkg}@${a.version}`);

export function landingsDue(view: GateView & { tasks: ReadonlyMap<number, Task> }): { seq: number; task: Task; artifact: CheckArtifact; key: string }[] {
  const out: { seq: number; task: Task; artifact: CheckArtifact; key: string }[] = [];
  for (const t of view.tasks.values()) {
    const gate = t.archived ? undefined : doneGate(view, t);
    if (gate?.kind === "landed") out.push({ seq: t.id, task: t, artifact: gate.artifact, key: artifactKey(t.id, gate.artifact) });
  }
  return out;
}
