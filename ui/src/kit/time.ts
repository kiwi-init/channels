import { useEffect, useState } from "react"

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

export function ago(at: number, now = Date.now()): string {
  const d = Math.max(0, now - at)
  if (d < MIN) return "now"
  if (d < HOUR) return `${Math.floor(d / MIN)}m`
  if (d < DAY) return `${Math.floor(d / HOUR)}h`
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d`
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" })
}

export function day(at: number, now = Date.now()): string {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (at >= start.getTime()) return "Today"
  if (at >= start.getTime() - DAY) return "Yesterday"
  return new Date(at).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })
}

export const sameDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString()

export function useNow(every: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (every === null) return
    const timer = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [every])
  return now
}
