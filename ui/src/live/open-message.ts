import { useSyncExternalStore } from "react"

import type { Message } from "~/model"

export interface Wanted {
  readonly code: string
  readonly seq: number
}

export type Found = { kind: "none" } | { kind: "waiting" } | { kind: "missing" } | { kind: "found"; m: Message }

let wanted: Wanted | null = null
const listeners = new Set<() => void>()

const changed = (): void => {
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function openMessage(code: string, seq: number): void {
  wanted = { code, seq }
  changed()
}

export function openFromNote(code: string, seq: number, showChannel: (code: string) => void): void {
  showChannel(code)
  openMessage(code, seq)
}

export const wantedNow = (): Wanted | null => wanted

export function dropMessage(was: Wanted): void {
  if (wanted !== was) return
  wanted = null
  changed()
}

export const useWantedMessage = (): Wanted | null => useSyncExternalStore(subscribe, () => wanted)

export function findWanted(want: Wanted | null, code: string, messages: readonly Message[]): Found {
  if (!want || want.code !== code) return { kind: "none" }
  const m = messages.find((x) => x.seq === want.seq)
  if (m) return { kind: "found", m }
  return messages.some((x) => x.seq > want.seq) ? { kind: "missing" } : { kind: "waiting" }
}
