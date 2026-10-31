import { GENERAL_ROOM, type Message as Wire } from "@kiwi/core/protocol.ts"
import { mentions } from "~/live/mention"
import { worthTelling } from "~/live/notify"
import type { Prefs, Quiet } from "~/model"

export type SnoozeFor = "1h" | "8h" | "tomorrow"

export const muteKey = (code: string, room?: string | null): string => (room ? `${code}/${room}` : code)

export const isMuted = (muted: readonly string[], code: string, room?: string | null): boolean => muted.includes(code) || (!!room && muted.includes(muteKey(code, room)))

export function snoozeEnd(choice: SnoozeFor, now: number): number {
  if (choice === "1h") return now + 3_600_000
  if (choice === "8h") return now + 8 * 3_600_000
  const at = new Date(now)
  at.setDate(at.getDate() + 1)
  at.setHours(9, 0, 0, 0)
  return at.getTime()
}

export function inQuietHours(quiet: Quiet, now: number): boolean {
  if (!quiet.on || quiet.from === quiet.to) return false
  const at = new Date(now)
  const minute = at.getHours() * 60 + at.getMinutes()
  return quiet.from < quiet.to ? minute >= quiet.from && minute < quiet.to : minute >= quiet.from || minute < quiet.to
}

export const silentNow = (prefs: Pick<Prefs, "snoozeUntil" | "quiet">, now: number): boolean => (prefs.snoozeUntil !== null && now < prefs.snoozeUntil) || inQuietHours(prefs.quiet, now)

export const forYou = (m: Pick<Wire, "to" | "body" | "from">, me: string): boolean => m.from !== me && (!!m.to?.includes(me) || mentions(m.body, me))

export function tells(m: Wire, me: string, prefs: Pick<Prefs, "notify" | "muted" | "snoozeUntil" | "quiet">, code: string, decides: boolean, now: number): boolean {
  if (silentNow(prefs, now) || !worthTelling(m, me, prefs.notify, decides)) return false
  if (!isMuted(prefs.muted, code, m.room ?? GENERAL_ROOM)) return true
  return forYou(m, me) || (decides && !!m.esc)
}

export const pausedLabel = (prefs: Pick<Prefs, "snoozeUntil">): string =>
  prefs.snoozeUntil !== null && prefs.snoozeUntil > Date.now()
    ? `Notifications paused until ${new Date(prefs.snoozeUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Quiet hours: notifications paused"
