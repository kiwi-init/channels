import type { Handoff } from "@kiwi/core/protocol.ts"
import { handoffOpen } from "@kiwi/app/handoff.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"

export function openHandoff(h: Handoff, now = Date.now()): boolean {
  if (!handoffOpen(h, now)) return false
  const b = bridge()
  if (b) void b.openExternal(h.url)
  else window.open(h.url, "_blank", "noopener,noreferrer")
  return true
}
