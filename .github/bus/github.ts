import type { BusConfig } from "./config.ts"
import { taskOf } from "./events.ts"
import { must, run } from "./sh.ts"

const API = "https://api.github.com"

export type Item = {
  key: string
  kind: "branch" | "pr"
  ref: string
  sha: string
  task: string
  since: number
  title: string
  body: string
  number?: number
  branch?: string
}

export async function gh(path: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error("GITHUB_TOKEN is not set")
  return fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...init.headers },
    signal: AbortSignal.timeout(30_000),
  })
}

async function ghJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await gh(path, init)
  if (!res.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as T
}

export const slug = () => {
  const s = process.env.GITHUB_REPOSITORY
  if (!s) throw new Error("GITHUB_REPOSITORY is not set")
  return s
}

export function fetchBus(repo: string) {
  must(["git", "fetch", "-q", "--prune", "origin", "+refs/heads/main:refs/remotes/origin/main", "+refs/heads/bus/*:refs/remotes/origin/bus/*"], repo)
}

export function fetchItem(repo: string, item: Item) {
  fetchBus(repo)
  if (item.number) must(["git", "fetch", "-q", "origin", `+refs/pull/${item.number}/head:refs/remotes/origin/pr/${item.number}`], repo)
}

export function busBranches(repo: string, main: string): Item[] {
  const refs = must(["git", "for-each-ref", "--format=%(refname)%09%(objectname)%09%(committerdate:unix)", "refs/remotes/origin/bus/"], repo)
  return refs
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t") as [string, string, string])
    .map(([ref, sha, at]) => ({ ref, sha, at: Number(at), branch: ref.replace("refs/remotes/origin/", "") }))
    .filter((b) => b.branch !== "bus/staging" && !run(["git", "merge-base", "--is-ancestor", b.sha, main], repo).ok)
    .map((b) => {
      const log = must(["git", "log", "--reverse", "--format=%s%x1f%b%x1e", `${main}..${b.sha}`], repo)
      const commits = log.split("\x1e").map((c) => c.trim()).filter(Boolean).map((c) => c.split("\x1f") as [string, string])
      const title = commits.length === 1 ? commits[0]![0] : `${taskOf(b.branch)}: ${commits[0]?.[0] ?? b.branch}`
      const body = commits.length === 1 ? commits[0]![1].trim() : commits.map(([s, d]) => `* ${s}\n\n${d.trim()}`).join("\n\n")
      return { key: b.branch, kind: "branch" as const, ref: b.ref, sha: b.sha, task: taskOf(b.branch), since: b.at, title, body }
    })
}

type Pull = { number: number; title: string; body: string | null; head: { sha: string; ref: string; repo: { full_name: string } | null }; base: { ref: string } }
type IssueEvent = { event: string; label?: { name: string }; actor: { login: string } | null; created_at: string }

export type Queued = { items: Item[]; failed: { key: string; error: string }[] }

export async function queuedPulls(repo: string, cfg: BusConfig): Promise<Queued> {
  const s = slug()
  const issues = await ghJson<{ number: number; pull_request?: unknown }[]>(`/repos/${s}/issues?state=open&labels=${encodeURIComponent(cfg.label)}&per_page=100`)
  const items: Item[] = []
  const failed: Queued["failed"] = []
  for (const issue of issues.filter((i) => i.pull_request)) {
    try {
      const pr = await ghJson<Pull>(`/repos/${s}/pulls/${issue.number}`)
      if (pr.head.repo?.full_name !== s || pr.base.ref !== "main") continue
      const events = await ghJson<IssueEvent[]>(`/repos/${s}/issues/${pr.number}/events?per_page=100`)
      const labeled = events.filter((e) => e.event === "labeled" && e.label?.name === cfg.label).at(-1)
      if (!labeled?.actor) continue
      if (!cfg.maintainers.includes(labeled.actor.login)) {
        const perm = await ghJson<{ role_name: string }>(`/repos/${s}/collaborators/${labeled.actor.login}/permission`)
        if (!cfg.label_roles.includes(perm.role_name)) continue
      }
      must(["git", "fetch", "-q", "origin", `+refs/pull/${pr.number}/head:refs/remotes/origin/pr/${pr.number}`], repo)
      items.push({
        key: `pr:${pr.number}`,
        kind: "pr",
        ref: `refs/remotes/origin/pr/${pr.number}`,
        sha: pr.head.sha,
        task: `#${pr.number}`,
        since: Date.parse(labeled.created_at) / 1000,
        title: `${pr.title} (#${pr.number})`,
        body: (pr.body ?? "").trim(),
        number: pr.number,
        branch: pr.head.ref,
      })
    } catch (e) {
      const error = (e as Error).message
      failed.push({ key: `pr:${issue.number}`, error })
      console.log(`::warning title=queued PR #${issue.number} skipped::${error.replace(/\s+/g, " ").slice(0, 300)}`)
    }
  }
  return { items, failed }
}

export type Run = { id: number; status: string; conclusion: string | null; run_attempt: number; created_at?: string }

export async function ciRun(sha: string, branch: string): Promise<Run | undefined> {
  const res = await ghJson<{ workflow_runs: Run[] }>(`/repos/${slug()}/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=${encodeURIComponent(branch)}&per_page=5`)
  return res.workflow_runs[0]
}

export type Ci = { state: "green" | "red" | "pending" | "none"; startedAt?: number }

export async function ciState(sha: string, branch: string): Promise<Ci> {
  const r = await ciRun(sha, branch)
  if (!r) return { state: "none" }
  const startedAt = r.created_at ? Math.floor(Date.parse(r.created_at) / 1000) : undefined
  if (r.status !== "completed") return { state: "pending", ...(startedAt ? { startedAt } : {}) }
  const gate = (await runJobs(r)).find((j) => j.name === "ci-ok")
  return { state: gate?.conclusion === "success" ? "green" : gate?.conclusion ? "red" : "none", ...(startedAt ? { startedAt } : {}) }
}

export type Job = { id: number; name: string; conclusion: string | null }

export async function runJobs(r: Run): Promise<Job[]> {
  const res = await ghJson<{ jobs: Job[] }>(`/repos/${slug()}/actions/runs/${r.id}/attempts/${r.run_attempt}/jobs?per_page=100`)
  return res.jobs
}

export async function jobLog(id: number): Promise<string> {
  const res = await gh(`/repos/${slug()}/actions/jobs/${id}/logs`)
  return res.ok ? await res.text() : `(log unavailable: ${res.status})`
}

export function pushEnv(): Record<string, string> {
  const token = process.env.BUS_PUSH_TOKEN
  if (!token) throw new Error("BUS_PUSH_TOKEN is not set")
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    GIT_CONFIG_KEY_1: "core.hooksPath",
    GIT_CONFIG_VALUE_1: "/dev/null",
  }
}

export function push(repo: string, args: string[]) {
  must(["git", "push", "origin", ...args], repo, pushEnv())
}
