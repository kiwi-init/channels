import { git } from "./git.ts"

type Workflow = { jobs?: Record<string, unknown>; [key: string]: unknown }

function read(repo: string, rev: string, path: string): Workflow | undefined {
  try {
    return Bun.YAML.parse(git(repo, ["show", `${rev}:${path}`])) as Workflow
  } catch {
    return undefined
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** One job's definition in the workflow at `rev`. */
export function workflowJob(repo: string, rev: string, path: string, job: string): unknown {
  return read(repo, rev, path)?.jobs?.[job]
}

/** The jobs whose definition differs between base and head, or "all" when anything outside `jobs` changed. */
export function changedWorkflowJobs(repo: string, base: string, head: string, path: string): "all" | Set<string> {
  const a = read(repo, base, path)
  const b = read(repo, head, path)
  if (!a || !b) return "all"
  const { jobs: ja = {}, ...restA } = a
  const { jobs: jb = {}, ...restB } = b
  if (!same(restA, restB)) return "all"
  const changed = new Set<string>()
  for (const id of new Set([...Object.keys(ja), ...Object.keys(jb)])) if (!same(ja[id], jb[id])) changed.add(id)
  return changed
}
