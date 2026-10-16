import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { matches } from "../jev-ci/config.ts"
import { resolve, type Answer, type Context } from "./claude.ts"
import { loadBus, type BusConfig, type Model, type Tier } from "./config.ts"
import { blocks, replace, toPatch, type Block, type Fix, type PatchHunk } from "./conflicts.ts"
import { judge, type QuestionName } from "./questions.ts"
import { clip, must, run } from "./sh.ts"
import { checkFile, typecheck, type Problem, type Typechecked } from "./validate.ts"

export type Hunk = { id: string; file: string; block: Block }

export type Merged = {
  repo: string
  dir: string
  main: string
  head: string
  fork: string
  texts: Map<string, string>
  hunks: Hunk[]
  unmergeable: string[]
}

export type Deps = {
  judge: (name: QuestionName, state: Record<string, unknown>) => Promise<number>
  resolve: (m: Model, c: Context, hint?: string) => Promise<Answer>
  typecheck: (dir: string, touched: string[]) => Typechecked
}

export type Step = { tier: Tier; left: number; note?: string }

export type Resolved = { hunk: Hunk; tier: Tier; lines: string[]; reason: string; p?: number }

export type Outcome = {
  fixes: Fix[]
  resolved: Resolved[]
  left: { hunk: Hunk; why: string }[]
  steps: Step[]
  tried: string[]
  problems: Problem[]
  tsc?: Typechecked & { tiers: Tier[] }
}

const MERGIRAF = "mergiraf merge --git %O %A %B -s %S -x %X -y %Y -p %P -l %L"
const IDENTITY = ["-c", "user.name=kiwi-bus", "-c", "user.email=kiwi-bus@users.noreply.github.com"]

export function gitArgs(mergiraf: boolean, attributes: string): string[] {
  const base = ["-c", "merge.conflictStyle=diff3", "-c", "core.hooksPath=/dev/null", ...IDENTITY]
  return mergiraf ? [...base, "-c", `core.attributesFile=${attributes}`, "-c", "merge.mergiraf.name=mergiraf", "-c", `merge.mergiraf.driver=${MERGIRAF}`] : base
}

export function mergeTrees(repo: string, main: string, head: string, opts: { mergiraf: boolean; lockfiles: string[]; dir?: string }): Merged {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "bus-merge-"))
  rmSync(dir, { recursive: true, force: true })
  must(["git", "worktree", "add", "--detach", "--force", dir, main], repo)
  const attributes = join(tmpdir(), "bus-attributes")
  writeFileSync(attributes, "*.ts merge=mergiraf\n*.tsx merge=mergiraf\n")
  const fork = must(["git", "merge-base", main, head], repo).trim()
  run(["git", ...gitArgs(opts.mergiraf, attributes), "merge", "--no-commit", "--no-ff", head], dir)
  const conflicted = must(["git", "diff", "--name-only", "--diff-filter=U"], dir).split("\n").filter(Boolean)
  const texts = new Map<string, string>()
  const hunks: Hunk[] = []
  const unmergeable: string[] = []
  for (const file of conflicted) {
    if (matches(opts.lockfiles, file)) {
      unmergeable.push(`${file}: a lockfile conflict (take main's and regenerate it on the branch)`)
      continue
    }
    const text = existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : undefined
    const found = text === undefined ? [] : blocks(text)
    if (text === undefined || !found.length) {
      unmergeable.push(`${file}: a conflict git can't show as lines (deleted, renamed or binary on one side)`)
      continue
    }
    texts.set(file, text)
    found.forEach((block, i) => hunks.push({ id: `${file}#${i + 1}`, file, block }))
  }
  return { repo, dir, main, head, fork, texts, hunks, unmergeable }
}

export function dispose(m: Merged) {
  run(["git", "worktree", "remove", "--force", m.dir], m.repo)
  rmSync(m.dir, { recursive: true, force: true })
}

