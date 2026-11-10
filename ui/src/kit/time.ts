import { useEffect, useState } from "react"

import { span, t } from "~/i18n/i18n"

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEK = 7 * DAY

const locales = (): string[] => {
  const lang = typeof document === "undefined" ? "" : document.documentElement.lang
  return lang && lang !== "en" ? [lang] : []
}

let clocks: { lang: string; format: Intl.DateTimeFormat } | null = null

export function clock(at: number): string {
  const lang = locales().join()
  if (clocks?.lang !== lang) clocks = { lang, format: new Intl.DateTimeFormat(locales(), { hour: "2-digit", minute: "2-digit" }) }
  return clocks.format.format(at)
}

export function ageOf(at: number, now = Date.now()): "now" | "recent" | "date" {
  const d = now - at
  return d < MIN ? "now" : d < WEEK ? "recent" : "date"
}

export function ago(at: number, now = Date.now()): string {
  const d = Math.max(0, now - at)
  if (d < MIN) return t("kit.time.now")
  if (d < HOUR) return span(Math.floor(d / MIN), "minute")
  if (d < DAY) return span(Math.floor(d / HOUR), "hour")
  if (d < WEEK) return span(Math.floor(d / DAY), "day")
  return new Date(at).toLocaleDateString(locales(), { month: "short", day: "numeric" })
}

export function day(at: number, now = Date.now()): string {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (at >= start.getTime()) return t("kit.time.today")
  if (at >= start.getTime() - DAY) return t("kit.time.yesterday")
  return new Date(at).toLocaleDateString(locales(), { weekday: "long", month: "short", day: "numeric" })
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
