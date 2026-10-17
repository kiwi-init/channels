import type { SendOptions } from "@mc/client.ts"
import { chooseThread, type ChannelState, type Place } from "@mc/state.ts"

export function sendFrom(state: Pick<ChannelState, "tasks" | "coordinator">, place: Place, me: string): Pick<SendOptions, "to" | "task" | "dm"> {
  const asked = place.kind === "task" ? { task: place.task } : place.kind === "dm" ? { dm: place.with[0] === me ? place.with[1] : place.with[0] } : { main: true }
  const chosen = chooseThread(state, me, asked)
  if (typeof chosen === "string") return {}
  return { ...(chosen.task !== undefined ? { task: chosen.task } : {}), ...(chosen.to ? { to: chosen.to } : {}), ...(chosen.dm ? { dm: true } : {}) }
}