const DECLARATION = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:declare\s+)?(?:async\s+)?(?:class|interface|function\*?|namespace|enum)\s+[\w$]+|^\s*(?:export\s+)?(?:const|let)\s+[\w$]+\s*=.*(?:=>|function).*\{\s*$|^\s*(?:(?:public|private|protected|static|readonly|override|async)\s+)*(?:get\s+|set\s+)?[\w$#]+\s*(?:<[^>]*>)?\(.*\)?\s*(?::[^{]*)?\{\s*$|^\s*(?:(?:public|private|protected|static|readonly)\s+)*[\w$#]+\s*(?::[^=]*)?=\s*.*\{\s*$/

const indent = (l: string) => l.length - l.trimStart().length

export function enclosing(text: string, at: number): string {
  const all = text.split("\n")
  const chain: string[] = []
  let limit = Infinity
  const first = all.slice(at).find((l) => l.trim() && !/^(<{7}|\|{7}|={7}|>{7})/.test(l))
  if (first !== undefined) limit = indent(first)
  for (let i = at - 1; i >= 0 && chain.length < 2; i--) {
    const l = all[i]!
    if (!l.trim() || indent(l) >= limit) continue
    if (DECLARATION.test(l) && !/^\s*(if|for|while|switch|catch|return)\b/.test(l)) {
      chain.unshift(l.trim().replace(/\s*\{\s*$/, "").slice(0, 100))
      limit = indent(l)
    }
  }
  return chain.join(" › ")
}

export function contexts(m: Merged, cfg: BusConfig): (h: Hunk) => Context {
  const perFile = new Map<string, Pick<Context, "intents" | "messages" | "diffs">>()
  const side = (from: string, to: string, file: string) => ({
    subjects: must(["git", "log", "--format=%s", `${from}..${to}`, "--", file], m.repo).split("\n").filter(Boolean),
    messages: clip(must(["git", "log", "--format=%s%n%n%b%n---", `${from}..${to}`, "--", file], m.repo).trim(), 120),
    diff: clip(must(["git", "diff", "--no-color", from, to, "--", file], m.repo), 400),
  })
  return (h) => {
    let f = perFile.get(h.file)
    if (!f) {
      const ours = side(m.fork, m.main, h.file)
      const theirs = side(m.fork, m.head, h.file)
      f = {
        intents: { ours: ours.subjects, theirs: theirs.subjects },
        messages: { ours: ours.messages, theirs: theirs.messages },
        diffs: { ours: ours.diff, theirs: theirs.diff },
      }
      perFile.set(h.file, f)
    }
    const all = m.texts.get(h.file)!.split("\n")
    return {
      file: h.file,
      enclosing: enclosing(m.texts.get(h.file)!, h.block.start),
      before: all.slice(Math.max(0, h.block.start - cfg.context_lines), h.block.start),
      after: all.slice(h.block.end + 1, h.block.end + 1 + cfg.context_lines),
      base: h.block.base,
      ours: h.block.ours,
      theirs: h.block.theirs,
      ...f,
    }
  }
}

const hunkState = (c: Context) => ({ file: c.file, enclosing: c.enclosing, hunk: { base: c.base, ours: c.ours, theirs: c.theirs }, intents: c.intents })

export async function keepBoth(m: Merged, cfg: BusConfig, deps: Deps, ctx = contexts(m, cfg)): Promise<{ fixes: Fix[]; resolved: Resolved[]; candidates: number; note?: string }> {
  const candidates = m.hunks.filter((h) => h.block.base !== null && h.block.base.every((l) => !l.trim()) && h.block.ours.length && h.block.theirs.length)
  const resolved: Resolved[] = []
  let failed: string | undefined
  await pool(candidates, 6, async (h) => {
    try {
      const p = await deps.judge("keep_both", hunkState(ctx(h)))
      if (p >= cfg.keep_both) resolved.push({ hunk: h, tier: "keep-both", lines: [...h.block.ours, ...h.block.theirs], reason: `Jev keep_both ${pct(p)}`, p })
    } catch (e) {
      failed = (e as Error).message
    }
  })
  return { fixes: resolved.map(toFix), resolved, candidates: candidates.length, ...(failed ? { note: `Jev unavailable for keep_both: ${failed}` } : {}) }
}

const pct = (p: number) => `${Math.round(p * 100)}%`
const toFix = (r: Resolved): Fix => ({ file: r.hunk.file, block: r.hunk.block, tier: r.tier, lines: r.lines })

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let x = queue.shift(); x !== undefined; x = queue.shift()) await work(x)
  }))
}

export function majority(answers: Answer[]): Answer {
  const groups = new Map<string, { answer: Answer & { abstain: false }; n: number }>()
  for (const a of answers) {
    if (a.abstain) continue
    const key = a.lines.map((l) => l.trimEnd()).join("\n")
    const g = groups.get(key)
    if (g) g.n++
    else groups.set(key, { answer: a, n: 1 })
  }
  const best = [...groups.values()].sort((a, b) => b.n - a.n)[0]
  if (best && best.n * 2 > answers.length) return best.answer
  const why = answers.filter((a) => a.abstain).map((a) => a.reason)
  return { abstain: true, reason: best ? `samples disagreed (${groups.size} different answers${why.length ? `, ${why.length} abstained` : ""})` : why[0] ?? "every sample abstained" }
}

async function sample(m: Model, c: Context, deps: Deps, hint?: string): Promise<Answer> {
  const answers = await Promise.all(Array.from({ length: m.samples }, () => deps.resolve(m, c, hint).catch((e: Error): Answer => ({ abstain: true, reason: `error: ${e.message}` }))))
  return majority(answers)
}

