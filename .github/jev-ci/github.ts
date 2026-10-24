import { appendFileSync } from "node:fs";
import type { Decision, Plan } from "./plan.ts";

const API = "https://api.github.com";
const PASS_PREFIX = "jev-ci-pass-";
const MARKER = "<!-- jev-ci -->";

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  return fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
}

export interface PassCache {
  key: string;
  ref: string;
}

export interface PullEvent {
  repository?: { default_branch?: string };
  pull_request?: { number: number; base?: { repo?: { full_name?: string } | null }; head?: { repo?: { full_name?: string } | null } };
  merge_group?: { base_sha?: string; head_sha?: string; head_ref?: string };
  inputs?: { jobs?: string };
}

export const dispatchedJobs = (event: PullEvent): string[] =>
  (event.inputs?.jobs ?? "")
    .split(/[\s,]+/)
    .map((j) => j.trim())
    .filter(Boolean);

export interface QueueRun {
  id: number;
  event: string;
  path: string;
  head_sha: string;
  conclusion: string | null;
}

const SHA = /^[0-9a-f]{40}$/;

export function mergeGroupRange(event: PullEvent): { base: string; head: string } {
  const base = event.merge_group?.base_sha;
  const head = event.merge_group?.head_sha;
  if (!base || !head || !SHA.test(base) || !SHA.test(head)) throw new Error("the merge_group event names no base_sha and head_sha");
  return { base, head };
}

export function testedByQueue(runs: readonly QueueRun[], sha: string, workflow: string): number | null {
  return runs.find((r) => r.event === "merge_group" && r.path === workflow && r.head_sha === sha && r.conclusion === "success")?.id ?? null;
}

export function superseded(bad: readonly string[], results: Readonly<Record<string, string>>, newer: string | null): boolean {
  if (!newer || !bad.length || !Object.values(results).includes("cancelled")) return false;
  return bad.every((job) => results[job] === "cancelled" || results[job] === "skipped");
}

export async function queueRuns(repo: string, sha: string): Promise<QueueRun[]> {
  const res = await api(`/repos/${repo}/actions/runs?event=merge_group&head_sha=${sha}&status=success&per_page=50`);
  if (!res.ok) throw new Error(`listing merge queue runs: ${res.status}`);
  return ((await res.json()) as { workflow_runs: QueueRun[] }).workflow_runs;
}

export function trustedRef(event: PullEvent, ref: string | undefined): (cacheRef: string) => boolean {
  const branch = event.repository?.default_branch || "main";
  const main = `refs/heads/${branch}`;
  const queue = `refs/heads/gh-readonly-queue/${branch}/`;
  const pr = event.pull_request;
  const head = pr?.head?.repo?.full_name;
  const own = pr && ref && head && head === pr.base?.repo?.full_name ? ref : null;
  return (cacheRef) => cacheRef === main || cacheRef.startsWith(queue) || cacheRef === own;
}

export function passMarkers(caches: readonly PassCache[], jobs: readonly string[], trusted: (ref: string) => boolean): Set<string> {
  const passed = new Set<string>();
  const shards = new Map<string, Set<string>>();
  for (const { key, ref } of caches) {
    if (!trusted(ref)) continue;
    const job = jobs.find((j) => key.startsWith(`${PASS_PREFIX}${j}-`));
    if (!job) continue;
    const rest = key.slice(PASS_PREFIX.length + job.length + 1);
    const shard = /^(.+)-shard(\d+)of(\d+)$/.exec(rest);
    if (!shard) {
      passed.add(`${job}:${rest}`);
      continue;
    }
    const [, hash, i, n] = shard;
    const of = `${job}:${hash}:${n}`;
    shards.set(of, (shards.get(of) ?? new Set()).add(i!));
  }
  for (const [of, done] of shards) {
    const [job, hash, n] = of.split(":");
    if (Array.from({ length: Number(n) }, (_, i) => String(i + 1)).every((i) => done.has(i))) passed.add(`${job}:${hash}`);
  }
  return passed;
}

