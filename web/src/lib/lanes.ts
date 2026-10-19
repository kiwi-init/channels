import { describeEvent } from "@kiwi/core/format.ts"
import { memberLoad } from "@kiwi/core/load.ts"
import { ignored, type Message } from "@kiwi/core/protocol.ts"
import type { ChannelState, Task } from "@kiwi/core/state.ts"
import type { PrRef } from "@kiwi/core/work.ts"

export interface LaneTask {
  task: Task
  since: number
  pr?: PrRef
}

interface LaneEvent {
  seq: number
  at: number
  text: string
}

export interface LaneWork {
  current: LaneTask[]
  next: Task[]
  watching: PrRef[]
  events: LaneEvent[]
}

const EVENTS = 3

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}

function sinceOf(t: Task, messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const ev = messages[i]!.ev
    if (ev?.op === "task.update" && ev.task === t.id && ev.state === t.state) return messages[i]!.rts ?? messages[i]!.ts
  }
  return t.updatedAt
}

function prOf(prs: Map<number, PrRef[]>, id: number): PrRef | undefined {
  const all = prs.get(id) ?? []
  return all.findLast((p) => p.state === "open") ?? all.at(-1)
}

export function laneWork(state: ChannelState, messages: Message[], name: string, prs: Map<number, PrRef[]>): LaneWork {
  const load = memberLoad(state, name)
  const current = [...load.current, ...load.waiting].map((task) => {
    const pr = prOf(prs, task.id)
    return { task, since: sinceOf(task, messages), ...(pr ? { pr } : {}) }
  })
  const mine = new Set(current.flatMap((c) => (c.pr ? [c.pr.url] : [])))
  const watching =
    state.lead === name
      ? [...state.tasks.values()]
          .filter((t) => t.state === "review" || t.state === "doing")
          .flatMap((t) => {
            const pr = prOf(prs, t.id)
            return pr && pr.state === "open" && !mine.has(pr.url) ? [pr] : []
          })
      : []
  const events: LaneEvent[] = []
  for (let i = messages.length - 1; i >= 0 && events.length < EVENTS; i--) {
    const m = messages[i]!
    if (m.from !== name || ignored(state.trust.get(m.seq))) continue
    const op = m.ev?.op
    if (op === "task.add" || op === "task.update" || op === "task.claim") events.push({ seq: m.seq, at: m.rts ?? m.ts, text: clip(describeEvent(m, state), 90) })
    else if (m.kind === "done") events.push({ seq: m.seq, at: m.rts ?? m.ts, text: clip(m.body, 90) })
  }
  return { current, next: load.queued, watching, events }
}
