import { PERMISSION_CHOICES, permissionAnswer, type PermissionSettled } from "@kiwi/core/permission.ts"
import type { Message } from "@kiwi/core/protocol.ts"
import type { ChannelState } from "@kiwi/core/state.ts"

export const [ALLOW_ONCE, DENY] = PERMISSION_CHOICES

export interface Settled {
  answer?: { allow: boolean; by: string; at: number }
  closed?: { kind: PermissionSettled; at: number }
}

export function settledOf(ask: Message, replies: readonly Message[], state: ChannelState): Settled | null {
  let answer: Settled["answer"]
  for (const r of [...replies].sort((a, b) => a.seq - b.seq)) {
    if (r.from === ask.from && r.settled && state.trust.get(r.seq) === "verified") return { ...(answer ? { answer } : {}), closed: { kind: r.settled, at: r.ts } }
    if (answer) continue
    const said = permissionAnswer(ask, r, state)
    if (said) answer = { allow: said === "allow", by: r.from, at: r.ts }
  }
  return answer ? { answer } : null
}
