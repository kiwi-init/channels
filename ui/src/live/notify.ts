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
