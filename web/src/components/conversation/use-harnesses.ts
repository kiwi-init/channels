import { useMemo } from "react"

import type { JoinRequest } from "@kiwi/core/membership.ts"
import type { ChannelState } from "@kiwi/core/state.ts"

export function useHarnesses(state: ChannelState, requests: readonly JoinRequest[]): ReadonlyMap<string, string> {
  const pairs = JSON.stringify([
    ...[...state.members.values()].flatMap((m) => {
      const h = m.runs?.harness ?? m.card?.harness
      return m.active && h ? [[m.name, h] as const] : []
    }),
    ...requests.flatMap((r) => (r.card?.harness ? [[r.name, r.card.harness] as const] : [])),
  ])
  return useMemo(() => new Map(JSON.parse(pairs) as [string, string][]), [pairs])
}
