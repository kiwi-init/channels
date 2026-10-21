import type { Message } from "@kiwi/core/protocol.ts"
import { prChecks, tasksAwaitingPeople, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { FAILED, taskPr } from "@kiwi/core/work.ts"

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

export interface Baton {
  who: string | null
  text: string
  tone: Health
  since?: number
}

function askFor(state: ChannelState, id: number): Message | undefined {
  return state.openAsks.find((m) => {
    const place = state.placeOf.get(m.seq)
    return m.esc && place?.kind === "task" && place.task === id
  })
}

function redSince(state: ChannelState, id: number): { check: string; at: number } | null {
  const pr = taskPr(state, id)
  if (pr?.pr.state !== "open") return null
  const failed = prChecks(state.github, pr.pr)
    .filter((c) => c.conclusion && FAILED.has(c.conclusion))
    .sort((a, b) => a.at - b.at)[0]
  return failed ? { check: failed.name, at: failed.at } : null
}

export function baton(state: ChannelState, b: Branch, name: (n: string) => string): Baton {
  const t = b.task
  const who = (n: string | undefined) => (n ? name(n) : "nobody")
  const ask = askFor(state, t.id)
  if (ask) return { who: "you", text: "with you", tone: "waits", since: ask.ts }
  const red = redSince(state, t.id)
  if (red) return { who: t.owner ?? null, text: `back with ${who(t.owner)}`, tone: "red", since: red.at }
  const round = t.rounds.at(-1)
  if (t.state === "review" && round?.result.kind === "open") return { who: t.review ?? null, text: `with ${t.review ? name(t.review) : "a reviewer"}`, tone: "review", since: round.ts }
  if (t.state === "doing") return { who: t.owner ?? null, text: `with ${who(t.owner)}`, tone: "doing", since: t.createdAt }
  if (t.state === "done") return { who: null, text: taskPr(state, t.id)?.pr.state === "merged" ? "merged" : "done", tone: "done", since: t.updatedAt }
  return { who: t.owner ?? null, text: t.owner ? `queued for ${name(t.owner)}` : "unassigned", tone: "todo" }
}

export interface Change {
  at: number
  task?: number
  tone: Health
  text: string
}

export function changesSince(state: ChannelState, roots: readonly Root[], since: number, name: (n: string) => string): Change[] {
  const out: Change[] = []
  for (const m of state.openAsks) {
    const place = state.placeOf.get(m.seq)
    if (m.ts > since) out.push({ at: m.ts, ...(place?.kind === "task" ? { task: place.task } : {}), tone: "waits", text: `${name(m.from)} asked you: ${m.body}` })
  }
  for (const t of state.tasks.values()) {
    const red = redSince(state, t.id)
    if (red && red.at > since) out.push({ at: red.at, task: t.id, tone: "red", text: `${t.title} went red: ${red.check} failed` })
    const pr = taskPr(state, t.id)
    if (pr?.pr.state === "merged" && pr.pr.at > since) out.push({ at: pr.pr.at, task: t.id, tone: "done", text: `#${pr.pr.number} merged: ${t.title}` })
    for (const r of t.rounds) {
      if (r.ts > since && r.result.kind === "open") out.push({ at: r.ts, task: t.id, tone: "review", text: `${t.title} went to ${t.review ? name(t.review) : "review"}, round ${r.n}` })
      if (r.result.kind === "approved" || r.result.kind === "rejected")
        if (r.result.ts > since)
          out.push({
            at: r.result.ts,
            task: t.id,
            tone: r.result.kind === "approved" ? "done" : "red",
            text: `${name(r.result.by)} ${r.result.kind === "approved" ? "approved" : "sent back"} ${t.title}`,
          })
    }
    if (t.from !== undefined && t.createdAt > since && !t.owner) out.push({ at: t.createdAt, task: t.id, tone: "todo", text: `New follow-up of T${t.from}, nobody has it: ${t.title}` })
  }
  for (const r of roots)
    if (r.kind === "message" && r.splitBy) {
      const fresh = r.branches.filter((b) => b.task.createdAt > since)
      if (fresh.length)
        out.push({ at: Math.max(...fresh.map((b) => b.task.createdAt)), tone: "doing", text: `${name(r.splitBy)} split your #${r.seq} into ${fresh.map((b) => `T${b.task.id}`).join(", ")}` })
    }
  return out.sort((a, b) => b.at - a.at)
}

export interface Frees {
  text: string
  tone: Health | "free"
}

export function freesOf(state: ChannelState, agent: string, name: (n: string) => string, away = false): Frees {
  const open = [...state.tasks.values()].filter((t) => t.owner === agent && t.state !== "done")
  const held = [...open.filter((t) => t.state === "doing"), ...[...state.tasks.values()].filter((t) => t.review === agent && t.state === "review")]
  if (away) return held.length ? { text: `away, holding T${held[0]!.id}`, tone: "red" } : { text: "away", tone: "todo" }
  for (const t of open) if (askFor(state, t.id)) return { text: `waits on you · T${t.id}`, tone: "waits" }
  for (const t of open)
    if (redSince(state, t.id)) {
      const fixer = [...state.tasks.values()].find((c) => c.from === t.id && c.state === "doing" && c.owner && c.owner !== agent)
      return fixer ? { text: `waits on ${name(fixer.owner!)} · T${fixer.id}`, tone: "todo" } : { text: `fixing red CI · T${t.id}`, tone: "red" }
    }
  for (const t of open) {
    const pr = taskPr(state, t.id)
    if (pr?.pr.state === "open" && pr.checks?.running) return { text: `frees when CI passes · #${pr.pr.number}`, tone: "doing" }
  }
  const reviewing = [...state.tasks.values()].find((t) => t.review === agent && t.state === "review" && t.rounds.at(-1)?.result.kind === "open")
  if (reviewing) return { text: `reviewing T${reviewing.id}`, tone: "review" }
  const doing = open.find((t) => t.state === "doing")
  if (doing) {
    const next = open.find((t) => t.state === "todo")
    return { text: `on T${doing.id}${next ? `, then T${next.id}` : ""}`, tone: "doing" }
  }
  return { text: "free", tone: "free" }
}

export function chainOf(roots: readonly Root[], id: number): Chain | null {
  let found: Chain | null = null
  const walk = (b: Branch, up: Task[], root: Root) => {
    if (b.task.id === id) found = { branch: b, up, root }
    for (const c of b.children) walk(c, [b.task, ...up], root)
  }
  for (const r of roots) for (const b of r.branches) walk(b, [], r)
  return found
}

export interface Stall extends Chain {
  who: string
  what: string
  since: number
}

export function stalls(state: ChannelState, roots: readonly Root[], away: (name: string) => number | null, name: (n: string) => string): Stall[] {
  const out: Stall[] = []
  for (const t of state.tasks.values()) {
    const round = t.rounds.at(-1)
    const holders: { who: string; what: string; since: number }[] = []
    if (t.state === "review" && round?.result.kind === "open" && t.review) holders.push({ who: t.review, what: `round ${round.n} of ${t.title}`, since: round.ts })
    if (t.state === "doing" && t.owner) holders.push({ who: t.owner, what: t.title, since: t.updatedAt })
    for (const h of holders) {
      const gone = away(h.who)
      const chain = gone === null ? null : chainOf(roots, t.id)
      if (chain && gone !== null) out.push({ ...chain, who: h.who, what: `${name(h.who)} went away holding ${h.what}`, since: Math.max(gone, h.since) })
    }
  }
  return out
}
