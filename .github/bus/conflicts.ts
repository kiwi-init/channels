import type { Tier } from "./config.ts"

export type Block = { start: number; end: number; ours: string[]; base: string[] | null; theirs: string[] }

export type Fix = { file: string; block: Block; tier: Tier; lines: string[] }

export type PatchHunk = { file: string; start: number; removed: string[]; added: string[]; tier: Tier }

const OPEN = /^<{7}(?: |$)/
const BASE = /^\|{7}(?: |$)/
const SPLIT = /^={7}$/
const CLOSE = /^>{7}(?: |$)/

const lines = (text: string) => text.split("\n")

export function blocks(text: string): Block[] {
  const all = lines(text)
  const out: Block[] = []
  for (let i = 0; i < all.length; i++) {
    if (!OPEN.test(all[i]!)) continue
    const ours: string[] = []
    const theirs: string[] = []
    let base: string[] | null = null
    let part: "ours" | "base" | "theirs" = "ours"
    let j = i + 1
    for (; j < all.length && !(part === "theirs" && CLOSE.test(all[j]!)); j++) {
      const l = all[j]!
      if (part === "ours" && BASE.test(l)) (part = "base"), (base = [])
      else if (part !== "theirs" && SPLIT.test(l)) part = "theirs"
      else if (part === "ours") ours.push(l)
      else if (part === "base") base!.push(l)
      else theirs.push(l)
    }
    if (j >= all.length) break
    out.push({ start: i, end: j, ours, base, theirs })
    i = j
  }
  return out
}

export function replace(text: string, fixes: { block: Block; lines: string[] }[]): string {
  const all = lines(text)
  for (const f of [...fixes].sort((a, b) => b.block.start - a.block.start)) all.splice(f.block.start, f.block.end - f.block.start + 1, ...f.lines)
  return all.join("\n")
}

export function toPatch(fixes: Fix[], texts: Map<string, string>): string {
  const out: string[] = []
  const files = [...new Set(fixes.map((f) => f.file))].sort()
  for (const file of files) {
    const all = lines(texts.get(file) ?? "")
    out.push(`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`)
    let shift = 0
    for (const f of fixes.filter((x) => x.file === file).sort((a, b) => a.block.start - b.block.start)) {
      const removed = all.slice(f.block.start, f.block.end + 1)
      const at = f.block.start + 1 + shift
      const newAt = f.lines.length ? at : at - 1
      out.push(`@@ -${f.block.start + 1},${removed.length} +${newAt},${f.lines.length} @@ ${f.tier}`)
      out.push(...removed.map((l) => `-${l}`), ...f.lines.map((l) => `+${l}`))
      shift += f.lines.length - removed.length
    }
  }
  return out.length ? out.join("\n") + "\n" : ""
}

const HUNK = /^@@ -(\d+),(\d+) \+\d+,(\d+) @@ ?(.*)$/

export function readPatch(text: string): PatchHunk[] {
  const all = lines(text)
  const out: PatchHunk[] = []
  let file = ""
  for (let i = 0; i < all.length; i++) {
    const l = all[i]!
    const m = l.match(/^diff --git a\/(.*) b\/(.*)$/)
    if (m) {
      if (m[1] !== m[2]) throw new Error(`resolution.patch renames ${m[1]}`)
      file = m[1]!
      continue
    }
    const h = l.match(HUNK)
    if (!h) continue
    if (!file) throw new Error(`resolution.patch has a hunk before any file, at line ${i + 1}`)
    const nRemoved = Number(h[2])
    const nAdded = Number(h[3])
    const body = all.slice(i + 1, i + 1 + nRemoved + nAdded)
    const removed = body.slice(0, nRemoved)
    const added = body.slice(nRemoved)
    if (body.length !== nRemoved + nAdded || !removed.every((x) => x.startsWith("-")) || !added.every((x) => x.startsWith("+")))
      throw new Error(`resolution.patch hunk at line ${i + 1} is malformed`)
    out.push({ file, start: Number(h[1]) - 1, removed: removed.map((x) => x.slice(1)), added: added.map((x) => x.slice(1)), tier: h[4] as Tier })
    i += nRemoved + nAdded
  }
  return out
}

export function applyPatch(texts: Map<string, string>, hunks: PatchHunk[]): { texts: Map<string, string>; errors: string[] } {
  const errors: string[] = []
  const next = new Map(texts)
  for (const file of new Set(hunks.map((h) => h.file))) {
    const text = texts.get(file)
    if (text === undefined) {
      errors.push(`${file}: the patch touches a file that has no conflict`)
      continue
    }
    const all = lines(text)
    const found = blocks(text)
    const fixes: { block: Block; lines: string[] }[] = []
    for (const h of hunks.filter((x) => x.file === file)) {
      const block = found.find((b) => b.start === h.start && b.end - b.start + 1 === h.removed.length)
      const same = block && all.slice(block.start, block.end + 1).every((l, k) => l === h.removed[k])
      if (!block || !same) errors.push(`${file}:${h.start + 1}: the patch replaces lines that are not exactly one conflict`)
      else if (fixes.some((f) => f.block === block)) errors.push(`${file}:${h.start + 1}: the patch replaces the same conflict twice`)
      else fixes.push({ block, lines: h.added })
    }
    next.set(file, replace(text, fixes))
  }
  return { texts: next, errors }
}
