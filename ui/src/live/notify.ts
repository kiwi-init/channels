import type { Message as Wire } from "@kiwi/core/protocol.ts"
import type { Channel, Prefs } from "~/model"

const isDecision = (m: Wire): boolean => (m.kind === "ask" || m.kind === "blocking") && !m.permission && !m.handoff

export function worthTelling(m: Wire, me: string, notify: Prefs["notify"], decides: boolean): boolean {
  if (m.kind === "event" || m.from === me || notify === "none") return false
  if (notify === "all") return true
  return !!m.to?.includes(me) || m.body.includes(`@${me}`) || (decides && !!m.esc && isDecision(m))
}

export const elsewhere = (): boolean => document.hidden || !document.hasFocus()

export function drawerNews(channel: Pick<Channel, "rooms" | "directs">): "loud" | "quiet" | null {
  if (channel.rooms.some((r) => r.mentions > 0) || channel.directs.some((d) => d.unread > 0)) return "loud"
  return channel.rooms.some((r) => r.unread > 0) ? "quiet" : null
}

export const channelLink = (code: string): string => `kiwi://join/${encodeURIComponent(code)}`

export function lastWorth(messages: readonly Wire[], me: string, notify: Prefs["notify"], decides: boolean): Wire | null {
  return messages.findLast((m) => m.sigOk && worthTelling(m, me, notify, decides)) ?? null
}

export interface Heads {
  start(code: string, seq: number): void
  head(code: string, seq: number): void
}

export function heardHeads(skip: (code: string) => boolean, read: (code: string, after: number, upTo: number) => Promise<void>): Heads {
  const told = new Map<string, number>()
  const reading = new Map<string, number>()
  const head = (code: string, seq: number): void => {
    const prev = told.get(code)
    if (prev !== undefined && seq <= prev) return
    const wanted = reading.get(code)
    if (wanted !== undefined) return void reading.set(code, Math.max(wanted, seq))
    told.set(code, seq)
    if (prev === undefined || skip(code)) return
    reading.set(code, seq)
    void read(code, prev, seq)
      .catch(() => {})
      .finally(() => {
        const next = reading.get(code) ?? seq
        reading.delete(code)
        if (next > seq) head(code, next)
      })
  }
  const start = (code: string, seq: number): void => {
    if (!told.has(code)) told.set(code, seq)
  }
  return { start, head }
}
