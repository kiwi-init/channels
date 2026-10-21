import { createElement, useEffect, useSyncExternalStore, type ComponentType, type NamedExoticComponent, type ReactNode } from "react"

type Loaded<P> = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; view: ComponentType<P> | NamedExoticComponent<P> }

const failed = new Set<() => void>()

export function onLoadFailed(listener: () => void): () => void {
  failed.add(listener)
  return () => {
    failed.delete(listener)
  }
}

export interface Later<P extends object> {
  View: (props: P) => ReactNode
  load: () => void
}

export function later<P extends object>(get: () => Promise<ComponentType<P> | NamedExoticComponent<P>>, fallback: (props: P) => ReactNode = () => null): Later<P> {
  let state: Loaded<P> = { kind: "idle" }
  const listeners = new Set<() => void>()
  const set = (next: Loaded<P>) => {
    state = next
    for (const listener of listeners) listener()
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const snapshot = () => state
  const load = () => {
    if (state.kind !== "idle") return
    set({ kind: "loading" })
    get().then(
      (view) => set({ kind: "ready", view }),
      () => {
        set({ kind: "idle" })
        for (const listener of failed) listener()
      }
    )
  }
  function View(props: P): ReactNode {
    const now = useSyncExternalStore(subscribe, snapshot, snapshot)
    useEffect(load, [])
    return now.kind === "ready" ? createElement(now.view, props) : fallback(props)
  }
  return { View, load }
}

export function whenIdle(run: () => void): void {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 2000 })
  else setTimeout(run, 200)
}
