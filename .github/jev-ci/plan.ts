import { createHash } from "node:crypto"
import { matches, type Config } from "./config.ts"
import { readDiff, size, type FileChange } from "./diff.ts"
import { git } from "./git.ts"
import { ask, MODEL, type Request } from "./jev.ts"
import { changedWorkflowJobs, workflowJob } from "./workflow.ts"

type Layer = "L0" | "L1" | "L2" | "fallback"
export type Decision = {
  job: string
  run: boolean
  layer: Layer
  reason: string
  /** L2 only: the combined chance the job fails, and each file's share of it. */
  p?: number
  files?: { file: string; p: number }[]
  /** Shadow mode: Jev would have skipped this job, but it runs anyway. */
  wouldSkip?: boolean
}
export type Plan = {
  decisions: Decision[]
  /** Per job: hash of everything it reads at head, for the pass cache. */
  hashes: Record<string, string>
  changed: number
  jevLines: number
  jevCalls: number
  inputTokens: number
}

/** Hash of every file a job reads at `head`, plus its own CI definition. Same hash as a run that passed means the same result. */
function inputHash(repo: string, head: string, config: Config, job: string, tree?: string[]): string {
  const j = config.jobs[job]!
  const files = (tree ?? git(repo, ["ls-tree", "-r", head]).split("\n")).filter((l) => {
    const path = l.split("\t")[1]
    return path && (matches(j.inputs, path) || matches(j.always, path))
  })
  const definition = config.workflow ? JSON.stringify(workflowJob(repo, head, config.workflow, job) ?? null) : ""
  return createHash("sha256").update(files.join("\n")).update(definition).digest("hex").slice(0, 16)
}

/** Every job's input hash at `head`. */
export function allHashes(repo: string, head: string, config: Config): Record<string, string> {
  const tree = git(repo, ["ls-tree", "-r", head]).split("\n")
  return Object.fromEntries(Object.keys(config.jobs).map((job) => [job, inputHash(repo, head, config, job, tree)]))
}

/** L0: a version bump or a whitespace-only edit is no change at all. */
function meaningful(f: FileChange, config: Config): boolean {
  const v = config.version_only
  if (v && matches(v.files, f.path) && f.status === "modified" && f.hunks.length) {
    const re = new RegExp(v.pattern)
    if (f.hunks.every((h) => [...h.removed, ...h.added].every((l) => re.test(l)))) return false
  }
  return f.binary || f.status !== "modified" || f.hunks.length > 0
}

const reads = (patterns: string[], f: FileChange) => matches(patterns, f.path) || (!!f.from && matches(patterns, f.from))

const clip = (lines: string[]) => lines.map((l) => (l.length > 300 ? l.slice(0, 300) + " …" : l))

/** One Jev request per file: the file's change is the state, one yes/no question per job it can reach. */
function jevRequest(f: FileChange, jobs: string[], config: Config): Request {
  const state: Record<string, unknown> = { file: f.path, change: f.status }
  if (f.from) state.renamed_from = f.from
  if (matches(config.summarize_files, f.path)) state.change = "regenerated: a generated file, rebuilt from its source; content not shown"
  else if (f.status !== "deleted") state.hunks = f.hunks.map((h) => ({ in: h.at || undefined, removed: clip(h.removed), added: clip(h.added) }))
  const questions: Record<string, unknown> = {}
  for (const job of jobs)
    questions[job] = {
      type: "noul",
      instructions: {
        job: { name: config.jobs[job]!.name ?? job, what_it_checks: config.jobs[job]!.description },
        question: "Could this change to `file` make the CI job described in `job` fail?",
      },
      criteria: {
        true: "The change touches something this job checks, in a way that could make it fail.",
        false: "Nothing in the change can make this job fail: it only touches things this job does not check, or changes them in a way this job cannot detect.",
      },
    }
  return { model: MODEL, state, questions }
}

/** Every job runs, for one reason: pushes to main, a planner change, a failure to plan. */
export function runAll(config: Config, reason: string, hashes: Record<string, string> = {}, event?: string): Plan {
  const decisions = Object.keys(config.jobs).map((job) =>
    event === "push" && config.jobs[job]!.push === false
      ? { job, run: false, layer: "L0" as const, reason: "a push to main skips it: pull requests and manual runs plan it" }
      : { job, run: true, layer: "L0" as const, reason },
  )
  return { decisions, hashes, changed: 0, jevLines: 0, jevCalls: 0, inputTokens: 0 }
}

