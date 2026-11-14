import { useSyncExternalStore } from "react"

import { bridge } from "@kiwi/secrets/secrets.ts"

type Listener = () => void

let maximized = false
let started = false
const listeners = new Set<Listener>()

function set(next: boolean): void {
  if (next === maximized) return
  maximized = next
  for (const l of listeners) l()
}

function start(): void {
  if (started) return
  started = true
  const b = bridge()
  if (typeof b?.windowMaximized !== "function" || typeof b.onMaximized !== "function") return
  b.onMaximized(set)
  void b.windowMaximized().then(set, () => set(false))
}

function subscribe(l: Listener): () => void {
  start()
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function useWindowMaximized(): boolean {
  return useSyncExternalStore(subscribe, () => maximized)
}
