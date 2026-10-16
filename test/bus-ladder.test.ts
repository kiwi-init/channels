import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Answer, Context } from "../.github/bus/claude.ts"
import { loadBus, type BusConfig, type Model } from "../.github/bus/config.ts"
import { applyPatch, blocks, readPatch, replace, toPatch } from "../.github/bus/conflicts.ts"
import { symbols, taskOf } from "../.github/bus/events.ts"
import { dispose, enclosing, fixesFrom, keepBoth, majority, mergeTrees, patchOf, withModels, type Deps, type Merged } from "../.github/bus/ladder.ts"
import { questions } from "../.github/bus/questions.ts"
import { highest } from "../.github/bus/resolve.ts"
import { message } from "../.github/bus/stage.ts"
import { inFlight, order, trailers } from "../.github/bus/tick.ts"
import { checkFile, duplicateMembers, hasMarkers, parseError } from "../.github/bus/validate.ts"
import type { Item } from "../.github/bus/github.ts"

const cfg: BusConfig = { ...(await loadBus(".github/jev-ci.yml")), tsc: [] }

const dirs: string[] = []
const merged: Merged[] = []
afterAll(() => {
  merged.forEach(dispose)
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }))
})

function git(dir: string, ...args: string[]): string {
  const p = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" })
  if (!p.success) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`)
  return p.stdout.toString().trim()
}

const BASE = `export class Channel {\n  readonly id: string\n\n  constructor(id: string) {\n    this.id = id\n  }\n\n  seal(text: string): string {\n    return text\n  }\n}\n`

function repo(ours: string, theirs: string): { dir: string; main: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), "bus-test-"))
  dirs.push(dir)
  git(dir, "init", "-q", "-b", "main")
  writeFileSync(join(dir, "client.ts"), BASE)
  git(dir, "add", ".")
  git(dir, "commit", "-q", "-m", "base")
  git(dir, "checkout", "-q", "-b", "bus/T7-item")
  writeFileSync(join(dir, "client.ts"), theirs)
  git(dir, "commit", "-q", "-am", "Item: add packs")
  git(dir, "checkout", "-q", "main")
  writeFileSync(join(dir, "client.ts"), ours)
  git(dir, "commit", "-q", "-am", "Main: add info")
  return { dir, main: git(dir, "rev-parse", "main"), head: git(dir, "rev-parse", "bus/T7-item") }
}

const fields = (extra: string) => BASE.replace("  readonly id: string\n", `  readonly id: string\n${extra}`)
const bothAdd = () => repo(fields("  infoShared = false\n  infoExpires = 0\n"), fields("  packs = 0\n  settingsWrites = 0\n"))
const bothEdit = () => repo(BASE.replace("return text", "return text.trim()"), BASE.replace("return text", "return text.toUpperCase()"))

function worktreeDir(): string {
  const parent = mkdtempSync(join(tmpdir(), "bus-wt-"))
  dirs.push(parent)
  return join(parent, "wt")
}

function merge(r: { dir: string; main: string; head: string }): Merged {
  const m = mergeTrees(r.dir, r.main, r.head, { mergiraf: false, lockfiles: cfg.lockfiles, dir: worktreeDir() })
  merged.push(m)
  return m
}

type Script = { keep?: number; shift?: number; haiku?: Answer[]; opus?: Answer[]; tsc?: boolean[] }
function deps(s: Script): Deps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    judge: async (name) => (calls.push(name), name === "keep_both" ? (s.keep ?? 0) : (s.shift ?? 0)),
    resolve: async (m: Model, _c: Context, hint?: string) => {
      calls.push(`${m.model}${hint ? " +hint" : ""}`)
      const list = m.model.includes("haiku") ? s.haiku : s.opus
      return list?.shift() ?? { abstain: true, reason: "no script" }
    },
    typecheck: () => {
      calls.push("tsc")
      const ok = s.tsc?.shift() ?? true
      return { ok, ran: ["tsc"], output: ok ? "" : "client.ts(9,5): error TS2322" }
    },
  }
}
const say = (code: string): Answer => ({ abstain: false, lines: code.split("\n"), reason: "combined" })

describe("conflicts", () => {
  const text = "a\n<<<<<<< ours\nx\n||||||| base\n=======\ny\n>>>>>>> theirs\nb\n<<<<<<< ours\n1\n||||||| base\n0\n=======\n2\n>>>>>>> theirs\n"

  test("diff3 blocks keep their base, empty or not", () => {
    expect(blocks(text)).toEqual([
      { start: 1, end: 6, ours: ["x"], base: [], theirs: ["y"] },
      { start: 8, end: 14, ours: ["1"], base: ["0"], theirs: ["2"] },
    ])
  })

  test("a patch round-trips and applies only onto whole conflicts", () => {
    const [first, second] = blocks(text)
    const patch = toPatch([{ file: "f.ts", block: first!, tier: "keep-both", lines: ["x", "y"] }, { file: "f.ts", block: second!, tier: "haiku", lines: ["3"] }], new Map([["f.ts", text]]))
    const hunks = readPatch(patch)
    expect(hunks.map((h) => [h.start, h.tier, h.added])).toEqual([[1, "keep-both", ["x", "y"]], [8, "haiku", ["3"]]])
    const { texts, errors } = applyPatch(new Map([["f.ts", text]]), hunks)
    expect(errors).toEqual([])
    expect(texts.get("f.ts")).toBe("a\nx\ny\nb\n3\n")
    expect(Bun.spawnSync(["git", "apply", "--check", "--unidiff-zero", "-"], { stdin: new Response(patch), cwd: (() => { const d = mkdtempSync(join(tmpdir(), "bus-apply-")); dirs.push(d); writeFileSync(join(d, "f.ts"), text); Bun.spawnSync(["git", "init", "-q"], { cwd: d }); return d })() }).success).toBe(true)
  })

  test("a patch that reaches outside a conflict is refused", () => {
    const outside = "diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -1,1 +1,1 @@ haiku\n-a\n+evil()\n"
    expect(applyPatch(new Map([["f.ts", text]]), readPatch(outside)).errors[0]).toContain("not exactly one conflict")
    const other = "diff --git a/g.ts b/g.ts\n--- a/g.ts\n+++ b/g.ts\n@@ -1,1 +1,1 @@ haiku\n-a\n+b\n"
    expect(applyPatch(new Map([["f.ts", text]]), readPatch(other)).errors[0]).toContain("has no conflict")
  })

  test("replace swaps blocks back to front", () => {
    expect(replace(text, blocks(text).map((block) => ({ block, lines: [] })))).toBe("a\nb\n")
  })
})

describe("validate", () => {
  test("markers, parse errors and new duplicate members are problems", () => {
    expect(hasMarkers("a\n<<<<<<< HEAD\n")).toBe(true)
    expect(hasMarkers("a\n=======\n")).toBe(false)
    expect(parseError("a.ts", "const a = (")).toBeDefined()
    expect(parseError("a.ts", "const a = 1\nconst a = 2\n")).toContain("already been declared")
    expect(parseError("a.json", "{}")).toBeUndefined()
    const twice = fields("  packs = 0\n  packs = 1\n")
    expect(duplicateMembers(twice)).toEqual(["Channel.packs"])
    expect(checkFile("client.ts", twice, BASE).map((p) => p.what)).toEqual(["Channel.packs is declared twice"])
    expect(checkFile("client.ts", twice, twice)).toEqual([])
  })

  test("getters with setters, statics beside instance members and constructor parameters are not duplicates", () => {
    const src = "class A {\n  static readonly fx = 1\n  readonly fx = 2\n  get v() {\n    return 1\n  }\n  set v(x: number) {\n  }\n  constructor(\n    readonly id: string,\n  ) {\n    const id2 = 1\n  }\n  id3 = 0\n}\n"
    expect(duplicateMembers(src)).toEqual([])
  })
})

describe("ladder", () => {
  test("git leaves a both-added conflict with an empty base, and enclosing names the class", () => {
    const m = merge(bothAdd())
    expect(m.hunks.length).toBe(1)
    expect(m.hunks[0]!.block.base).toEqual([])
    expect(enclosing(m.texts.get("client.ts")!, m.hunks[0]!.block.start)).toBe("export class Channel")
  })

  test("keep-both keeps ours then theirs only when Jev is above the threshold", async () => {
    const m = merge(bothAdd())
    expect((await keepBoth(m, cfg, deps({ keep: 0.2 }))).resolved).toEqual([])
    const { resolved, fixes } = await keepBoth(m, cfg, deps({ keep: 0.9 }))
    expect(resolved[0]!.lines).toEqual(["  infoShared = false", "  infoExpires = 0", "  packs = 0", "  settingsWrites = 0"])
    expect(fixesFrom(m, readPatch(patchOf(m, fixes))).map((r) => r.tier)).toEqual(["keep-both"])
  })

  test("a hunk with a base never goes to keep-both", async () => {
    const d = deps({ keep: 1 })
    expect((await keepBoth(merge(bothEdit()), cfg, d)).resolved).toEqual([])
    expect(d.calls).toEqual([])
  })

  test("haiku's majority answer lands when intent_shift is low and tsc passes", async () => {
    const m = merge(bothEdit())
    const d = deps({ haiku: [say("    return text.trim().toUpperCase()"), say("    return text.trim().toUpperCase()"), { abstain: true, reason: "unsure" }] })
    const out = await withModels(m, [], cfg, d)
    expect(out.left).toEqual([])
    expect(out.resolved.map((r) => r.tier)).toEqual(["haiku"])
    expect(out.tsc?.ok).toBe(true)
    expect(d.calls.filter((c) => c.startsWith("claude-opus"))).toEqual([])
  })

  test("haiku abstaining or disagreeing goes to opus", async () => {
    const m = merge(bothEdit())
    const d = deps({ haiku: [say("a"), say("b"), { abstain: true, reason: "x" }], opus: [say("    return text.trim().toUpperCase()")] })
    const out = await withModels(m, [], cfg, d)
    expect(out.resolved.map((r) => r.tier)).toEqual(["opus"])
    expect(out.steps).toEqual([{ tier: "haiku", left: 1 }, { tier: "opus", left: 0 }])
  })

  test("a high intent_shift sends haiku's answer to opus, and opus's to the author", async () => {
    const m = merge(bothEdit())
    const answer = "    return text.trim().toUpperCase()"
    const out = await withModels(m, [], cfg, deps({ shift: 0.9, haiku: [say(answer), say(answer), say(answer)], opus: [say(answer)] }))
    expect(out.resolved).toEqual([])
    expect(out.left[0]!.why).toContain("intent_shift 90%")
    expect(out.tried).toEqual(["haiku ×3", "opus ×1"])
  })

  test("tsc failing on haiku's resolution asks opus again with the errors", async () => {
    const m = merge(bothEdit())
    const answer = "    return text.trim().toUpperCase()"
    const d = deps({ haiku: [say(answer), say(answer), say(answer)], opus: [say(answer)], tsc: [false, true] })
    const out = await withModels(m, [], cfg, d)
    expect(d.calls).toContain("claude-opus-5-5 +hint")
    expect(out.resolved.map((r) => r.tier)).toEqual(["opus"])
    expect(out.tsc?.ok).toBe(true)
  })

  test("majority keeps indentation and blank lines in the vote", () => {
    expect(majority([say("a"), say("  a"), say("b")]).abstain).toBe(true)
    expect(majority([say("a\n\nb"), say("a\nb"), say("c")]).abstain).toBe(true)
  })

  test("majority needs more than half of the samples", () => {
    expect(majority([say("a"), say("a  "), say("b")]).abstain).toBe(false)
    expect(majority([say("a"), say("b"), { abstain: true, reason: "x" }]).abstain).toBe(true)
    expect(majority([{ abstain: true, reason: "no" }])).toEqual({ abstain: true, reason: "no" })
  })
})

describe("tick and stage", () => {
  const item = (key: string, since: number, sha = "a".repeat(40)): Item => ({ key, kind: "branch", ref: `refs/remotes/origin/${key}`, sha, task: taskOf(key), since, title: key, body: "" })

  test("the oldest item goes first", () => {
    expect(order([item("bus/T9", 3), item("bus/T2", 1), item("bus/T5", 2)]).map((i) => i.task)).toEqual(["T2", "T5", "T9"])
  })

  test("staging is in flight only while it sits on main and its item is unchanged", () => {
    const r = bothAdd()
    const merge = git(r.dir, "commit-tree", "-p", r.main, "-p", r.head, "-m", `x\n\nBus-Item: bus/T7-item\nBus-Head: ${r.head}\n`, `${r.main}^{tree}`)
    const it = item("bus/T7-item", 1, r.head)
    expect(inFlight(r.dir, r.main, merge, [it])?.key).toBe("bus/T7-item")
    expect(inFlight(r.dir, r.main, merge, [{ ...it, sha: r.main }])).toBeUndefined()
    expect(inFlight(r.dir, r.head, merge, [it])).toBeUndefined()
    expect(inFlight(r.dir, r.main, undefined, [it])).toBeUndefined()
  })

  test("the staging commit carries the Agent trailer and the bus trailers", () => {
    const msg = message({ ...item("bus/T7-item", 1), title: "Clients: compress", body: "Why it changed." }, "haiku", cfg)
    expect(msg).toContain("Agent: claude-haiku-5-5 on behalf of Jonatas Walker\n")
    expect(trailers(msg)).toEqual({ "Bus-Item": "bus/T7-item", "Bus-Head": "a".repeat(40), "Bus-Tier": "haiku" })
    expect(message(item("bus/T7", 1), "git", cfg)).toContain("Agent: kiwi-bus on behalf of")
    expect(highest(["keep-both", "opus", "haiku"], "git")).toBe("opus")
  })

  test("symbols come from the enclosing names of each changed hunk", () => {
    const r = bothEdit()
    expect(symbols(r.dir, `${r.main}~1`, r.main)).toEqual(["client.ts#Channel.seal"])
    expect(taskOf("bus/T52-compress")).toBe("T52")
  })
})

test("every Jev question is a noul with instructions, a question and both criteria", () => {
  for (const q of Object.values(questions)) {
    expect(q.type).toBe("noul")
    expect(q.instructions.question).toEndWith("?")
    expect(q.criteria.true.length && q.criteria.false.length).toBeGreaterThan(0)
  }
})

test.skipIf(!Bun.which("mergiraf"))("the mergiraf driver runs on .ts files and leaves real conflicts as diff3 blocks", () => {
  const r = bothEdit()
  const m = mergeTrees(r.dir, r.main, r.head, { mergiraf: true, lockfiles: cfg.lockfiles, dir: worktreeDir() })
  merged.push(m)
  expect(m.unmergeable).toEqual([])
  expect(m.hunks.length).toBe(1)
  expect(m.hunks[0]!.block.base).not.toBeNull()
})
