import type { Handoff } from "@kiwi/core/protocol.ts"
import { handoffOpen } from "./handoff"
import { bridge } from "./secrets"

export function openHandoff(h: Handoff, now = Date.now()): boolean {
  if (!handoffOpen(h, now)) return false
  const b = bridge()
  if (b) void b.openExternal(h.url)
  else window.open(h.url, "_blank", "noopener,noreferrer")
  return true
}
