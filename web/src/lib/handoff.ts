import type { Handoff, Message } from "@mc/protocol.ts"
import { bridge } from "./secrets"

export const handoffOf = (m: Message): Handoff | null => (m.esc && m.handoff ? m.handoff : null)

export const handoffOpen = (h: Handoff, now: number): boolean => h.expiresAt > now

export function handoffLeft(h: Handoff, now: number): string {
  const minutes = Math.max(1, Math.ceil((h.expiresAt - now) / 60_000))
  return minutes === 1 ? "expires in 1 min" : `expires in ${minutes} min`
}

export function openHandoff(h: Handoff): void {
  const b = bridge()
  if (b) void b.openExternal(h.url)
  else window.open(h.url, "_blank", "noopener,noreferrer")
}
