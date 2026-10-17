import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { setOutput, summary } from "../jev-ci/github.ts"
import { loadBus, type BusConfig, type Tier } from "./config.ts"
import type { BusEvent } from "./events.ts"
import { busBranches, ciRun, ciState, fetchBus, queuedPulls, runJobs, type Ci, type Item, type Run } from "./github.ts"
import { contexts, dispose, keepBoth, liveDeps, mergeTrees, patchOf } from "./ladder.ts"
import { judge } from "./questions.ts"
import { clip, must, run } from "./sh.ts"

export type Action = "idle" | "wait" | "land" | "red" | "stage" | "resolve" | "bounce"

export type Ticket = {
  action: Action
  why: string
  item?: Item
  main: string
  fork?: string
  staging?: string
  run?: Run
  tier?: Tier
  fast?: boolean
  hunks?: number
  pending?: number
  bounce?: { reason: string; hunks: number; tried: string[] }
  events: BusEvent[]
}

export const trailers = (message: string) =>
  Object.fromEntries([...message.matchAll(/^(Bus-[A-Za-z]+): (.+)$/gm)].map((m) => [m[1]!, m[2]!.trim()])) as Record<string, string>

const changedFiles = (repo: string, main: string, sha: string) => must(["git", "diff", "--name-only", `${main}...${sha}`], repo).split("\n").filter(Boolean)

export function inFlight(repo: string, main: string, staging: string | undefined, items: Item[]): Item | undefined {
  if (!staging || staging === main) return undefined
  const parent = run(["git", "rev-parse", `${staging}^1`], repo)
  if (!parent.ok || parent.out.trim() !== main) return undefined
  const t = trailers(must(["git", "log", "-1", "--format=%B", staging], repo))
  return items.find((i) => i.key === t["Bus-Item"] && i.sha === t["Bus-Head"])
}

const PENDING_MAX_SECONDS = 20 * 60

const PLUMBING = /^(\.github\/|package\.json$|bun\.lock$|[^/]+\/package\.json$|[^/]+\/bun\.lock$|tsconfig[^/]*\.json$|bunfig\.toml$)/

export function fastBlock(repo: string, main: string, fork: string, sha: string): string | undefined {
  const lines = (a: string, b: string) => must(["git", "diff", "--name-only", `${a}..${b}`], repo).split("\n").filter(Boolean)
  const mine = lines(fork, sha)
  const theirs = lines(fork, main)
  const config = mine.find((f) => PLUMBING.test(f))
  if (config) return `it changes ${config}, which is tested on the merged tree`
  const plumbing = theirs.find((f) => PLUMBING.test(f))
  if (plumbing) return `main changed ${plumbing} since its CI ran`
  const shared = mine.filter((f) => theirs.includes(f))
  if (shared.length) return `main changed ${shared[0]} too since its CI ran`
  return undefined
}

export function ready(items: Item[], ci: ReadonlyMap<string, Ci>, now = Math.floor(Date.now() / 1000)): Item[] {
  return items.filter((i) => {
    const c = ci.get(i.key)
    return !(c?.state === "pending" && c.startedAt !== undefined && now - c.startedAt < PENDING_MAX_SECONDS)
  })
}

export function ranked(items: Item[], ci: ReadonlyMap<string, Ci>): Item[] {
  const green = items.filter((i) => ci.get(i.key)?.state === "green")
  return [...order(green), ...order(items.filter((i) => ci.get(i.key)?.state !== "green"))]
}

export function order(items: Item[]): Item[] {
  return [...items].sort((a, b) => a.since - b.since || a.key.localeCompare(b.key))
}

async function pick(repo: string, main: string, items: Item[], cfg: BusConfig): Promise<{ item: Item; events: BusEvent[] }> {
  const [first, ...rest] = items
  const files = changedFiles(repo, main, first!.sha)
  const events: BusEvent[] = []
  for (const other of rest.slice(0, 5)) {
    const shared = changedFiles(repo, main, other.sha).filter((f) => files.includes(f))
    if (!shared.length) continue
    const side = (i: Item) => ({
      branch: i.key,
      subjects: must(["git", "log", "--format=%s", `${main}..${i.sha}`], repo).split("\n").filter(Boolean),
      diff: clip(must(["git", "diff", "--no-color", `${main}...${i.sha}`, "--", ...shared], repo), 300),
    })
    const p = await judge("needs_order", { first: side(other), second: side(first!) }).catch(() => 0)
    if (p < cfg.needs_order) continue
    events.push({ what: "bus.collision", task: first!.task, branch: first!.key, with: { task: other.task, branch: other.key }, grade: "needs-order", files: shared, plan: "stacked", after: other.task, p })
    return { item: other, events }
  }
  return { item: first!, events }
}

