// What jev-ci needs from GitHub: the pass cache, job outputs, the run summary and one PR comment.
import { appendFileSync } from "node:fs"
import type { Decision, Plan } from "./plan.ts"

const API = "https://api.github.com"
const PASS_PREFIX = "jev-ci-pass-"
const MARKER = "<!-- jev-ci -->"

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error("GITHUB_TOKEN is not set")
  return fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  })
}

/** Jobs that passed before, as `job:hash`, read from the Actions cache keys each passing job saves. */
export async function passedJobs(repo: string, jobs: string[]): Promise<Set<string>> {
  const passed = new Set<string>()
  for (let page = 1; page <= 10; page++) {
    const res = await api(`/repos/${repo}/actions/caches?key=${PASS_PREFIX}&per_page=100&page=${page}`)
    if (!res.ok) throw new Error(`listing caches: ${res.status}`)
    const { actions_caches } = (await res.json()) as { actions_caches: { key: string }[] }
    for (const { key } of actions_caches) {
      const job = jobs.find((j) => key.startsWith(`${PASS_PREFIX}${j}-`))
      if (job) passed.add(`${job}:${key.slice(PASS_PREFIX.length + job.length + 1)}`)
    }
    if (actions_caches.length < 100) break
  }
  return passed
}

export function setOutput(name: string, value: string) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

export function summary(markdown: string) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n")
}

/** The pull request this run is for, from the event payload. */
export async function pullRequest(): Promise<number | undefined> {
  const path = process.env.GITHUB_EVENT_PATH
  if (!path) return undefined
  const event = (await Bun.file(path).json()) as { pull_request?: { number: number } }
  return event.pull_request?.number
}

/** Create or update this workflow's one comment on the PR. A fork's read-only token can't; that's fine. */
export async function upsertComment(repo: string, pr: number, body: string) {
  const text = `${MARKER}\n${body}`
  const res = await api(`/repos/${repo}/issues/${pr}/comments?per_page=100`)
  if (!res.ok) throw new Error(`reading comments: ${res.status}`)
  const mine = ((await res.json()) as { id: number; body: string }[]).find((c) => c.body.startsWith(MARKER))
  const write = mine
    ? await api(`/repos/${repo}/issues/comments/${mine.id}`, { method: "PATCH", body: JSON.stringify({ body: text }) })
    : await api(`/repos/${repo}/issues/${pr}/comments`, { method: "POST", body: JSON.stringify({ body: text }) })
  if (!write.ok) throw new Error(`writing comment: ${write.status}`)
}

const LAYER: Record<string, string> = { L0: "rule", L1: "cache", L2: "Jev", fallback: "fallback" }
const pct = (p?: number) => (p === undefined ? "" : `${Math.round(p * 100)}%`)

/** The plan as a markdown table, with each job's result once it's known. */
export function planTable(decisions: Decision[], names: Record<string, string>, results?: Record<string, string>): string {
  const icon = (d: Decision) => {
    const r = results?.[d.job]
    if (!r) return d.run ? "▶️ run" : "⏭️ skip"
    if (!d.run) return "⏭️ skipped"
    return r === "success" ? "✅ passed" : r === "failure" ? "❌ failed" : `⚪ ${r}`
  }
  const rows = decisions.map((d) => `| ${names[d.job] ?? d.job} | ${icon(d)} | ${LAYER[d.layer]} | ${pct(d.p)} | ${d.reason.replace(/\|/g, "\\|")} |`)
  return ["| Job | | Decided by | Jev | Why |", "|---|---|---|---|---|", ...rows].join("\n")
}

export function headline(p: Pick<Plan, "decisions" | "jevCalls" | "inputTokens">): string {
  const run = p.decisions.filter((d) => d.run).length
  const by = (l: string) => p.decisions.filter((d) => !d.run && d.layer === l).length
  const shadow = p.decisions.filter((d) => d.wouldSkip).length
  const parts = [`**${run} of ${p.decisions.length} jobs run.**`]
  const skips = [["L0", "rules"], ["L1", "cache"], ["L2", "Jev"]].filter(([l]) => by(l!)).map(([l, w]) => `${by(l!)} by ${w}`)
  if (skips.length) parts.push(`Skipped ${skips.join(", ")}.`)
  if (shadow) parts.push(`Jev would also skip ${shadow} (shadow mode).`)
  if (p.jevCalls) parts.push(`${p.jevCalls} Jev calls, ${p.inputTokens.toLocaleString("en-US")} tokens.`)
  return parts.join(" ")
}
