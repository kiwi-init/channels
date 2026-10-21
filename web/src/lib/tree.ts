import type { Message } from "@kiwi/core/protocol.ts"
import { tasksAwaitingPeople, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { taskPr } from "@kiwi/core/work.ts"

export type Health = "red" | "waits" | "doing" | "review" | "todo" | "done"

const WORST: Health[] = ["red", "waits", "doing", "review", "todo", "done"]

export interface Roll {
  tasks: number
  done: number
  red: number
  waits: number
  review: number
  doing: number
  todo: number
  ms: number
  worst: Health
}

export interface Branch {
  task: Task
  health: Health
  why?: string
  ms: number
  children: Branch[]
  roll: Roll
}

export interface Root {
  key: string
  kind: "message" | "issue" | "made"
  seq?: number
  from: string
  text: string
  at: number
  splitBy?: string
  branches: Branch[]
  roll: Roll
}

export interface Chain {
  branch: Branch
  up: Task[]
  root: Root
}

const empty = (): Roll => ({ tasks: 0, done: 0, red: 0, waits: 0, review: 0, doing: 0, todo: 0, ms: 0, worst: "done" })

function add(into: Roll, r: Roll): Roll {
  return {
    tasks: into.tasks + r.tasks,
    done: into.done + r.done,
    red: into.red + r.red,
    waits: into.waits + r.waits,
    review: into.review + r.review,
    doing: into.doing + r.doing,
    todo: into.todo + r.todo,
    ms: into.ms + r.ms,
    worst: WORST.indexOf(r.worst) < WORST.indexOf(into.worst) ? r.worst : into.worst,
  }
}

export function healthOf(state: ChannelState, t: Task, waiting: ReadonlySet<number>): { health: Health; why?: string } {
  if (t.state === "done") return { health: "done" }
  if (waiting.has(t.id)) return { health: "waits", why: "waits on you" }
  const pr = taskPr(state, t.id)
  if (pr?.pr.state === "open" && pr.checks?.failed.length) return { health: "red", why: `${pr.checks.failed[0]} failed` }
  const last = t.rounds.at(-1)
  if (last?.result.kind === "rejected") return { health: "red", why: `round ${last.n} sent back` }
  if (t.state === "review") return { health: "review" }
  if (t.state === "doing") return { health: "doing" }
  return { health: "todo" }
}

function grow(state: ChannelState, t: Task, kids: Map<number, Task[]>, waiting: ReadonlySet<number>, now: number): Branch {
  const { health, why } = healthOf(state, t, waiting)
  const ms = Math.max(0, (t.state === "done" ? t.updatedAt : now) - t.createdAt)
  const children = (kids.get(t.id) ?? []).sort((a, b) => a.createdAt - b.createdAt).map((c) => grow(state, c, kids, waiting, now))
  const own: Roll = { ...empty(), tasks: 1, ms, worst: health }
  own[health] += 1
  const roll = children.reduce((r, c) => add(r, c.roll), own)
  return { task: t, health, ...(why ? { why } : {}), ms, children, roll }
}

export function lineage(state: ChannelState, messages: readonly Message[], now: number): Root[] {
  const tasks = [...state.tasks.values()].filter((t) => !t.archived)
  const waiting = tasksAwaitingPeople(state)
  const kids = new Map<number, Task[]>()
  const tops: Task[] = []
  for (const t of tasks) {
    if (t.from !== undefined && state.tasks.has(t.from)) kids.set(t.from, [...(kids.get(t.from) ?? []), t])
    else tops.push(t)
  }
  const bySeq = new Map(messages.map((m) => [m.seq, m]))
  const roots = new Map<string, Root>()
  for (const t of tops.sort((a, b) => a.createdAt - b.createdAt)) {
    const m = t.source !== undefined ? bySeq.get(t.source) : undefined
    const key = m ? `m${m.seq}` : t.issue ? `i${t.issue.repo}#${t.issue.number}` : `c${t.createdBy}`
    const root =
      roots.get(key) ??
      (m
        ? { key, kind: "message" as const, seq: m.seq, from: m.from, text: m.body, at: m.ts, branches: [], roll: empty() }
        : t.issue
          ? { key, kind: "issue" as const, from: t.createdBy, text: `${t.issue.repo}#${t.issue.number}`, at: t.createdAt, branches: [], roll: empty() }
          : { key, kind: "made" as const, from: t.createdBy, text: "", at: t.createdAt, branches: [], roll: empty() })
    const b = grow(state, t, kids, waiting, now)
    root.branches.push(b)
    root.roll = add(root.roll, b.roll)
    if (m && t.createdBy !== m.from) root.splitBy = t.createdBy
    roots.set(key, root)
  }
  return [...roots.values()].sort((a, b) => WORST.indexOf(a.roll.worst) - WORST.indexOf(b.roll.worst) || b.at - a.at)
}

export function troubled(b: Branch): boolean {
  return b.roll.red + b.roll.waits > 0
}

export function chains(roots: readonly Root[]): Chain[] {
  const out: Chain[] = []
  const walk = (b: Branch, up: Task[], root: Root) => {
    if (b.health === "red" || b.health === "waits") out.push({ branch: b, up, root })
    for (const c of b.children) walk(c, [b.task, ...up], root)
  }
  for (const r of roots) for (const b of r.branches) walk(b, [], r)
  return out.sort((a, b) => WORST.indexOf(a.branch.health) - WORST.indexOf(b.branch.health))
}

export function span(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return min % 60 ? `${h}h ${min % 60}m` : `${h}h`
}

export function rollWords(r: Roll): string[] {
  return [
    `${r.tasks} ${r.tasks === 1 ? "task" : "tasks"}`,
    r.done ? `${r.done} done` : null,
    r.red ? `${r.red} red` : null,
    r.waits ? `${r.waits} ${r.waits === 1 ? "waits" : "wait"} on you` : null,
    r.review ? `${r.review} in review` : null,
  ].filter((x): x is string => !!x)
}