export async function tick(repo: string, cfg: BusConfig): Promise<{ ticket: Ticket; patch: string }> {
  fetchBus(repo)
  const main = must(["git", "rev-parse", "refs/remotes/origin/main"], repo).trim()
  const st = run(["git", "rev-parse", "--verify", "-q", "refs/remotes/origin/bus/staging"], repo)
  const staging = st.ok ? st.out.trim() : undefined
  const queued = await queuedPulls(repo, cfg)
  const items = [...busBranches(repo, main), ...queued.items]
  const base = { main, ...(staging ? { staging } : {}), events: [] as BusEvent[] }

  const flying = inFlight(repo, main, staging, items)
  const stagedKey = staging && staging !== main && run(["git", "rev-parse", `${staging}^1`], repo).out.trim() === main ? trailers(must(["git", "log", "-1", "--format=%B", staging], repo))["Bus-Item"] : undefined
  const lost = stagedKey ? queued.failed.find((f) => f.key === stagedKey) : undefined
  if (!flying && lost) return { ticket: { ...base, action: "wait", why: `${lost.key} is on bus/staging but could not be read this tick: ${lost.error.slice(0, 200)}` }, patch: "" }
  if (flying && staging) {
    const r = await ciRun(staging, "bus/staging")
    if (!r || r.status !== "completed") return { ticket: { ...base, action: "wait", why: `ci is ${r?.status ?? "not started"} on bus/staging for ${flying.key}`, item: flying, ...(r ? { run: r } : {}) }, patch: "" }
    const gate = (await runJobs(r)).find((j) => j.name === "ci-ok")
    const green = gate?.conclusion === "success"
    return { ticket: { ...base, action: green ? "land" : "red", why: `ci-ok ${gate?.conclusion ?? "missing"} on bus/staging for ${flying.key}`, item: flying, run: r }, patch: "" }
  }
  if (!items.length) return { ticket: { ...base, action: "idle", why: "nothing is queued" }, patch: "" }

  const ci = new Map(await Promise.all(items.map(async (i) => [i.key, i.kind === "branch" ? await ciState(i.sha, i.key).catch((): Ci => ({ state: "none" })) : ({ state: "none" } as Ci)] as const)))
  const waiting = ready(items, ci)
  if (!waiting.length) return { ticket: { ...base, action: "wait", why: `${items.map((i) => i.key).join(", ")} wait for their own CI` }, patch: "" }
  const { item, events } = await pick(repo, main, ranked(waiting, ci), cfg)
  const fork = must(["git", "merge-base", main, item.sha], repo).trim()
  const plain = mergeTrees(repo, main, item.sha, { mergiraf: false, lockfiles: cfg.lockfiles })
  const gitLeft = plain.hunks.length + plain.unmergeable.length
  dispose(plain)
  const m = mergeTrees(repo, main, item.sha, { mergiraf: cfg.ladder.includes("mergiraf"), lockfiles: cfg.lockfiles })
  try {
    const head = { ...base, item, fork, events }
    if (m.unmergeable.length)
      return { ticket: { ...head, action: "bounce", why: "a conflict no tier can resolve", bounce: { reason: m.unmergeable.join("; "), hunks: m.unmergeable.length, tried: ["git", "mergiraf"] } }, patch: "" }
    const big = m.hunks.find((h) => h.block.end - h.block.start > cfg.max_hunk_lines)
    if (big)
      return { ticket: { ...head, action: "bounce", why: "a conflict too big to resolve", bounce: { reason: `${big.file}:${big.block.start + 1}: a ${big.block.end - big.block.start}-line conflict`, hunks: m.hunks.length, tried: ["git", "mergiraf"] } }, patch: "" }
    const kb = cfg.ladder.includes("keep-both") ? await keepBoth(m, cfg, liveDeps(cfg), contexts(m, cfg)) : { fixes: [], resolved: [], candidates: 0, note: undefined }
    const pending = m.hunks.length - kb.resolved.length
    const tier: Tier = !gitLeft ? "git" : !m.hunks.length ? "mergiraf" : !pending ? "keep-both" : "haiku"
    const action: Action = pending ? "resolve" : "stage"
    const block = ci.get(item.key)?.state !== "green" ? "its own CI is not green" : gitLeft ? "git left conflicts" : fastBlock(repo, main, fork, item.sha)
    const fast = action === "stage" && !block
    const why = fast ? "its own CI is green and it merges cleanly: lands without a staging run" : !m.hunks.length ? `merges with ${tier}${block ? ` (staging run: ${block})` : ""}` : `${m.hunks.length} conflicts after mergiraf, ${pending} left after keep-both${kb.note ? ` (${kb.note})` : ""}`
    return { ticket: { ...head, action, why, tier, ...(fast ? { fast: true } : {}), hunks: m.hunks.length, pending }, patch: patchOf(m, kb.fixes) }
  } finally {
    dispose(m)
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { config: { type: "string", default: ".github/jev-ci.yml" }, repo: { type: "string", default: "." }, out: { type: "string", default: "bus-out" } } })
  const cfg = await loadBus(values.config)
  const { ticket, patch } = await tick(values.repo, cfg)
  mkdirSync(values.out, { recursive: true })
  writeFileSync(join(values.out, "ticket.json"), JSON.stringify(ticket, null, 2))
  writeFileSync(join(values.out, "resolution.patch"), patch)
  setOutput("action", ticket.action)
  summary(`### bus tick\n**${ticket.action}**: ${ticket.why}${ticket.item ? ` (${ticket.item.key} at ${ticket.item.sha.slice(0, 7)})` : ""}`)
  console.log(`${ticket.action}: ${ticket.why}`)
}
