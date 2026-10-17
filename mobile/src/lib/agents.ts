import type { Activity, Card, Color } from "@mc/protocol.ts"
import { formatAgo, shortTitle } from "@web/lib/format"
import { howWords, type How } from "@web/lib/presence"

interface TaskRef {
  id: number
  title: string
}

interface AgentLoad {
  current: readonly TaskRef[]
  queued: readonly TaskRef[]
  waiting: readonly TaskRef[]
}

export interface AgentNow {
  name: string
  label: string
  color: Color | null
  here: How | null
  coordinator: boolean
  model?: string
  activity?: Activity
  load: AgentLoad
  lastAt?: number
  card?: Card
}

export interface Doing {
  text: string
  busy: boolean
}

export function doingNow(a: AgentNow): Doing | null {
  const act = a.here ? a.activity : undefined
  if (act?.state === "working") return { text: act.tool ? `Running ${act.tool}` : "Thinking", busy: true }
  if (act?.state === "waiting") return { text: "Waiting for a person", busy: false }
  if (act?.state === "idle") return { text: "Idle", busy: false }
  return null
}

export const isBusy = (a: AgentNow): boolean => !!a.here && (doingNow(a)?.busy ?? a.load.current.length > 0)

export const byBusy = (agents: readonly AgentNow[]): AgentNow[] => [...agents].sort((a, b) => Number(isBusy(b)) - Number(isBusy(a)) || Number(!!b.here) - Number(!!a.here))

export function presenceWord(a: AgentNow, now: number, brief = false): string {
  if (a.here) return "online"
  return a.lastAt && !brief ? `away · ${formatAgo(a.lastAt, now)}` : "away"
}

export function restingWord(a: AgentNow): string | null {
  if (a.load.current.length || doingNow(a)) return null
  return a.here ? howWords(a.here) : "Not listening"
}

export function queueWord(a: AgentNow): string | null {
  const parts = [a.load.queued.length ? `${a.load.queued.length} queued` : null, a.load.waiting.length ? `${a.load.waiting.length} waiting for review` : null].filter((p): p is string => p !== null)
  return parts.length ? parts.join(" · ") : null
}

export interface Summary {
  count: string
  line: string
  faces: AgentNow[]
}

export function summarize(agents: readonly AgentNow[]): Summary {
  const ordered = byBusy(agents)
  const working = ordered.filter(isBusy)
  const here = agents.filter((a) => a.here).length
  const line = working.length
    ? working
        .slice(0, 2)
        .map((a) => (a.load.current[0] ? `${a.label} on ${shortTitle(a.load.current[0].title)}` : `${a.label}: ${doingNow(a)?.text ?? "working"}`))
        .join(" · ") + (working.length > 2 ? ` · ${working.length - 2} more` : "")
    : here
      ? "Nobody's working on a task right now"
      : "No agent is online"
  return { count: working.length ? `${working.length} working` : `${here} online`, line, faces: ordered.slice(0, 4) }
}
