import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { setOutput, summary } from "../jev-ci/github.ts"
import { bounceNote } from "./claude.ts"
import { loadBus, type Tier } from "./config.ts"
import { readPatch } from "./conflicts.ts"
import { contexts, dispose, fixesFrom, liveDeps, mergeTrees, patchOf, withModels } from "./ladder.ts"
import { fetchItem } from "./github.ts"
import type { Ticket } from "./tick.ts"

export type Verdict = { action: "stage"; tier: Tier } | { action: "bounce"; reason: string; hunks: number; tried: string[]; note?: string }

const RANK: Tier[] = ["git", "mergiraf", "keep-both", "haiku", "opus"]
export const highest = (tiers: Tier[], floor: Tier): Tier => tiers.reduce((a, b) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a), floor)

if (import.meta.main) {
  const { values } = parseArgs({
    options: { config: { type: "string", default: ".github/jev-ci.yml" }, repo: { type: "string", default: "." }, in: { type: "string", default: "bus-tick" }, out: { type: "string", default: "bus-resolve" } },
  })
  const cfg = await loadBus(values.config)
  const ticket = JSON.parse(readFileSync(join(values.in, "ticket.json"), "utf8")) as Ticket
  if (!ticket.item) throw new Error("the ticket has no item")
  fetchItem(values.repo, ticket.item)
  const m = mergeTrees(values.repo, ticket.main, ticket.item.sha, { mergiraf: cfg.ladder.includes("mergiraf"), lockfiles: cfg.lockfiles })
  mkdirSync(values.out, { recursive: true })
  let verdict: Verdict
  try {
    const prior = fixesFrom(m, readPatch(readFileSync(join(values.in, "resolution.patch"), "utf8")))
    const ctx = contexts(m, cfg)
    const outcome = await withModels(m, prior, cfg, liveDeps(cfg), ctx)
    const failed = outcome.left.length ? outcome.left.map((l) => `${l.hunk.id}: ${l.why}`) : outcome.problems.length ? outcome.problems.map((p) => `${p.file}: ${p.what}`) : outcome.tsc && !outcome.tsc.ok ? [outcome.tsc.output.split("\n").slice(0, 3).join(" ")] : []
    if (failed.length) {
      const hunks = outcome.left.length ? outcome.left.map((l) => l.hunk) : m.hunks
      const note = await bounceNote(cfg.haiku, ticket.item.key, hunks.map(ctx), outcome.tried).catch(() => undefined)
      verdict = { action: "bounce", reason: failed.join("; ").slice(0, 500), hunks: hunks.length, tried: ["git", "mergiraf", "keep-both", ...outcome.tried], ...(note ? { note } : {}) }
    } else {
      writeFileSync(join(values.out, "resolution.patch"), patchOf(m, outcome.fixes))
      verdict = { action: "stage", tier: highest(outcome.resolved.map((r) => r.tier), "keep-both") }
    }
  } finally {
    dispose(m)
  }
  writeFileSync(join(values.out, "verdict.json"), JSON.stringify(verdict, null, 2))
  setOutput("action", verdict.action)
  summary(`### bus resolve\n**${verdict.action}**${verdict.action === "stage" ? ` at tier ${verdict.tier}` : `: ${verdict.reason}`}`)
  console.log(JSON.stringify(verdict))
}
