import { memberLoad } from "@mc/load.ts"
import type { Activity, Message, Reach } from "@mc/protocol.ts"
import { colorOf, type ChannelState } from "@mc/state.ts"
import { isWakeVia } from "@mc/wake.ts"
import { howHere } from "@web/lib/presence"

import type { AgentNow } from "./agents"

export interface Online {
  client: string
  at: number
  pk?: string
  activity?: Activity
  reach?: Reach
  wakes: boolean
}

export const PRESENCE_TTL = 150_000

export function onlineFrom(p: { client: string; pk?: string; activity?: Activity; reach?: Reach; wake?: unknown }, now: number): Online {
  return { client: p.client, at: now, pk: p.pk, ...(p.activity ? { activity: p.activity } : {}), ...(p.reach ? { reach: p.reach } : {}), wakes: isWakeVia(p.wake) && p.wake !== "hooks" }
}

export function trusted(online: ReadonlyMap<string, Online>, keyOf: ReadonlyMap<string, string>, now: number): Map<string, Online> {
  return new Map([...online].filter(([name, o]) => !!o.pk && keyOf.get(name) === o.pk && now - o.at < PRESENCE_TTL && howHere(o) !== null))
}

export function agentsNow(state: ChannelState, messages: readonly Message[], online: ReadonlyMap<string, Online>, now: number): AgentNow[] {
  const lastAt = new Map<string, number>()
  for (const m of messages) if (m.kind !== "event") lastAt.set(m.from, m.ts)
  return [...state.members.values()]
    .filter((m) => m.active && m.kind !== "human")
    .map((m) => ({
      name: m.name,
      label: m.display || m.name,
      color: colorOf(state, m.name),
      here: howHere(online.get(m.name)),
      coordinator: m.name === state.coordinator,
      model: online.get(m.name)?.activity?.model ?? m.card?.model,
      activity: online.get(m.name)?.activity,
      load: memberLoad(state, m.name, now),
      lastAt: lastAt.get(m.name),
    }))
}
