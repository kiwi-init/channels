import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { setOutput, summary } from "../jev-ci/github.ts"
import { loadBus, type BusConfig, type Tier } from "./config.ts"
import { applyPatch, blocks, readPatch } from "./conflicts.ts"
import { emit } from "./events.ts"
import { fetchItem, push, type Item } from "./github.ts"
import { bounce } from "./land.ts"
import { checkTexts, dispose, mergeTrees, touched } from "./ladder.ts"
import type { Verdict } from "./resolve.ts"
import { must, run } from "./sh.ts"
import type { Ticket } from "./tick.ts"
import { typecheck } from "./validate.ts"

export type Staged =
  | { action: "push"; sha: string; tier: Tier; item: Item; hunks: number }
  | { action: "bounce"; item: Item; reason: string; hunks: number; tried: string[]; note?: string }
  | { action: "stale"; why: string }

export function message(item: Item, tier: Tier, cfg: BusConfig): string {
  const models: Partial<Record<Tier, string>> = { haiku: cfg.haiku.model, opus: cfg.opus.model }
  const title = item.kind === "pr" ? item.title : `${item.title} (${item.key})`
  const agent = `${models[tier] ?? "kiwi-bus"} on behalf of ${cfg.on_behalf_of}`
  return `${title}\n\n${item.body ? `${item.body}\n\n` : ""}Agent: ${agent}\nBus-Item: ${item.key}\nBus-Head: ${item.sha}\nBus-Tier: ${tier}\n`
}

export function prepare(repo: string, cfg: BusConfig, ticket: Ticket, tickDir: string, resolved: string | undefined): Staged {
  const item = ticket.item!
  fetchItem(repo, item)
  const main = must(["git", "rev-parse", "refs/remotes/origin/main"], repo).trim()
  if (main !== ticket.main) return { action: "stale", why: `main moved to ${main.slice(0, 7)} since the tick` }
  if (ticket.action === "bounce") return { action: "bounce", item, ...ticket.bounce! }
  const verdict = resolved ? (JSON.parse(readFileSync(join(resolved, "verdict.json"), "utf8")) as Verdict) : undefined
  if (verdict?.action === "bounce") return { action: "bounce", item, reason: verdict.reason, hunks: verdict.hunks, tried: verdict.tried, ...(verdict.note ? { note: verdict.note } : {}) }
  const tier: Tier = verdict?.action === "stage" ? verdict.tier : (ticket.tier ?? "git")
  const patch = readFileSync(resolved ? join(resolved, "resolution.patch") : join(tickDir, "resolution.patch"), "utf8")
  const m = mergeTrees(repo, main, item.sha, { mergiraf: cfg.ladder.includes("mergiraf"), lockfiles: cfg.lockfiles })
  try {
    if (m.unmergeable.length) throw new Error(`the merge has conflicts the tick did not report: ${m.unmergeable.join("; ")}`)
    const applied = applyPatch(m.texts, readPatch(patch))
    if (applied.errors.length) throw new Error(`resolution.patch does not fit this merge:\n${applied.errors.join("\n")}`)
    const open = [...applied.texts].filter(([, t]) => blocks(t).length).map(([f]) => f)
    if (open.length) throw new Error(`resolution.patch leaves conflicts in ${open.join(", ")}`)
    for (const [file, text] of applied.texts) writeFileSync(join(m.dir, file), text)
    const problems = checkTexts(m, applied.texts)
    const tried = ["git", "mergiraf", "keep-both", ...(tier === "haiku" || tier === "opus" ? [tier] : []), "validate"]
    if (problems.length) return { action: "bounce", item, reason: problems.map((p) => `${p.file}: ${p.what}`).join("; "), hunks: m.hunks.length, tried }
    const tsc = typecheck(m.dir, touched(m), cfg.tsc)
    if (!tsc.ok) return { action: "bounce", item, reason: `typecheck fails on the merged tree: ${tsc.output.split("\n").slice(0, 4).join(" ")}`.slice(0, 600), hunks: m.hunks.length, tried }
    if (m.texts.size) must(["git", "add", "--", ...m.texts.keys()], m.dir)
    const msg = join(m.dir, "..", `bus-message-${item.sha.slice(0, 7)}`)
    writeFileSync(msg, message(item, tier, cfg))
    must(["git", "-c", "core.hooksPath=/dev/null", "-c", "user.name=kiwi-bus", "-c", "user.email=kiwi-bus@users.noreply.github.com", "commit", "-q", "-F", msg], m.dir)
    const sha = must(["git", "rev-parse", "HEAD"], m.dir).trim()
    must(["git", "update-ref", "refs/bus/staged", sha], repo)
    return { action: "push", sha, tier, item, hunks: m.hunks.length }
  } finally {
    dispose(m)
  }
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string", default: ".github/jev-ci.yml" },
      repo: { type: "string", default: "." },
      in: { type: "string", default: "bus-tick" },
      resolved: { type: "string" },
      out: { type: "string", default: "bus-stage" },
    },
  })
  const cfg = await loadBus(values.config)
  const ticket = JSON.parse(readFileSync(join(values.in, "ticket.json"), "utf8")) as Ticket
  if (positionals[0] === "prepare") {
    const resolved = values.resolved && existsSync(join(values.resolved, "verdict.json")) ? values.resolved : undefined
    const staged = prepare(values.repo, cfg, ticket, values.in, resolved)
    mkdirSync(values.out, { recursive: true })
    writeFileSync(join(values.out, "staged.json"), JSON.stringify(staged, null, 2))
    setOutput("action", staged.action)
    summary(`### bus stage\n**${staged.action}**${staged.action === "push" ? ` ${staged.sha.slice(0, 7)} at tier ${staged.tier}` : staged.action === "bounce" ? `: ${staged.reason}` : `: ${staged.why}`}`)
    console.log(JSON.stringify(staged))
  } else if (positionals[0] === "push") {
    const staged = JSON.parse(readFileSync(join(values.out, "staged.json"), "utf8")) as Staged
    if (staged.action === "push") {
      push(values.repo, [`--force-with-lease=refs/heads/bus/staging:${ticket.staging ?? ""}`, `${staged.sha}:refs/heads/bus/staging`])
      for (const e of ticket.events) emit(e)
      emit({ what: "bus.staged", task: staged.item.task, branch: staged.item.key, sha: staged.sha.slice(0, 7), tier: staged.tier, hunks: staged.hunks })
    } else if (staged.action === "bounce") {
      for (const e of ticket.events) emit(e)
      await bounce(values.repo, cfg, staged.item, staged)
    }
  } else {
    console.error("usage: bun .github/bus/stage.ts prepare | push [--in bus-tick] [--resolved bus-resolve] [--out bus-stage]")
    process.exit(2)
  }
}
