import type { Channel, Live, OpenKind, PresenceFields } from "@mc/client.ts"
import { eachLive } from "@mc/client.ts"
import type { Message, Presence } from "@mc/protocol.ts"
import { relayOrigin } from "@web/lib/relay"
import * as Effect from "effect/Effect"
import { fork, run } from "./runtime"

export const PUBLIC_RELAY = "https://channels.kiwiinit.com"

let current: string = relayOrigin(process.env.EXPO_PUBLIC_KIWI_RELAY) ?? PUBLIC_RELAY

export function relayUrl(): string {
  return current
}

export function setRelayUrl(raw: string): boolean {
  const origin = relayOrigin(raw)
  if (!origin) return false
  current = origin
  return true
}

export interface Watch {
  message?: (m: Message) => void
  ready?: (head: number) => void
  open?: (kind: OpenKind, outage: number | null, announce?: (fields: PresenceFields) => void) => void
  presence?: (p: Presence & { sigOk: boolean }) => void
  down?: (line: string) => void
  changed?: (what: "Info" | "Roster" | "Request") => void
  gone?: () => void
}

const watching = new Map<string, () => void>()

function hear(on: Watch, ev: Live): void {
  switch (ev._tag) {
    case "Message":
      on.message?.(ev.message)
      return
    case "Ready":
      on.ready?.(ev.head)
      return
    case "Open":
      on.open?.(ev.kind, ev.outage, (fields) => void run(ev.presence(fields)).catch(() => {}))
      return
    case "Presence":
      on.presence?.(ev.presence)
      return
    case "Down":
      on.down?.(`the relay has been out of reach for ${Math.round(ev.after / 1000)}s`)
      return
    case "Info":
    case "Roster":
    case "Request":
      on.changed?.(ev._tag)
      return
    default:
      return
  }
}

export function watchChannel(ch: Channel, since: number, on: Watch): () => void {
  const room = ch.roomId
  watching.get(room)?.()
  const stop = fork(
    eachLive(
      ch.fx.live(since, { presence: !!on.presence, reads: false }),
      (ev) => Effect.sync(() => hear(on, ev)),
      (line) => Effect.sync(() => on.down?.(line))
    ).pipe(Effect.catch(() => Effect.sync(() => on.gone?.())))
  )
  const stopThis = () => {
    if (watching.get(room) === stopThis) watching.delete(room)
    stop()
  }
  watching.set(room, stopThis)
  return stopThis
}

export function watchedRooms(): string[] {
  return [...watching.keys()]
}