function write(m: Merged, fixes: Fix[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const [file, text] of m.texts) {
    const next = replace(text, fixes.filter((f) => f.file === file))
    out.set(file, next)
    writeFileSync(join(m.dir, file), next)
  }
  return out
}

export function touched(m: Merged): string[] {
  return must(["git", "diff", "--name-only", "HEAD"], m.dir).split("\n").filter(Boolean)
}

export function checkTexts(m: Merged, texts: Map<string, string>): Problem[] {
  return [...texts].flatMap(([file, text]) => {
    const before = run(["git", "show", `${m.main}:${file}`], m.repo)
    return checkFile(file, text, before.ok ? before.out : undefined)
  })
}

export async function withModels(m: Merged, prior: Resolved[], cfg: BusConfig, deps: Deps, ctx = contexts(m, cfg)): Promise<Outcome> {
  const resolved = [...prior]
  const left: { hunk: Hunk; why: string }[] = []
  const steps: Step[] = []
  const tried: string[] = []
  const done = new Set(prior.map((r) => r.hunk.id))
  const tiers = cfg.ladder.filter((t): t is "haiku" | "opus" => t === "haiku" || t === "opus")

  const attempt = async (tier: "haiku" | "opus", h: Hunk, hint?: string): Promise<string | undefined> => {
    const c = ctx(h)
    const a = await sample(cfg[tier], c, deps, hint)
    if (a.abstain) return `${tier} abstained: ${a.reason}`
    let p: number
    try {
      p = await deps.judge("intent_shift", { ...hunkState(c), resolution: a.lines })
    } catch (e) {
      return `Jev unavailable for intent_shift: ${(e as Error).message}`
    }
    if (p >= cfg.intent_shift) return `Jev intent_shift ${pct(p)} on ${tier}'s resolution`
    resolved.push({ hunk: h, tier, lines: a.lines, reason: a.reason, p })
    return undefined
  }

  let queue: { hunk: Hunk; why: string; hint?: string }[] = m.hunks.filter((h) => !done.has(h.id)).map((hunk) => ({ hunk, why: "unresolved" }))
  for (const tier of tiers) {
    if (!queue.length) break
    tried.push(`${tier} ×${cfg[tier].samples}`)
    const next: typeof queue = []
    await pool(queue, 4, async (q) => {
      const why = await attempt(tier, q.hunk, q.hint)
      if (why) next.push({ hunk: q.hunk, why, ...(q.hint ? { hint: q.hint } : {}) })
    })
    queue = next
    steps.push({ tier, left: queue.length })
  }
  left.push(...queue.map(({ hunk, why }) => ({ hunk, why })))

  let problems: Problem[] = []
  let tsc: Outcome["tsc"]
  const check = () => {
    const texts = write(m, resolved.map(toFix))
    problems = checkTexts(m, texts)
    if (!problems.length && !left.length) tsc = { ...deps.typecheck(m.dir, touched(m)), tiers: [...new Set(resolved.map((r) => r.tier))] }
  }
  check()
  const fromHaiku = resolved.filter((r) => r.tier === "haiku")
  const failing = new Set(problems.map((p) => p.file))
  const redo = tsc && !tsc.ok ? fromHaiku : fromHaiku.filter((r) => failing.has(r.hunk.file))
  if (!left.length && redo.length && tiers.includes("opus")) {
    const hint = tsc && !tsc.ok ? tsc.output : problems.map((p) => `${p.file}: ${p.what}`).join("\n")
    for (const r of redo) resolved.splice(resolved.indexOf(r), 1)
    tried.push("opus after a failed check")
    await pool(redo, 4, async (r) => {
      const why = await attempt("opus", r.hunk, hint)
      if (why) left.push({ hunk: r.hunk, why })
    })
    steps.push({ tier: "opus", left: left.length, note: "after a failed check" })
    check()
  }
  return { fixes: resolved.map(toFix), resolved, left, steps, tried, problems, ...(tsc ? { tsc } : {}) }
}

export function liveDeps(cfg: BusConfig): Deps {
  return { judge, resolve, typecheck: (dir, files) => typecheck(dir, files, cfg.tsc) }
}

export function fixesFrom(m: Merged, hunks: PatchHunk[]): Resolved[] {
  return hunks.map((p) => {
    const h = m.hunks.find((x) => x.file === p.file && x.block.start === p.start && x.block.end - x.block.start + 1 === p.removed.length)
    if (!h) throw new Error(`${p.file}:${p.start + 1}: the patch does not match a conflict of this merge`)
    return { hunk: h, tier: p.tier, lines: p.added, reason: "from tick" }
  })
}

export const patchOf = (m: Merged, fixes: Fix[]) => toPatch(fixes, m.texts)

