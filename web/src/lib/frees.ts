import type { Message } from "@kiwi/core/protocol.ts"
import { openRound, taskId, type ChannelState, type Lease, type Task } from "@kiwi/core/state.ts"
import { pickFor, taskCandidates, type Candidate } from "@kiwi/core/routing.ts"
import { taskPr, type PrChecks } from "@kiwi/core/work.ts"
import type { AgentNow } from "@/components/agent-strip"

export type Frees =
  | { kind: "away"; task: Task | undefined; since: number }
  | { kind: "you"; ask: Message; task: Task | undefined }
  | { kind: "lease"; lease: Lease; place: number; task: Task | undefined }
  | { kind: "working"; task: Task; queued: Task[]; checks: PrChecks | undefined; pr: number | undefined }
  | { kind: "reviewing"; task: Task }
  | { kind: "review"; task: Task; reviewer: string | undefined; checks: PrChecks | undefined; pr: number | undefined }
  | { kind: "free" }

export type Tone = "free" | "doing" | "decide" | "alert" | "quiet"

const isPersonName = (state: ChannelState, name: string) => {
  const m = state.members.get(name)
  return m?.kind === "human" || !!m?.owner
}

export function freesOf(state: ChannelState, a: AgentNow, now: number): Frees {
  const doing = a.load.current[0]
  if (!a.here) return { kind: "away", task: doing, since: a.lastAt ?? now }
  const ask = [...state.openAsks].reverse().find((m) => m.from === a.name && (m.kind === "blocking" || m.kind === "ask") && (m.to ?? []).some((t) => isPersonName(state, t)))
  if (ask) return { kind: "you", ask, task: ask.task !== undefined ? state.tasks.get(ask.task) : doing }
  for (const lease of state.leases.values()) {
    const place = lease.queue.findIndex((q) => q.name === a.name)
    if (place >= 0 && lease.holder !== a.name) return { kind: "lease", lease, place: place + 1, task: doing }
  }
  if (doing) {
    const pr = taskPr(state, doing.id)
    return { kind: "working", task: doing, queued: a.load.queued, checks: pr?.checks, pr: pr?.pr.number }
  }
  const owed = [...state.tasks.values()].find((t) => t.state === "review" && t.review === a.name && openRound(t))
  if (owed) return { kind: "reviewing", task: owed }
  const waiting = a.load.waiting[0]
  if (waiting) {
    const pr = taskPr(state, waiting.id)
    return { kind: "review", task: waiting, reviewer: waiting.review && waiting.review !== "*" ? waiting.review : undefined, checks: pr?.checks, pr: pr?.pr.number }
  }
  return { kind: "free" }
}

export const takesWork = (f: Frees) => f.kind === "free" || f.kind === "review"

export function toneOf(f: Frees): Tone {
  if (f.kind === "free" || f.kind === "review") return "free"
  if (f.kind === "working" || f.kind === "reviewing") return "doing"
  if (f.kind === "you" || f.kind === "lease") return "decide"
  return f.task ? "alert" : "quiet"
}

const mins = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000))
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`
}

export function checksLine(c: PrChecks | undefined): string | null {
  if (!c) return null
  const total = c.passed + c.failed.length + c.running
  if (c.failed.length) return `${c.failed[0]} failed`
  if (c.running) return `CI ${c.passed} of ${total}`
  return "checks passed"
}

export function freesWord(f: Frees, now: number, nameOf: (n: string) => string): { label: string; when: string } {
  switch (f.kind) {
    case "away":
      return f.task ? { label: `Away ${mins(now - f.since)}`, when: `${taskId(f.task.id)} has stalled` } : { label: "Away", when: `since ${mins(now - f.since)} ago` }
    case "you":
      return { label: "Waits on you", when: `asked ${mins(now - (f.ask.rts ?? f.ask.ts))} ago` }
    case "lease": {
      const holder = f.lease.holder ? nameOf(f.lease.holder) : "nobody"
      return { label: `In line for ${f.lease.name}`, when: `${holder} has it · ${mins(f.lease.until - now)} left` }
    }
    case "working":
      return { label: `On ${taskId(f.task.id)}`, when: f.queued.length ? `then ${f.queued.map((t) => taskId(t.id)).join(", ")}` : "nothing queued after" }
    case "reviewing":
      return { label: `Reviewing ${taskId(f.task.id)}`, when: "frees when the verdict is in" }
    case "review":
      return { label: "Free", when: `${taskId(f.task.id)} waits on ${f.reviewer ? nameOf(f.reviewer) : "a review"}` }
    case "free":
      return { label: "Free", when: "nothing on its plate" }
  }
}

export interface Suggestion {
  pick: Candidate | null
  ranked: Candidate[]
}

export function suggestFor(state: ChannelState, id: number): Suggestion {
  const ranked = taskCandidates(state, id).filter((c) => state.lead !== c.name)
  return { pick: pickFor(ranked), ranked }
}

export function unassigned(state: ChannelState): Task[] {
  return [...state.tasks.values()].filter((t) => t.state === "todo" && !t.owner && !t.cancelled).sort((a, b) => a.id - b.id)
}
