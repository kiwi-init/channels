import { useSyncExternalStore } from "react"

export const WIDE = "(min-width: 1180px) and (orientation: landscape)"

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (changed) => {
      const list = matchMedia(query)
      list.addEventListener("change", changed)
      return () => list.removeEventListener("change", changed)
    },
    () => matchMedia(query).matches,
    () => true
  )
}
