import { createHash } from "node:crypto"
import { show, type Tree } from "./git.ts"

type Workflow = { jobs?: Record<string, unknown>; [key: string]: unknown }

const INERT: Record<string, string> = {
  name: "the workflow's name",
  "run-name": "the run's name",
  on: "which events start the workflow",
  concurrency: "which runs cancel each other",
}
const SCOPED = new Set(["permissions"])

export function readWorkflow(repo: string, rev: string, path: string): Workflow | undefined {
  const text = show(repo, rev, path)
  if (text === undefined) return undefined
  try {
    const parsed: unknown = Bun.YAML.parse(text)
    return parsed && typeof parsed === "object" ? (parsed as Workflow) : undefined
  } catch {
    return undefined
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function localUses(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const v of node) localUses(v, out)
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) {
      if (k === "uses" && typeof v === "string" && v.startsWith("./")) out.push(v.slice(2).replace(/\/$/, ""))
      else localUses(v, out)
    }
  return out
}

function localFiles(repo: string, rev: string, tree: Tree, node: unknown, seen: Set<string>): string[] {
  const lines: string[] = []
  for (const ref of localUses(node)) {
    if (seen.has(ref)) continue
    seen.add(ref)
    const before = lines.length
    if (tree.has(ref)) {
      lines.push(`${ref} ${tree.get(ref)}`)
      const text = show(repo, rev, ref)
      if (text !== undefined) lines.push(...localFiles(repo, rev, tree, safeParse(text), seen))
      continue
    }
    for (const [path, sha] of tree) if (path.startsWith(`${ref}/`)) lines.push(`${path} ${sha}`)
    for (const file of [`${ref}/action.yml`, `${ref}/action.yaml`]) {
      const text = tree.has(file) ? show(repo, rev, file) : undefined
      if (text !== undefined) lines.push(...localFiles(repo, rev, tree, safeParse(text), seen))
    }
    if (lines.length === before) lines.push(`${ref} missing`)
  }
  return lines
}

function safeParse(text: string): unknown {
  try {
    return Bun.YAML.parse(text)
  } catch {
    return text
  }
}

export function jobFingerprint(repo: string, rev: string, tree: Tree, wf: Workflow | undefined, job: string): string {
  const block = wf?.jobs?.[job]
  const files = block === undefined ? [] : localFiles(repo, rev, tree, block, new Set()).sort()
  return createHash("sha256")
    .update(JSON.stringify(block ?? null))
    .update(files.join("\n"))
    .digest("hex")
}

export type WorkflowChange = {
  all?: string
  jobs: Map<string, string>
  notes: string[]
}

export function workflowChange(repo: string, path: string, base: { rev: string; tree: Tree }, head: { rev: string; tree: Tree }): WorkflowChange {
  const a = readWorkflow(repo, base.rev, path)
  const b = readWorkflow(repo, head.rev, path)
  const out: WorkflowChange = { jobs: new Map(), notes: [] }
  if (!b) return { ...out, all: `${path} doesn't parse at the head` }
  if (!a) return { ...out, all: `${path} is new or didn't parse at the base` }
  const ja = a.jobs ?? {}
  const jb = b.jobs ?? {}
  const ids = [...new Set([...Object.keys(ja), ...Object.keys(jb)])]
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== "jobs" && !same(a[k], b[k]))
  for (const key of keys) {
    if (INERT[key]) out.notes.push(`\`${path}\`: only \`${key}\` (${INERT[key]}) changed outside the jobs; no job's result depends on it.`)
    else if (SCOPED.has(key)) {
      for (const id of ids) {
        const own = jb[id]
        if (!(own && typeof own === "object" && key in own)) out.jobs.set(id, `the workflow's \`${key}\` changed, and it inherits them`)
      }
    } else return { ...out, all: `\`${key}\` in ${path} changed, and every job uses it` }
  }
  for (const id of ids) {
    if (out.jobs.has(id)) continue
    if (jobFingerprint(repo, base.rev, base.tree, a, id) !== jobFingerprint(repo, head.rev, head.tree, b, id))
      out.jobs.set(id, same(ja[id], jb[id]) ? "a local action or workflow it uses changed" : `its job in ${path} changed`)
  }
  return out
}
