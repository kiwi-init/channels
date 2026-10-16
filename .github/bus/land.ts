import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { setOutput, summary } from "../jev-ci/github.ts"
import { doctor } from "./claude.ts"
import { loadBus, type BusConfig, type Tier } from "./config.ts"
import { emit, symbols } from "./events.ts"
import { busBranches, ciRun, fetchItem, gh, jobLog, push, pushEnv, runJobs, slug, type Item, type Run } from "./github.ts"
import { judge } from "./questions.ts"
import { must, run } from "./sh.ts"
import { trailers, type Ticket } from "./tick.ts"

export type Diagnosis = { rerun: boolean; cause: string; jobs: string[] }

const GATES = new Set(["plan", "ci-ok"])

export async function bounce(repo: string, cfg: BusConfig, item: Item, b: { reason: string; hunks: number; tried: string[]; note?: string }) {
  if (item.kind === "branch") {
    const parked = item.key.replace(/^bus\//, "bounced/")
    push(repo, ["--force", `${item.sha}:refs/heads/${parked}`])
    push(repo, [`--force-with-lease=refs/heads/${item.key}:${item.sha}`, `:refs/heads/${item.key}`])
  } else if (item.number) {
    const s = slug()
    const removed = await gh(`/repos/${s}/issues/${item.number}/labels/${encodeURIComponent(cfg.label)}`, { method: "DELETE" })
    if (!removed.ok && removed.status !== 404) throw new Error(`removing the ${cfg.label} label from #${item.number}: ${removed.status}`)
    const body = `kiwi-bus on behalf of ${cfg.on_behalf_of}\n\nThe merge bus handed this back: ${b.reason}${b.note ? `\n\n${b.note}` : ""}\n\nTried: ${b.tried.join(", ")}. Label it \`${cfg.label}\` again once it merges with main.`
    const posted = await gh(`/repos/${s}/issues/${item.number}/comments`, { method: "POST", body: JSON.stringify({ body }) })
    if (!posted.ok) throw new Error(`commenting on #${item.number}: ${posted.status}`)
  }
  emit({ what: "bus.bounced", task: item.task, branch: item.key, reason: b.reason, hunks: b.hunks, tried: b.tried, ...(b.note ? { note: b.note } : {}) })
}

export async function land(repo: string, ticket: Ticket) {
  const item = ticket.item!
  const sha = ticket.staging!
  fetchItem(repo, item)
  const main = must(["git", "rev-parse", "refs/remotes/origin/main"], repo).trim()
  if (main !== ticket.main) return console.log(`main moved to ${main.slice(0, 7)}; the next tick rebuilds bus/staging`)
  const head = must(["git", "rev-parse", item.ref], repo).trim()
  if (head !== item.sha) return console.log(`${item.key} moved to ${head.slice(0, 7)} since the tick; the next tick rebuilds bus/staging`)
  push(repo, [`${sha}:refs/heads/main`])
  if (item.kind === "branch") run(["git", "push", "origin", `--force-with-lease=refs/heads/${item.key}:${item.sha}`, `:refs/heads/${item.key}`], repo, pushEnv())
  const files = must(["git", "diff", "--name-only", main, sha], repo).split("\n").filter(Boolean)
  const tier = (trailers(must(["git", "log", "-1", "--format=%B", sha], repo))["Bus-Tier"] ?? "git") as Tier
  const affects = busBranches(repo, sha)
    .filter((i) => i.key !== item.key && must(["git", "diff", "--name-only", `${main}...${i.sha}`], repo).split("\n").some((f) => files.includes(f)))
    .map((i) => i.task)
  emit({ what: "bus.landed", task: item.task, sha: sha.slice(0, 7), tier, files, symbols: symbols(repo, main, sha), affects })
}

export async function diagnose(cfg: BusConfig, ticket: Ticket, r: Run): Promise<Diagnosis> {
  const failed = (await runJobs(r)).filter((j) => !GATES.has(j.name) && j.conclusion === "failure")
  const change = `${ticket.item!.title}\n\n${ticket.item!.body}`.slice(0, 4000)
  const logs = await Promise.all(failed.map(async (j) => ({ job: j.name, log: (await jobLog(j.id)).split("\n").slice(-150).join("\n") })))
  if (!logs.length) return { rerun: false, cause: "ci-ok failed with no failed job: the plan or the gate itself broke", jobs: [] }
  const ps = await Promise.all(logs.map((l) => judge("unrelated_failure", { job: l.job, log: l.log, change }).catch(() => 0)))
  const flake = ps.every((p) => p >= cfg.unrelated_failure)
  if (flake && r.run_attempt <= cfg.reruns) return { rerun: true, cause: `Jev puts unrelated_failure at ${ps.map((p) => `${Math.round(p * 100)}%`).join(", ")}`, jobs: logs.map((l) => l.job) }
  const cause = await doctor(cfg.haiku, logs, change).catch((e: Error) => `${logs.map((l) => l.job).join(", ")} failed (doctor unavailable: ${e.message})`)
  return { rerun: false, cause, jobs: logs.map((l) => l.job) }
}

export async function settle(repo: string, cfg: BusConfig, ticket: Ticket, d: Diagnosis) {
  const item = ticket.item!
  const r = ticket.run!
  emit({ what: "bus.red", task: item.task, sha: ticket.staging!.slice(0, 7), jobs: d.jobs, cause: d.cause, rerun: d.rerun })
  if (d.rerun) {
    const res = await gh(`/repos/${slug()}/actions/runs/${r.id}/rerun-failed-jobs`, { method: "POST" })
    if (res.ok) return
  }
  await bounce(repo, cfg, item, { reason: `ci-ok red on bus/staging: ${d.cause}`, hunks: 0, tried: ["ci"], note: d.cause })
}

export async function lastGreen(repo: string, sha: string) {
  const r = await ciRun(sha, "main")
  const gate = r && (await runJobs(r)).find((j) => j.name === "ci-ok")
  if (gate?.conclusion !== "success") return console.log(`ci-ok is ${gate?.conclusion ?? "missing"} on ${sha.slice(0, 7)}; last-green stays`)
  must(["git", "fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"], repo)
  const cur = run(["git", "ls-remote", "origin", "refs/heads/last-green"], repo).out.split("\t")[0]?.trim()
  if (cur) {
    must(["git", "fetch", "-q", "origin", "+refs/heads/last-green:refs/remotes/origin/last-green"], repo)
    if (!run(["git", "merge-base", "--is-ancestor", cur, sha], repo).ok) return console.log(`${sha.slice(0, 7)} is not ahead of last-green ${cur.slice(0, 7)}`)
  }
  push(repo, [`${sha}:refs/heads/last-green`])
  console.log(`last-green → ${sha.slice(0, 7)}`)
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string", default: ".github/jev-ci.yml" },
      repo: { type: "string", default: "." },
      in: { type: "string", default: "bus-tick" },
      diagnosis: { type: "string", default: "bus-doctor" },
      sha: { type: "string" },
    },
  })
  const cfg = await loadBus(values.config)
  const ticket = () => JSON.parse(readFileSync(join(values.in, "ticket.json"), "utf8")) as Ticket
  const cmd = positionals[0]
  if (cmd === "land") await land(values.repo, ticket())
  else if (cmd === "doctor") {
    const t = ticket()
    const d = await diagnose(cfg, t, t.run!)
    mkdirSync(values.diagnosis, { recursive: true })
    writeFileSync(join(values.diagnosis, "diagnosis.json"), JSON.stringify(d, null, 2))
    setOutput("rerun", String(d.rerun))
    summary(`### bus doctor\n${d.rerun ? "Rerun once: " : ""}${d.cause}`)
    console.log(JSON.stringify(d))
  } else if (cmd === "settle") {
    const d = JSON.parse(readFileSync(join(values.diagnosis, "diagnosis.json"), "utf8")) as Diagnosis
    await settle(values.repo, cfg, ticket(), d)
  } else if (cmd === "last-green" && values.sha) await lastGreen(values.repo, values.sha)
  else {
    console.error("usage: bun .github/bus/land.ts land | doctor | settle | last-green --sha SHA")
    process.exit(2)
  }
}
