import { GENERAL_ROOM, type Message as Wire } from "@kiwi/core/protocol.ts"
import { mentions } from "~/live/mention"
import { worthTelling } from "~/live/notify"
import type { Prefs, Quiet } from "~/model"

export const isMuted = (muted: readonly string[], code: string, room?: string | null): boolean => muted.includes(code) || (!!room && muted.includes(`${code}/${room}`))

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
