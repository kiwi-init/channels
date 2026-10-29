import { lazy, type ComponentType, type LazyExoticComponent } from "react"

const loads: (() => Promise<unknown>)[] = []

export function later<P extends object>(load: () => Promise<ComponentType<P>>): LazyExoticComponent<ComponentType<P>> {
  loads.push(load)
  return lazy(() => load().then((c) => ({ default: c })))
}

export function warmLater(): void {
  window.setTimeout(() => {
    for (const load of loads)
      void load().catch(() => {
        // A chunk that fails to warm loads again when it is first shown, and its boundary reports that failure.
      })
  }, 1500)
}
