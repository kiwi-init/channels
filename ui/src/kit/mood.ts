import { useEffect, useState } from "react"
import type { Person } from "~/model"

const MOODS = ["free", "thinking", "tool", "waiting", "overloaded", "done", "error", "offline"] as const
export type Mood = (typeof MOODS)[number]

export type MoodOf = Partial<Pick<Person, "activity" | "load" | "red" | "doneAt">> & Pick<Person, "presence">

export const DONE_FOR = 4000

export function moodOf(p: MoodOf, now: number): Mood {
  if (p.presence === "offline") return "offline"
  if (p.activity?.state === "waiting") return "waiting"
  if (p.load?.level === "overloaded") return "overloaded"
  if (p.activity?.state === "working") return p.activity.tool ? "tool" : "thinking"
  if (p.red) return "error"
  if (p.doneAt !== undefined && Math.abs(now - p.doneAt) < DONE_FOR) return "done"
  return "free"
}

export function useMood(p: MoodOf | undefined): Mood {
  const doneAt = p?.doneAt
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (doneAt === undefined) return
    const tick = () => setNow(Date.now())
    const soon = setTimeout(tick, 0)
    const after = setTimeout(tick, Math.max(0, doneAt + DONE_FOR - Date.now()) + 50)
    return () => {
      clearTimeout(soon)
      clearTimeout(after)
    }
  }, [doneAt])
  return p ? moodOf(p, now) : "free"
}