export async function plan(opts: {
  repo: string
  base: string
  head: string
  config: Config
  /** `job:inputHash` pairs that passed before. Omit to skip the cache layer. */
  passed?: Set<string>
}): Promise<Plan> {
  const { repo, base, head, config } = opts
  const jobs = Object.keys(config.jobs)
  const hashes = allHashes(repo, head, config)
  const changes = readDiff(repo, base, head).filter((f) => meaningful(f, config))
  const out: Plan = { decisions: [], hashes, changed: changes.length, jevLines: 0, jevCalls: 0, inputTokens: 0 }
  const decide = (d: Decision) => out.decisions.push(d)

  // L0: rules.
  const ciChange = changes.find((f) => matches(config.run_all_when_changed, f.path))
  if (ciChange) return { ...runAll(config, `${ciChange.path} changed: the planner or CI setup changed`, hashes), changed: changes.length }
  // A change to the workflow runs the jobs whose definition changed, or everything if shared parts did.
  let redefined = new Set<string>()
  if (config.workflow && changes.some((f) => f.path === config.workflow)) {
    const changed = changedWorkflowJobs(repo, base, head, config.workflow)
    if (changed === "all" || [...changed].some((j) => config.planner_jobs?.includes(j)))
      return { ...runAll(config, `${config.workflow} changed outside single jobs`, hashes), changed: changes.length }
    redefined = changed
  }
  const open: string[] = []
  for (const job of jobs) {
    const j = config.jobs[job]!
    const forced = changes.find((f) => reads(j.always ?? [], f))
    if (redefined.has(job)) decide({ job, run: true, layer: "L0", reason: "its CI definition changed" })
    else if (forced) decide({ job, run: true, layer: "L0", reason: `${forced.path} changed (config or dependencies)` })
    else if (!changes.some((f) => reads(j.inputs, f)))
      decide({ job, run: false, layer: "L0", reason: changes.length ? "no file this job reads changed" : "only version numbers or whitespace changed" })
    else open.push(job)
  }

  // L1: the same inputs already passed.
  const toJudge: string[] = []
  for (const job of open) {
    if (opts.passed?.has(`${job}:${hashes[job]}`)) decide({ job, run: false, layer: "L1", reason: "these exact inputs already passed" })
    else if (config.jobs[job]!.jev === false) decide({ job, run: true, layer: "L0", reason: "a file it checks changed" })
    else toJudge.push(job)
  }
  if (!toJudge.length) return out

  // L2: Jev, file by file, for what's left.
  const work = changes
    .map((f) => ({ f, jobs: toJudge.filter((job) => reads(config.jobs[job]!.inputs, f)) }))
    .filter((w) => w.jobs.length)
  const sizeOf = (f: FileChange) => (matches(config.summarize_files, f.path) ? 1 : size(f))
  out.jevLines = work.reduce((n, w) => n + sizeOf(w.f), 0)
  if (out.jevLines > config.max_jev_lines) {
    for (const job of toJudge) decide({ job, run: true, layer: "fallback", reason: `too big to judge (${out.jevLines} changed lines)` })
    return out
  }
  const forcedBy = new Map<string, string>()
  for (const w of work)
    if (w.f.binary || sizeOf(w.f) > config.max_file_lines) for (const job of w.jobs) forcedBy.set(job, w.f.path)

  const perJob = new Map<string, { file: string; p: number }[]>(toJudge.map((j) => [j, []]))
  let failed: string | undefined
  const queue = work.map((w) => ({ ...w, jobs: w.jobs.filter((j) => !forcedBy.has(j)) })).filter((w) => w.jobs.length)
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let w = queue.shift(); w; w = queue.shift()) {
        try {
          const res = await ask(jevRequest(w.f, w.jobs, config))
          out.jevCalls++
          if (!res.cached) out.inputTokens += res.usage.input_tokens
          for (const job of w.jobs) perJob.get(job)!.push({ file: w.f.path, p: res.answers[job]!.noul })
        } catch (e) {
          failed = (e as Error).message
        }
      }
    }),
  )

  for (const job of toJudge) {
    const files = perJob.get(job)!.sort((a, b) => b.p - a.p)
    const p = 1 - files.reduce((q, f) => q * (1 - f.p), 1)
    const odds = `${Math.round(p * 100)}% chance of failing${files[0] ? `, mostly from ${files[0].file}` : ""}`
    if (forcedBy.has(job)) decide({ job, run: true, layer: "fallback", reason: `${forcedBy.get(job)} is too big to judge`, p, files })
    else if (failed) decide({ job, run: true, layer: "fallback", reason: `Jev unavailable: ${failed}`, p, files })
    else if (p >= config.threshold) decide({ job, run: true, layer: "L2", reason: `Jev: ${odds}`, p, files })
    else if (config.mode === "shadow") decide({ job, run: true, layer: "L2", reason: `Jev would skip (${odds}); shadow mode runs it`, p, files, wouldSkip: true })
    else decide({ job, run: false, layer: "L2", reason: `Jev: ${odds}`, p, files })
  }
  return out
}