async function replay() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string", default: ".github/jev-ci.yml" },
      repo: { type: "string", default: "." },
      base: { type: "string", default: "origin/main" },
      "no-models": { type: "boolean", default: false },
      out: { type: "string" },
    },
  })
  if (!positionals.length) {
    console.error("usage: bun .github/bus/ladder.ts [--base origin/main] [--no-models] [--out dir] <PR number | ref>...")
    process.exit(2)
  }
  const cfg = await loadBus(values.config)
  const deps = liveDeps(cfg)
  const repo = values.repo
  const main = must(["git", "rev-parse", values.base], repo).trim()
  if (values.out) mkdirSync(values.out, { recursive: true })
  const rows: { item: string; counts: Record<string, number | string>; tsc: string }[] = []
  for (const arg of positionals) {
    const n = arg.replace(/^#/, "")
    const head = /^\d+$/.test(n) ? (must(["git", "fetch", "-q", "origin", `pull/${n}/head`], repo), must(["git", "rev-parse", "FETCH_HEAD"], repo).trim()) : must(["git", "rev-parse", arg], repo).trim()
    const label = /^\d+$/.test(n) ? `#${n}` : arg
    const plain = mergeTrees(repo, main, head, { mergiraf: false, lockfiles: cfg.lockfiles })
    const gitCount = plain.hunks.length
    dispose(plain)
    const m = mergeTrees(repo, main, head, { mergiraf: true, lockfiles: cfg.lockfiles })
    const counts: Record<string, number | string> = { git: gitCount, mergiraf: m.hunks.length }
    const ctx = contexts(m, cfg)
    const kb = await keepBoth(m, cfg, deps, ctx)
    counts["base empty"] = kb.candidates
    counts["keep-both"] = m.hunks.length - kb.resolved.length
    let tsc = "—"
    const lines = [`\n${label}  ${head.slice(0, 7)} onto ${main.slice(0, 7)}${m.unmergeable.length ? `  unmergeable: ${m.unmergeable.join("; ")}` : ""}${kb.note ? `  (${kb.note})` : ""}`]
    let outcome: Outcome | undefined
    if (!values["no-models"] && !m.unmergeable.length) {
      outcome = await withModels(m, kb.resolved, cfg, deps, ctx)
      for (const s of outcome.steps) counts[s.note ? `${s.tier} (recheck)` : s.tier] = s.left
      tsc = outcome.left.length
        ? `not run: ${outcome.left.length} hunks left`
        : outcome.tsc
          ? `${outcome.tsc.ok ? "pass" : "FAIL"} (${outcome.tsc.tiers.join("+")}; ${outcome.tsc.ran.join(", ")})`
          : `not run: ${outcome.problems.map((p) => `${p.file} ${p.what}`).join("; ")}`
      if (outcome.tsc && !outcome.tsc.ok) lines.push(clip(outcome.tsc.output, 30).replace(/^/gm, "      "))
    }
    const done = outcome?.resolved ?? kb.resolved
    for (const h of m.hunks) {
      const r = done.find((x) => x.hunk.id === h.id)
      const l = outcome?.left.find((x) => x.hunk.id === h.id)
      const where = `${h.file}:${h.block.start + 1}`
      lines.push(`  ${where.padEnd(28)} ${(r ? r.tier : l ? "left" : "—").padEnd(10)} ${enclosing(m.texts.get(h.file)!, h.block.start).slice(0, 70).padEnd(70)} ${r ? r.reason : l ? l.why : ""}`.trimEnd())
    }
    if (values.out && outcome) {
      writeFileSync(join(values.out, `${n}.patch`), patchOf(m, outcome.fixes))
      writeFileSync(join(values.out, `${n}.json`), JSON.stringify({ item: label, head, main, counts, tsc: outcome.tsc, left: outcome.left.map((x) => ({ id: x.hunk.id, why: x.why })), resolved: outcome.resolved.map((r) => ({ id: r.hunk.id, tier: r.tier, reason: r.reason, p: r.p, lines: r.lines })) }, null, 2))
    }
    console.log(lines.join("\n"))
    rows.push({ item: label, counts, tsc })
    dispose(m)
  }
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r.counts)))]
  const total = Object.fromEntries(cols.map((c) => [c, rows.reduce((n, r) => n + (typeof r.counts[c] === "number" ? (r.counts[c] as number) : 0), 0)]))
  console.log(`\nconflict sections left after each tier\n${["item".padEnd(8), ...cols.map((c) => c.padStart(18))].join("")}`)
  for (const r of [...rows, { item: "total", counts: total, tsc: "" }])
    console.log(`${r.item.padEnd(8)}${cols.map((c) => String(r.counts[c] ?? "").padStart(18)).join("")}  ${r.tsc}`)
}

if (import.meta.main) await replay()
