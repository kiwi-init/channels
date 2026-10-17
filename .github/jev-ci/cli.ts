#!/usr/bin/env bun
// jev-ci: run only the CI jobs a change can break.
//
//   jev-ci plan [--config .github/jev-ci.yml] [--base origin/main] [--head HEAD]   what CI would run for this branch
//   jev-ci plan --github                                                         in CI: decide, set job outputs, comment on the PR
//   jev-ci report --github                                                       in CI's gate job: check every planned job passed
import { parseArgs } from "node:util"
import { loadConfig } from "./config.ts"
import { git } from "./git.ts"
import { headline, passedJobs, planTable, pullRequest, setOutput, summary, upsertComment } from "./github.ts"
import { allHashes, plan, runAll, type Decision, type Plan } from "./plan.ts"

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string", default: ".github/jev-ci.yml" },
    repo: { type: "string", default: "." },
    base: { type: "string", default: "origin/main" },
    head: { type: "string", default: "HEAD" },
    github: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
})

const config = await loadConfig(values.config)
const names = Object.fromEntries(Object.entries(config.jobs).map(([id, j]) => [id, j.name ?? id]))
const slug = process.env.GITHUB_REPOSITORY ?? ""
const note = (e: unknown) => console.error(`jev-ci: ${(e as Error).message}`)

async function comment(body: string) {
  const pr = await pullRequest()
  if (pr && slug) await upsertComment(slug, pr, body).catch(note)
}

async function planInCI(): Promise<Plan> {
  const head = git(values.repo, ["rev-parse", "HEAD"]).trim()
  const hashes = allHashes(values.repo, head, config)
  const passed = () => passedJobs(slug, Object.keys(config.jobs)).catch((e) => (note(e), new Set<string>()))
  if (process.env.GITHUB_REF === "refs/heads/bus/staging" && process.env.GITHUB_EVENT_NAME === "push") {
    const main = git(values.repo, ["rev-parse", "HEAD^1"]).trim()
    return plan({ repo: values.repo, base: main, head, config, passed: await passed() })
  }
  const event = process.env.GITHUB_EVENT_NAME
  if (event !== "pull_request") return runAll(config, `${event} run: everything runs`, hashes, event)
  // The checkout is GitHub's merge of the PR into its base: its first parent is the base.
  const base = git(values.repo, ["rev-parse", "HEAD^1"]).trim()
  return plan({ repo: values.repo, base, head, config, passed: await passed() })
}

if (positionals[0] === "plan" && values.github) {
  // Fail open: if planning breaks, everything runs.
  const result = await planInCI().catch((e) => (note(e), runAll(config, `planner failed, so everything runs: ${(e as Error).message}`, {}, process.env.GITHUB_EVENT_NAME)))
  const compact = result.decisions.map(({ job, run, layer, reason, p, wouldSkip }) => ({ job, run, layer, reason, p, wouldSkip }))
  setOutput("run", JSON.stringify(Object.fromEntries(result.decisions.map((d) => [d.job, d.run]))))
  setOutput("hashes", JSON.stringify(result.hashes))
  setOutput("plan", JSON.stringify({ decisions: compact, jevCalls: result.jevCalls, inputTokens: result.inputTokens }))
  const body = `### jev-ci plan\n${headline(result)}\n\n${planTable(result.decisions, names)}\n`
  summary(body)
  await comment(`${body}\n_Results appear here when **ci-ok** finishes._`)
  console.log(body)
} else if (positionals[0] === "report" && values.github) {
  // The gate: needs every job, so `needs` holds the plan and each job's result.
  const needs = JSON.parse(process.env.NEEDS ?? "{}") as Record<string, { result: string; outputs: Record<string, string> }>
  const planned = needs.plan?.result === "success" && needs.plan.outputs.plan ? (JSON.parse(needs.plan.outputs.plan) as Pick<Plan, "decisions" | "jevCalls" | "inputTokens">) : undefined
  if (!planned) {
    console.error(`jev-ci: the plan job ${needs.plan?.result ?? "is missing"}`)
    process.exit(1)
  }
  const results = Object.fromEntries(Object.entries(needs).map(([job, n]) => [job, n.result]))
  const bad = planned.decisions.filter((d: Decision) => (d.run ? results[d.job] !== "success" : results[d.job] !== "skipped"))
  const verdict = bad.length ? `❌ **${bad.map((d) => names[d.job]).join(", ")}** did not pass.` : "✅ Every job that ran passed."
  const body = `### jev-ci\n${headline(planned)} ${verdict}\n\n${planTable(planned.decisions, names, results)}\n`
  summary(body)
  await comment(body)
  console.log(body)
  process.exit(bad.length ? 1 : 0)
} else if (positionals[0] === "plan") {
  const head = git(values.repo, ["rev-parse", values.head]).trim()
  const base = git(values.repo, ["merge-base", values.base, head]).trim()
  const result = await plan({ repo: values.repo, base, head, config })
  if (values.json) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(`jev-ci plan  ${base.slice(0, 7)}..${head.slice(0, 7)}  (${result.changed} files changed)`)
    for (const d of result.decisions) console.log(`  ${d.run ? "run " : "skip"}  ${names[d.job]!.padEnd(18)} ${d.layer.padEnd(8)} ${d.reason}`)
    if (result.jevCalls) console.log(`  ${result.jevCalls} Jev calls, ${result.inputTokens} input tokens`)
  }
} else {
  console.error("usage: jev-ci plan [--github] | jev-ci report --github")
  process.exit(2)
}