export async function passedJobs(repo: string, jobs: string[], trusted: (ref: string) => boolean): Promise<Set<string>> {
  const caches: PassCache[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await api(`/repos/${repo}/actions/caches?key=${PASS_PREFIX}&per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`listing caches: ${res.status}`);
    const { actions_caches } = (await res.json()) as { actions_caches: PassCache[] };
    caches.push(...actions_caches);
    if (actions_caches.length < 100) break;
  }
  return passMarkers(caches, jobs, trusted);
}

export function setOutput(name: string, value: string) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

export function summary(markdown: string) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
}

export async function pullEvent(): Promise<PullEvent> {
  const path = process.env.GITHUB_EVENT_PATH;
  return path ? ((await Bun.file(path).json()) as PullEvent) : {};
}

export async function pullRequest(): Promise<number | undefined> {
  return (await pullEvent()).pull_request?.number;
}

export async function upsertComment(repo: string, pr: number, body: string) {
  const text = `${MARKER}\n${body}`;
  const res = await api(`/repos/${repo}/issues/${pr}/comments?per_page=100`);
  if (!res.ok) throw new Error(`reading comments: ${res.status}`);
  const mine = ((await res.json()) as { id: number; body: string }[]).find((c) => c.body.startsWith(MARKER));
  const write = mine
    ? await api(`/repos/${repo}/issues/comments/${mine.id}`, { method: "PATCH", body: JSON.stringify({ body: text }) })
    : await api(`/repos/${repo}/issues/${pr}/comments`, { method: "POST", body: JSON.stringify({ body: text }) });
  if (!write.ok) throw new Error(`writing comment: ${write.status}`);
}

const LAYER: Record<string, string> = { L0: "rule", L1: "cache", L2: "Jev", fallback: "fallback" };
const pct = (p?: number) => (p === undefined ? "" : `${Math.round(p * 100)}%`);

export function planTable(decisions: Decision[], names: Record<string, string>, results?: Record<string, string>): string {
  const icon = (d: Decision) => {
    const r = results?.[d.job];
    if (!r) return d.run ? "▶️ run" : "⏭️ skip";
    if (!d.run) return "⏭️ skipped";
    return r === "success" ? "✅ passed" : r === "failure" ? "❌ failed" : `⚪ ${r}`;
  };
  const order = [...decisions].sort((a, b) => Number(b.run) - Number(a.run));
  const rows = order.map((d) => `| ${names[d.job] ?? d.job} | ${icon(d)} | ${LAYER[d.layer]} | ${pct(d.p)} | ${d.reason.replace(/\|/g, "\\|")} |`);
  return ["| Job | | Decided by | Jev | Why |", "|---|---|---|---|---|", ...rows].join("\n");
}

type Summary = Pick<Plan, "decisions" | "jevCalls" | "inputTokens"> & Partial<Pick<Plan, "changed" | "moved" | "notes">>;

export function headline(p: Summary): string {
  const run = p.decisions.filter((d) => d.run).length;
  const by = (l: string) => p.decisions.filter((d) => !d.run && d.layer === l).length;
  const shadow = p.decisions.filter((d) => d.wouldSkip).length;
  const parts = [`**${run} of ${p.decisions.length} jobs run.**`];
  const skips = [
    ["L0", "rules"],
    ["L1", "cache"],
    ["L2", "Jev"],
  ]
    .filter(([l]) => by(l!))
    .map(([l, w]) => `${by(l!)} by ${w}`);
  if (skips.length) parts.push(`Skipped ${skips.join(", ")}.`);
  if (shadow) parts.push(`Jev would also skip ${shadow} (shadow mode).`);
  if (p.changed !== undefined) parts.push(`${p.changed} file${p.changed === 1 ? "" : "s"} changed${p.moved ? `, ${p.moved} lines of it code moved verbatim` : ""}.`);
  if (p.jevCalls) parts.push(`${p.jevCalls} Jev calls, ${p.inputTokens.toLocaleString("en-US")} tokens.`);
  return parts.join(" ");
}

export const LEGEND = [
  "<details><summary>How jev-ci decides</summary>",
  "",
  "In order, per job (`.github/jev-ci.yml`, `.github/jev-ci/README.md`):",
  "",
  "1. **rule**: a planner change runs everything. A job runs when its own job in `ci.yml` (or a local action or workflow it uses) changed, when a file under its `always` changed, or, for static checks, when any file it checks changed. A job none of whose files changed is skipped. A `concurrency`, `on` or `name` edit in `ci.yml`, and a change to a job's description in `jev-ci.yml`, run nothing by themselves.",
  "2. **cache**: the job passed before on exactly these inputs, so it is skipped.",
  "3. **Jev**: for each changed file the job reads, Jev gives the chance the change makes that job fail. Code moved verbatim between files is shown to Jev as moved, not as new. The job runs when the combined chance reaches its threshold.",
  "4. **fallback**: Jev can't judge (too big, binary, unreachable), so the job runs.",
  "",
  "Pushes to main run everything, and if planning fails, everything runs.",
  "</details>",
].join("\n");

export function notesBlock(notes: string[] | undefined): string {
  return notes?.length ? `\n${notes.map((n) => `- ${n}`).join("\n")}\n` : "";
}
