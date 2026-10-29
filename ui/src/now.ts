import { liveOf } from "~/doing"
import type { Channel, Message, Person, PullRequest, Task } from "~/model"
import { shown } from "~/names"

const WORKING_SHOWN = 5
const DONE_SHOWN = 3
const RECENT = 3
const CLIP = 90

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length <= CLIP ? line : `${line.slice(0, CLIP - 1).trimEnd()}…`
}

export const startOfDay = (now: number): number => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const live = (channel: Channel): Task[] => channel.tasks.filter((t) => !t.archived && !t.cancelled)

export function stageWords(t: Task): { text: string; red: boolean } {
  const pr = t.pr ? `PR #${t.pr.number}` : null
  const ticks = t.pr?.ticks
  const at = (words: string): string => (pr ? `${pr} · ${words}` : words)
  switch (t.stage) {
    case "red": {
      const failed = ticks?.failed ?? []
      return { text: at(failed.length === 1 ? `${failed[0]} failed` : failed.length ? `${failed.length} checks failed` : "checks failed"), red: true }
    }
    case "proving":
      return { text: at(ticks?.running ? "checks running" : ticks ? "checks passed" : "no checks yet"), red: false }
    case "yours":
      return { text: at("review owed"), red: false }
    case "done":
      if (t.release) return { text: at(`shipped in ${t.release}`), red: false }
      return { text: pr && t.pr?.state === "merged" ? `${pr} merged` : "done", red: false }
    default:
      return { text: pr ?? "no PR yet", red: false }
  }
}

const isWorking = (t: Task): boolean => t.status === "doing" || t.status === "review" || t.status === "waiting" || (t.status === "todo" && t.pr?.state === "open")

const doneAt = (t: Task): number => t.pr?.mergedAt ?? t.updatedAt

export interface Now {
  next: string | null
  working: Task[]
  more: number
  done: Task[]
  doneCount: number
}

export function nowOf(channel: Channel, now = Date.now()): Now {
  const tasks = live(channel)
  const working = tasks.filter(isWorking).sort((a, b) => b.updatedAt - a.updatedAt)
  const since = startOfDay(now)
  const done = tasks.filter((t) => t.status === "done" && doneAt(t) >= since).sort((a, b) => doneAt(b) - doneAt(a))
  return {
    next: channel.next ?? null,
    working: working.slice(0, WORKING_SHOWN),
    more: Math.max(0, working.length - WORKING_SHOWN),
    done: done.slice(0, DONE_SHOWN),
    doneCount: done.length,
  }
}

const agents = (channel: Channel): Person[] => channel.people.filter((p) => p.kind === "agent" && !p.left)

export function headerLine(channel: Channel, needs: number, now = Date.now()): string[] {
  const working = agents(channel).filter((p) => liveOf(p)?.busy).length
  const merged = (channel.mergedAt ?? []).filter((at) => at >= startOfDay(now)).length
  return [working ? `${working} working` : null, merged ? `${merged} merged today` : null, needs ? `${needs} ${needs === 1 ? "needs" : "need"} you` : null].filter((x): x is string => !!x)
}

interface Recent {
  seq: number
  at: number
  text: string
}

export interface Lane {
  person: Person
  current: Task[]
  next: Task[]
  watching: (PullRequest & { task: number })[]
  recent: Recent[]
}

function recentOf(messages: readonly Message[], p: Person): Recent[] {
  const who = `${shown(p)} `
  const out: Recent[] = []
  for (let i = messages.length - 1; i >= 0 && out.length < RECENT; i--) {
    const m = messages[i]!
    if (m.from !== p.name || m.task === undefined || !(m.system || m.done) || m.pending || m.failed) continue
    const text = m.system && m.text.startsWith(who) ? m.text.slice(who.length) : m.text
    out.push({ seq: m.seq, at: m.at, text: clip(text) })
  }
  return out
}

export function laneOf(channel: Channel, p: Person): Lane {
  const byId = new Map(live(channel).map((t) => [t.id, t]))
  const pick = (ids: readonly number[]): Task[] => ids.flatMap((id) => byId.get(id) ?? [])
  const current = pick([...(p.load?.doing ?? []), ...(p.load?.waiting ?? [])])
  const mine = new Set(current.map((t) => t.id))
  const watching =
    p.name === channel.lead ? [...byId.values()].flatMap((t) => (!mine.has(t.id) && (t.status === "review" || t.status === "doing") && t.pr?.state === "open" ? [{ ...t.pr, task: t.id }] : [])) : []
  return { person: p, current, next: pick(p.load?.queued ?? []), watching, recent: recentOf(channel.messages, p) }
}

const rank = (channel: Channel, p: Person): number => (p.name === channel.lead ? 0 : liveOf(p)?.busy ? 1 : p.presence === "online" ? 2 : 3)

export function lanesOf(channel: Channel): Lane[] {
  return agents(channel)
    .sort((a, b) => rank(channel, a) - rank(channel, b))
    .map((p) => laneOf(channel, p))
}
