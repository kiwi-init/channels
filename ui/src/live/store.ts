import { useSyncExternalStore } from "react"

import type { SendOptions } from "@kiwi/core/client.ts"
import type { JoinRequest, Member as RosterMember } from "@kiwi/core/membership.ts"
import type { Message as Wire } from "@kiwi/core/protocol.ts"
import type { ChannelState, FoldBase } from "@kiwi/core/state.ts"
import type { ChannelLink } from "@kiwi/channel/channel-ops.ts"
import type { Channel, GoneChannel, Upload, Where } from "~/model"

export interface Run {
  code: string
  roomId: string
  me: string
  isOwner: boolean
  ch: ChannelLink
  state: ChannelState
  messages: readonly Wire[]
  roster: readonly RosterMember[]
  requests: readonly JoinRequest[]
  send: (body: string, opts: SendOptions) => Promise<number>
  post: (where: Where, text: string, opts: { replyTo?: number; inThread?: number; images?: Upload[] }) => Promise<number>
  retry: (key: number) => Promise<number>
  discard: (key: number) => void
  refreshRequests: () => Promise<void>
  refreshRoster: () => Promise<void>
  foldFrom: (messages: Wire[], base: FoldBase | null) => ChannelState
}

interface Opened {
  code: string
  channel: Channel
  run: Run | null
}

let current: Opened | null = null
const listeners = new Set<() => void>()

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function publish(next: Opened | null): void {
  if (current === next) return
  current = next
  for (const l of listeners) l()
}

export function closeOpened(code: string): void {
  if (current?.code === code) publish(null)
}

export const openedRun = (code: string): Run | null => (current?.code === code ? current.run : null)

export const openedChannel = (code: string): Channel | null => (current?.code === code ? current.channel : null)

export function useOpened(): Opened | null {
  return useSyncExternalStore(subscribe, () => current)
}

let gone: GoneChannel | null = null
const leaving = new Set<string>()
const goneListeners = new Set<() => void>()

export function leavingOnPurpose(code: string): void {
  leaving.add(code)
}

export function markGone(next: GoneChannel): void {
  if (leaving.has(next.code) || gone?.code === next.code) return
  gone = next
  for (const l of goneListeners) l()
}

export function useGone(): GoneChannel | null {
  return useSyncExternalStore(
    (l) => {
      goneListeners.add(l)
      return () => void goneListeners.delete(l)
    },
    () => gone
  )
}
